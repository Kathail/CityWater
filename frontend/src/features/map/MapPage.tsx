import { useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MapLibreMap, type MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useMapOverlays, useTileLayers } from "./hooks";
import { LayerPanel } from "./LayerPanel";
import type { BasemapId } from "./basemap";
import { AssetSidePanel, type ClickedFeature } from "./AssetSidePanel";
import { MapContextMenu } from "./MapContextMenu";
import { AddAssetDialog } from "./AddAssetDialog";
import { MapSearchBar, type MapSearchHit } from "./MapSearchBar";

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

export function MapPage() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const tileLayersQuery = useTileLayers();
  const overlaysQuery = useMapOverlays();

  const [basemap, setBasemap] = useState<BasemapId>("osm");
  const [visibleClasses, setVisibleClasses] = useState<Set<string>>(new Set());
  const [showWos, setShowWos] = useState(true);
  const [showSrs, setShowSrs] = useState(true);
  const [selected, setSelected] = useState<ClickedFeature | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    pixel: [number, number];
    coords: [number, number];
  } | null>(null);
  const [addCoords, setAddCoords] = useState<[number, number] | null>(null);

  // Initialize layer visibility once classes load
  useEffect(() => {
    if (tileLayersQuery.data && visibleClasses.size === 0) {
      setVisibleClasses(new Set(tileLayersQuery.data.map((l) => l.class_code)));
    }
  }, [tileLayersQuery.data, visibleClasses.size]);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLES.osm,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }));
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }));
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Switch basemap style; re-add the assets source/layers after style loads
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
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
      map.addSource("assets", {
        type: "vector",
        tiles: [`${window.location.origin}/api/v1/tiles/assets/{z}/{x}/{y}.pbf`],
        minzoom: 0,
        maxzoom: 22,
        promoteId: "asset_uid",
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
        "emergency", "#ef4444",
        "high", "#f59e0b",
        "normal", "#3b82f6",
        "low", "#94a3b8",
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
      const wos = map.getSource("op-wos") as maplibregl.GeoJSONSource | undefined;
      const srs = map.getSource("op-srs") as maplibregl.GeoJSONSource | undefined;
      wos?.setData(overlays.open_wos);
      srs?.setData(overlays.active_srs);
    }
    if (map.isStyleLoaded() && map.getSource("op-wos")) update();
    else map.once("idle", update);
  }, [overlaysQuery.data, basemap]);

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
      const opLayers = ["op-wos-layer", "op-srs-layer"].filter((id) =>
        map.getLayer(id),
      );
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
            reported_address: props.reported_address
              ? String(props.reported_address)
              : null,
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
      />
      <div className="relative flex-1">
        <div ref={containerRef} className="absolute inset-0" data-testid="map-container" />
        <MapSearchBar onPick={flyToHit} />
        {selected && <AssetSidePanel feature={selected} onClose={() => setSelected(null)} />}
        {contextMenu && (
          <MapContextMenu
            pixelX={contextMenu.pixel[0]}
            pixelY={contextMenu.pixel[1]}
            coords={contextMenu.coords}
            onAddAsset={(c) => setAddCoords(c)}
            onClose={() => setContextMenu(null)}
          />
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
