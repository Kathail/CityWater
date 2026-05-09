import { useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MapLibreMap, type MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { getAsset } from "../assets/api";
import { useMapOverlays, useTileLayers } from "./hooks";
import { LayerPanel } from "./LayerPanel";
import type { BasemapId } from "./basemap";
import { AssetSidePanel, type ClickedFeature } from "./AssetSidePanel";
import { MapContextMenu } from "./MapContextMenu";
import { AddAssetDialog } from "./AddAssetDialog";
import { MapSearchBar, type MapSearchHit } from "./MapSearchBar";
import { CreateWorkOrderDialog } from "../work-orders/CreateWorkOrderDialog";
import { IntakeDialog } from "../service-requests/IntakeDialog";
import { setSerde, usePersistedState } from "../../lib/persistedState";

const SATELLITE_TILE_URL = (import.meta as { env: { VITE_SATELLITE_TILE_URL?: string } }).env
  .VITE_SATELLITE_TILE_URL;

const BASEMAP_STYLES: Record<BasemapId, maplibregl.StyleSpecification> = {
  osm: {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "© OpenStreetMap contributors",
      },
    },
    layers: [{ id: "osm", type: "raster", source: "osm" }],
  },
  blank: {
    version: 8,
    sources: {},
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#f8fafc" },
      },
    ],
  },
  satellite: SATELLITE_TILE_URL
    ? {
        version: 8,
        sources: {
          sat: { type: "raster", tiles: [SATELLITE_TILE_URL], tileSize: 256 },
        },
        layers: [{ id: "sat", type: "raster", source: "sat" }],
      }
    : {
        version: 8,
        sources: {},
        layers: [
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#0f172a" },
          },
        ],
      },
};

const DEFAULT_CENTER: [number, number] = [-76.5, 39.3];
const DEFAULT_ZOOM = 11;

/** Pull a representative lon/lat out of a GeoJSON geometry. Point uses
 * its own coords; Line/Polygon use the first vertex (good enough for
 * "fly to this asset" navigation; full centroid would be nicer but
 * isn't worth a turf dependency for v1). */
function representativePoint(
  geom: { type: string; coordinates: unknown } | null | undefined,
): [number, number] | null {
  if (!geom) return null;
  const c = geom.coordinates;
  if (geom.type === "Point" && Array.isArray(c) && typeof c[0] === "number") {
    return [c[0] as number, c[1] as number];
  }
  if (geom.type === "LineString" && Array.isArray(c) && Array.isArray(c[0])) {
    const first = c[0] as number[];
    return [first[0], first[1]];
  }
  if (geom.type === "Polygon" && Array.isArray(c) && Array.isArray(c[0])) {
    const ring = c[0] as number[][];
    if (ring.length > 0) return [ring[0][0], ring[0][1]];
  }
  return null;
}

/** Compute a [west, south, east, north] bbox from a Polygon or
 * MultiPolygon geometry. Used to fit the map to a service area when
 * `?area=<code>` is in the URL. Returns null on empty geometries. */
function polygonBbox(
  geom: GeoJSON.Polygon | GeoJSON.MultiPolygon,
): [[number, number], [number, number]] | null {
  const rings: number[][][] =
    geom.type === "Polygon" ? geom.coordinates : geom.coordinates.flat();
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (lon < west) west = lon;
      if (lon > east) east = lon;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }
  if (!Number.isFinite(west)) return null;
  return [
    [west, south],
    [east, north],
  ];
}

/** Parse a `?ll=lon,lat&z=zoom` pair from the URL. Returns the default
 * pair when missing or malformed. */
function readCenterZoom(search: URLSearchParams): { center: [number, number]; zoom: number } {
  const ll = search.get("ll");
  const z = search.get("z");
  let center = DEFAULT_CENTER;
  let zoom = DEFAULT_ZOOM;
  if (ll) {
    const parts = ll.split(",").map((p) => Number(p.trim()));
    if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
      center = [parts[0], parts[1]];
    }
  }
  if (z) {
    const n = Number(z);
    if (Number.isFinite(n) && n >= 0 && n <= 24) zoom = n;
  }
  return { center, zoom };
}

export function MapPage() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const tileLayersQuery = useTileLayers();
  const overlaysQuery = useMapOverlays();
  // URL state — `?ll=lon,lat&z=zoom&focus=ASSET-UID` makes the current
  // map view sharable. Center/zoom round-trip through `moveend` so the
  // back button replays panning history. `?focus=` opens the side
  // panel for a specific asset on first paint.
  const [search, setSearch] = useSearchParams();
  // Snapshot the URL params at mount — we don't want to re-read them
  // on every render because the listener writes back to the URL
  // continuously and that would create a feedback loop.
  const initialView = useRef(readCenterZoom(search));
  const initialFocus = useRef(search.get("focus"));
  // `?area=<code>` deep-links from the dashboard's "By area" panel.
  // Resolved against the loaded service_areas overlay; the map fits to
  // the area's bounds and turns the matching area-kind layer on.
  const initialArea = useRef(search.get("area"));
  // Suppresses the URL-write effect when we're moving the map in
  // response to a URL change (e.g. external link). Without this, the
  // very first moveend after a navigation would overwrite the URL the
  // user just clicked.
  const suppressUrlWrite = useRef(false);

  // Layer toggles persist across refresh — operators routinely turn off
  // entire domains (e.g. only show storm assets while triaging a flood)
  // and shouldn't have to redo that every page load.
  const [basemap, setBasemap] = usePersistedState<BasemapId>("map.basemap", "osm");
  const [visibleClasses, setVisibleClasses] = usePersistedState<Set<string>>(
    "map.visibleClasses",
    new Set(),
    setSerde,
  );
  const [showWos, setShowWos] = usePersistedState("map.showWos", true);
  const [showSrs, setShowSrs] = usePersistedState("map.showSrs", true);
  const [areaKindsVisible, setAreaKindsVisible] = usePersistedState<Set<string>>(
    "map.areaKinds",
    new Set(),
    setSerde,
  );
  const areaKindsInited = useRef(false);
  const [selected, setSelected] = useState<ClickedFeature | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    pixel: [number, number];
    coords: [number, number];
  } | null>(null);
  const [addCoords, setAddCoords] = useState<[number, number] | null>(null);
  // MAP-P1-12: open these dialogs from the map context menu instead of
  // tombstoning them. WO has no own location field so coords are
  // informational; SR pre-fills lon/lat from the click.
  const [newWoOpen, setNewWoOpen] = useState(false);
  const [newSrCoords, setNewSrCoords] = useState<[number, number] | null>(null);
  // MAP-P1-15: layers panel slides over the map on mobile (<md). On
  // desktop it's always visible in the left rail and this state is
  // ignored. Closes on backdrop tap, on every escape, and after
  // any toggle so the operator can see what they just changed.
  const [layersOpen, setLayersOpen] = useState(false);
  useEffect(() => {
    if (!layersOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setLayersOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [layersOpen]);

  // Initialize layer visibility once classes load — but ONLY on the
  // first ever visit (no localStorage record yet). Once a user has
  // interacted with the layer panel, their saved set wins, even if
  // they hid everything intentionally.
  const layerInitRan = useRef(false);
  useEffect(() => {
    if (layerInitRan.current) return;
    if (!tileLayersQuery.data) return;
    layerInitRan.current = true;
    if (window.localStorage.getItem("map.visibleClasses") === null) {
      setVisibleClasses(new Set(tileLayersQuery.data.map((l) => l.class_code)));
    }
  }, [tileLayersQuery.data, setVisibleClasses]);

  // Track the applied basemap so the swap effect below can skip its
  // first run — the map was created with this style already, and a
  // redundant setStyle while the initial load is in flight provokes
  // maplibre's "rebuilding the style from scratch" warning and can
  // leave layers in an inconsistent state.
  const appliedBasemap = useRef<BasemapId>(basemap);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      // Use the persisted basemap as the initial style so we don't
      // need to immediately setStyle over a still-loading style.
      style: BASEMAP_STYLES[appliedBasemap.current],
      // Initial view from `?ll=&z=` if present, otherwise our default
      // center/zoom. Captured at mount via useRef so panning the map
      // afterwards doesn't reset on re-renders.
      center: initialView.current.center,
      zoom: initialView.current.zoom,
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }));
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }));
    mapRef.current = map;

    // Push center/zoom to the URL on every moveend, debounced so a
    // smooth pan doesn't generate dozens of history entries. Replace
    // (not push) so the back button doesn't accumulate every nudge.
    let urlWriteTimer: number | null = null;
    function onMoveEnd() {
      if (suppressUrlWrite.current) {
        suppressUrlWrite.current = false;
        return;
      }
      if (urlWriteTimer !== null) window.clearTimeout(urlWriteTimer);
      urlWriteTimer = window.setTimeout(() => {
        const c = map.getCenter();
        const z = map.getZoom();
        // setSearch via the latest setSearch reference — captured by
        // effect closure on each render via the urlSyncRef.
        urlSyncRef.current?.(c.lng.toFixed(5), c.lat.toFixed(5), z.toFixed(2));
      }, 300);
    }
    map.on("moveend", onMoveEnd);

    return () => {
      if (urlWriteTimer !== null) window.clearTimeout(urlWriteTimer);
      map.off("moveend", onMoveEnd);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Latest setSearch reference for the moveend handler (so we don't
  // rebind it every render). The handler reads through this ref.
  const urlSyncRef = useRef<(lng: string, lat: string, z: string) => void>(() => {});
  useEffect(() => {
    urlSyncRef.current = (lng, lat, z) => {
      const next = new URLSearchParams(search);
      next.set("ll", `${lng},${lat}`);
      next.set("z", z);
      setSearch(next, { replace: true });
    };
  }, [search, setSearch]);

  // ?focus=ASSET-UID — fly + open the side panel for a specific asset
  // on first paint. Only runs once; subsequent ?focus changes from URL
  // navigation are handled by the search bar / context menu paths.
  const focusRan = useRef(false);
  useEffect(() => {
    if (focusRan.current) return;
    const uid = initialFocus.current;
    if (!uid) return;
    focusRan.current = true;
    let cancelled = false;
    (async () => {
      try {
        const asset = await getAsset(uid);
        if (cancelled) return;
        const map = mapRef.current;
        const point = representativePoint(asset.geometry);
        if (!map || !point) return;
        // Suppress the moveend → URL write so flyTo doesn't overwrite
        // the ?focus= we just landed on.
        suppressUrlWrite.current = true;
        map.flyTo({ center: point, zoom: Math.max(map.getZoom(), 16) });
        setSelected({
          kind: "asset",
          asset_uid: asset.asset_uid,
          class_code: asset.class_code,
          domain: asset.domain,
          status: asset.status ?? "",
          condition: asset.condition ?? null,
        });
      } catch {
        // Asset not found / unauthorized — silently leave the map at
        // its default view rather than throw a confusing error overlay.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ?area=<code> — fit the map to the matching service area's bounds
  // and ensure that area-kind's layer is visible. Runs once when the
  // overlays payload first arrives (the area data lives there). The
  // `?area=` is then cleared from the URL so a subsequent pan doesn't
  // overwrite it on every moveend.
  const areaRan = useRef(false);
  useEffect(() => {
    if (areaRan.current) return;
    const code = initialArea.current;
    if (!code) return;
    const overlays = overlaysQuery.data;
    if (!overlays) return;
    areaRan.current = true;
    const feature = overlays.service_areas.features.find((f) => f.properties.code === code);
    if (!feature) return;
    const bbox = polygonBbox(feature.geometry);
    if (!bbox) return;
    const map = mapRef.current;
    if (!map) return;
    suppressUrlWrite.current = true;
    map.fitBounds(bbox, { padding: 40, duration: 600, maxZoom: 16 });
    setAreaKindsVisible((prev) => {
      if (prev.has(feature.properties.area_kind)) return prev;
      const next = new Set(prev);
      next.add(feature.properties.area_kind);
      return next;
    });
    // Drop ?area from the URL — it served its purpose. Center/zoom
    // will be written by the upcoming moveend so the URL stays
    // sharable for the resulting view.
    const nextSearch = new URLSearchParams(search);
    nextSearch.delete("area");
    setSearch(nextSearch, { replace: true });
    // search/setSearch intentionally elided from deps — we only want
    // this to run once when overlays arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlaysQuery.data]);

  // Sync `?focus=` to the selected asset so the URL stays sharable as
  // the operator navigates between assets via the search bar / clicks.
  useEffect(() => {
    const next = new URLSearchParams(search);
    if (selected?.kind === "asset") {
      if (next.get("focus") === selected.asset_uid) return;
      next.set("focus", selected.asset_uid);
    } else {
      if (!next.has("focus")) return;
      next.delete("focus");
    }
    setSearch(next, { replace: true });
    // search/setSearch intentionally omitted — selected is the trigger;
    // search is read inside but we only want to fire on selection
    // changes, not URL nudges from the moveend handler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  // Switch basemap style; re-add the assets source/layers after style loads.
  // Skip the first run — the map was already created with this style
  // (see init effect) so calling setStyle here would just kick off a
  // rebuild over the in-flight initial load.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (appliedBasemap.current === basemap) return;
    appliedBasemap.current = basemap;
    map.setStyle(BASEMAP_STYLES[basemap]);
  }, [basemap]);

  // Add assets source + per-class layers once the style is ready
  useEffect(() => {
    const map = mapRef.current;
    const layers = tileLayersQuery.data;
    if (!map || !layers) return;

    function ensureLayers() {
      if (!map || !layers) return;
      if (map.getSource("assets")) return;
      // Operational overlay sources (empty until overlaysQuery resolves;
      // a separate effect syncs the data).
      map.addSource("op-wos", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addSource("op-srs", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addSource("op-areas", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addSource("assets", {
        type: "vector",
        tiles: [`${window.location.origin}/api/v1/tiles/assets/{z}/{x}/{y}.pbf`],
        minzoom: 0,
        maxzoom: 22,
        promoteId: "asset_uid",
      });

      // Service area polygons render BEFORE asset/op layers so they
      // sit underneath everything else and don't block clicks.
      map.addLayer({
        id: "op-areas-fill",
        type: "fill",
        source: "op-areas",
        paint: {
          "fill-color": ["coalesce", ["get", "color"], "#475569"],
          "fill-opacity": 0.15,
        },
      });
      map.addLayer({
        id: "op-areas-line",
        type: "line",
        source: "op-areas",
        paint: {
          "line-color": ["coalesce", ["get", "color"], "#475569"],
          "line-width": 2,
          "line-dasharray": [3, 2],
        },
      });
      for (const layer of layers) {
        const color = layer.color ?? "#475569";
        const filter = layer.filter as maplibregl.FilterSpecification;
        if (layer.geometry_type === "Point") {
          map.addLayer({
            id: layer.id,
            type: "circle",
            source: "assets",
            "source-layer": layer.source_layer,
            filter,
            paint: {
              "circle-radius": 5,
              "circle-color": color,
              "circle-stroke-width": 1,
              "circle-stroke-color": "#ffffff",
            },
          });
        } else if (layer.geometry_type === "LineString") {
          map.addLayer({
            id: layer.id,
            type: "line",
            source: "assets",
            "source-layer": layer.source_layer,
            filter,
            paint: { "line-color": color, "line-width": 2 },
          });
        } else {
          map.addLayer({
            id: layer.id,
            type: "fill",
            source: "assets",
            "source-layer": layer.source_layer,
            filter,
            paint: {
              "fill-color": color,
              "fill-opacity": 0.4,
              "fill-outline-color": "#1f2937",
            },
          });
        }
      }

      // Operational overlay layers — open WOs (purple ring, color by
      // priority) and active SRs (filled pin, color by priority).
      // Drawn on top of assets so they're always clickable first.
      const priorityColor: maplibregl.ExpressionSpecification = [
        "match",
        ["get", "priority"],
        "emergency",
        "#ef4444",
        "high",
        "#f59e0b",
        "normal",
        "#3b82f6",
        "low",
        "#94a3b8",
        "#94a3b8",
      ];
      map.addLayer({
        id: "op-wos-layer",
        type: "circle",
        source: "op-wos",
        paint: {
          "circle-radius": 7,
          "circle-color": "#1e293b",
          "circle-stroke-width": 3,
          "circle-stroke-color": priorityColor,
        },
      });
      map.addLayer({
        id: "op-srs-layer",
        type: "circle",
        source: "op-srs",
        paint: {
          "circle-radius": 6,
          "circle-color": priorityColor,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#0f172a",
        },
      });
    }

    if (map.isStyleLoaded()) {
      ensureLayers();
    } else {
      map.once("styledata", ensureLayers);
    }
  }, [tileLayersQuery.data, basemap]);

  // Sync layer visibility
  useEffect(() => {
    const map = mapRef.current;
    const layers = tileLayersQuery.data;
    if (!map || !layers) return;
    for (const layer of layers) {
      if (!map.getLayer(layer.id)) continue;
      map.setLayoutProperty(
        layer.id,
        "visibility",
        visibleClasses.has(layer.class_code) ? "visible" : "none",
      );
    }
  }, [visibleClasses, tileLayersQuery.data, basemap]);

  // Push overlay GeoJSON into the map sources whenever the query refetches.
  useEffect(() => {
    const map = mapRef.current;
    const overlays = overlaysQuery.data;
    if (!map || !overlays) return;
    function update() {
      if (!map || !overlays) return;
      (map.getSource("op-wos") as maplibregl.GeoJSONSource | undefined)?.setData(overlays.open_wos);
      (map.getSource("op-srs") as maplibregl.GeoJSONSource | undefined)?.setData(
        overlays.active_srs,
      );
      (map.getSource("op-areas") as maplibregl.GeoJSONSource | undefined)?.setData(
        overlays.service_areas,
      );
    }
    if (map.isStyleLoaded() && map.getSource("op-wos")) update();
    else map.once("idle", update);
  }, [overlaysQuery.data, basemap]);

  // Initialize area visibility — start with everything OFF (less noise);
  // user toggles on the kinds they care about.
  useEffect(() => {
    if (overlaysQuery.data && areaKindsVisible.size === 0 && !areaKindsInited.current) {
      areaKindsInited.current = true;
      // start empty by intent; could pre-select 'maintenance' if desired.
    }
  }, [overlaysQuery.data, areaKindsVisible.size]);

  // Apply area visibility (filter expression).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const visible = Array.from(areaKindsVisible);
    const filter: maplibregl.FilterSpecification = visible.length
      ? ["in", ["get", "area_kind"], ["literal", visible]]
      : ["==", ["get", "area_kind"], "__NONE__"];
    if (map.getLayer("op-areas-fill")) map.setFilter("op-areas-fill", filter);
    if (map.getLayer("op-areas-line")) map.setFilter("op-areas-line", filter);
  }, [areaKindsVisible, tileLayersQuery.data, basemap]);

  // WO / SR overlay visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (map.getLayer("op-wos-layer")) {
      map.setLayoutProperty("op-wos-layer", "visibility", showWos ? "visible" : "none");
    }
    if (map.getLayer("op-srs-layer")) {
      map.setLayoutProperty("op-srs-layer", "visibility", showSrs ? "visible" : "none");
    }
  }, [showWos, showSrs, tileLayersQuery.data, basemap]);

  // Bind click + contextmenu handlers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onClick = (e: MapMouseEvent) => {
      // First look for WO/SR pins — they're drawn on top and almost
      // always what the operator means to click.
      const opLayers = ["op-wos-layer", "op-srs-layer"].filter((id) => map.getLayer(id));
      const opFeatures = opLayers.length
        ? map.queryRenderedFeatures(e.point, { layers: opLayers })
        : [];
      if (opFeatures.length > 0) {
        const f = opFeatures[0];
        const props = (f.properties ?? {}) as Record<string, unknown>;
        const kind = String(props.kind ?? "");
        if (kind === "work_order") {
          setSelected({
            kind: "work_order",
            wo_number: String(props.wo_number),
            title: String(props.title ?? ""),
            category: String(props.category ?? ""),
            priority: String(props.priority ?? ""),
            status: String(props.status ?? ""),
            asset_uid: props.asset_uid ? String(props.asset_uid) : null,
          });
        } else if (kind === "service_request") {
          setSelected({
            kind: "service_request",
            sr_number: String(props.sr_number),
            category: String(props.category ?? ""),
            priority: String(props.priority ?? ""),
            status: String(props.status ?? ""),
            reported_address: props.reported_address ? String(props.reported_address) : null,
            asset_uid: props.asset_uid ? String(props.asset_uid) : null,
          });
        }
        setContextMenu(null);
        return;
      }
      // Otherwise, fall back to asset click.
      const features = map.queryRenderedFeatures(e.point, {
        filter: ["has", "asset_uid"],
      });
      if (features.length > 0) {
        const f = features[0];
        const props = f.properties ?? {};
        setSelected({
          kind: "asset",
          asset_uid: String(props.asset_uid),
          class_code: String(props.class_code ?? ""),
          domain: String(props.domain ?? ""),
          status: String(props.status ?? ""),
          condition: props.condition !== undefined ? Number(props.condition) : null,
        });
      } else {
        setSelected(null);
      }
      setContextMenu(null);
    };
    const onContext = (e: MapMouseEvent) => {
      e.preventDefault();
      setContextMenu({
        pixel: [e.point.x, e.point.y],
        coords: [e.lngLat.lng, e.lngLat.lat],
      });
    };
    map.on("click", onClick);
    map.on("contextmenu", onContext);
    // Pointer cursor over operational pins.
    const onMove = (e: MapMouseEvent) => {
      if (!map.getLayer("op-wos-layer")) return;
      const hit = map.queryRenderedFeatures(e.point, {
        layers: ["op-wos-layer", "op-srs-layer"].filter((l) => map.getLayer(l)),
      });
      map.getCanvas().style.cursor = hit.length ? "pointer" : "";
    };
    map.on("mousemove", onMove);
    return () => {
      map.off("click", onClick);
      map.off("contextmenu", onContext);
      map.off("mousemove", onMove);
    };
  }, []);

  function flyToHit(hit: MapSearchHit) {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({ center: [hit.lon, hit.lat], zoom: Math.max(map.getZoom(), 16) });
    if (hit.kind === "asset") {
      setSelected({
        kind: "asset",
        asset_uid: hit.uid,
        class_code: hit.class_code ?? "",
        domain: hit.domain ?? "",
        status: hit.status ?? "",
        condition: null,
      });
    } else if (hit.kind === "work_order") {
      setSelected({
        kind: "work_order",
        wo_number: hit.uid,
        title: hit.label,
        category: "",
        priority: hit.priority ?? "",
        status: hit.status ?? "",
        asset_uid: null,
      });
    } else if (hit.kind === "service_request") {
      setSelected({
        kind: "service_request",
        sr_number: hit.uid,
        category: hit.class_code ?? "",
        priority: hit.priority ?? "",
        status: hit.status ?? "",
        reported_address: hit.label,
        asset_uid: null,
      });
    }
  }

  function toggleClass(classCode: string, visible: boolean) {
    setVisibleClasses((prev) => {
      const next = new Set(prev);
      if (visible) next.add(classCode);
      else next.delete(classCode);
      return next;
    });
  }

  return (
    <div className="absolute inset-0 flex">
      <LayerPanel
        layers={tileLayersQuery.data ?? []}
        visibleClasses={visibleClasses}
        onToggle={toggleClass}
        basemap={basemap}
        onBasemapChange={setBasemap}
        showWos={showWos}
        showSrs={showSrs}
        onToggleWos={setShowWos}
        onToggleSrs={setShowSrs}
        woCount={overlaysQuery.data?.open_wos.features.length ?? 0}
        srCount={overlaysQuery.data?.active_srs.features.length ?? 0}
        serviceAreas={overlaysQuery.data?.service_areas.features ?? []}
        areaKindsVisible={areaKindsVisible}
        onToggleAreaKind={(kind, on) =>
          setAreaKindsVisible((prev) => {
            const next = new Set(prev);
            if (on) next.add(kind);
            else next.delete(kind);
            return next;
          })
        }
        mobileOpen={layersOpen}
        onMobileClose={() => setLayersOpen(false)}
      />
      <div className="relative flex-1">
        {/* h-full w-full (not absolute inset-0): maplibre-gl.css sets
            `.maplibregl-map { position: relative }` once the map mounts,
            which would override `absolute` and collapse the container
            to 0 height (the canvas inside is itself absolute, so the
            container has no in-flow content). With h-full w-full the
            container fills its flex-1 parent regardless of position. */}
        <div ref={containerRef} className="h-full w-full" data-testid="map-container" />
        {/* Mobile-only hamburger to reveal the layers drawer. The
            desktop sidebar is always visible so this never renders
            on >=md. */}
        <button
          type="button"
          onClick={() => setLayersOpen(true)}
          aria-label="Open layers"
          className="absolute left-3 top-3 z-10 rounded-md border border-slate-700 bg-slate-900/90 p-2 text-slate-200 shadow-lg backdrop-blur md:hidden"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="h-5 w-5"
          >
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <MapHeader />
        <MapSearchBar onPick={flyToHit} />
        {selected && <AssetSidePanel feature={selected} onClose={() => setSelected(null)} />}
        {contextMenu && (
          <MapContextMenu
            pixelX={contextMenu.pixel[0]}
            pixelY={contextMenu.pixel[1]}
            coords={contextMenu.coords}
            onAddAsset={(c) => setAddCoords(c)}
            onCreateWorkOrder={() => setNewWoOpen(true)}
            onCreateServiceRequest={(c) => setNewSrCoords(c)}
            onClose={() => setContextMenu(null)}
          />
        )}
        {newWoOpen && <CreateWorkOrderDialog onClose={() => setNewWoOpen(false)} />}
        {newSrCoords && (
          <IntakeDialog defaultCoords={newSrCoords} onClose={() => setNewSrCoords(null)} />
        )}
        {addCoords && (
          <AddAssetDialog
            coords={addCoords}
            onClose={() => setAddCoords(null)}
            onCreated={() => {
              setAddCoords(null);
              // Trigger MapLibre to refetch tiles
              const map = mapRef.current;
              if (map) {
                const source = map.getSource("assets");
                // @ts-expect-error setTiles exists at runtime on vector sources
                source?.setTiles?.([
                  `${window.location.origin}/api/v1/tiles/assets/{z}/{x}/{y}.pbf?ts=${Date.now()}`,
                ]);
              }
            }}
          />
        )}
      </div>
    </div>
  );
}

function MapHeader() {
  const { slug } = useParams<{ slug: string }>();
  return (
    // Pushed right on mobile so it doesn't overlap the hamburger
    // toggle (which lives at left-3). Desktop has no hamburger so
    // the breadcrumb sits flush left.
    <div className="absolute left-16 top-3 z-10 flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900/90 px-3 py-1.5 text-xs text-slate-300 shadow-lg backdrop-blur md:left-3">
      <Link to={`/${slug}/`} className="text-slate-400 hover:text-slate-200">
        ← Home
      </Link>
      <span className="text-slate-600">/</span>
      <span className="font-medium text-slate-100">Map</span>
    </div>
  );
}
