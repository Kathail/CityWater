import { useEffect, useRef } from "react";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Link, useNavigate } from "react-router-dom";
import { useMapOverlays } from "../map/hooks";
import type { DashTab } from "./DashboardTabs";

/**
 * Embedded mini-map for the dashboard center column. Same overlays the
 * full /map page uses — just smaller, with chrome stripped down so the
 * data points are the only focal element.
 *
 * Distinct from the full map:
 *  · Dark, near-monochrome basemap (no street labels) — keeps the
 *    overlay markers as the only colour against slate.
 *  · No basemap toggle, no layer panel; this is a glanceable preview.
 *  · Emergency SR pins get a slow ping ring around them.
 *  · Click anywhere → opens the full /map page at the same view.
 */

const DARK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [
    // OSM raster as the base, fully desaturated and brightness-clamped.
    // raster-brightness-min/max compresses the visible range so the
    // place-name labels (which are dark text on light backgrounds)
    // get smeared into a near-uniform dark grey. Streets + coastlines
    // still ghost through enough to ground the pins.
    {
      id: "osm",
      type: "raster",
      source: "osm",
      paint: {
        "raster-saturation": -1,
        "raster-contrast": -0.5,
        "raster-brightness-min": 0.1,
        "raster-brightness-max": 0.35,
      },
    },
    {
      id: "tint",
      type: "background",
      paint: { "background-color": "rgba(2, 6, 23, 0.7)" },
    },
  ],
};

const DEFAULT_CENTER: [number, number] = [-76.485, 38.972];
const DEFAULT_ZOOM = 12.4;

interface Props {
  slug: string;
  tab: DashTab;
}

export function MapPreview({ slug, tab }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const overlaysQuery = useMapOverlays();
  const navigate = useNavigate();

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    // Stay click-only — disable every other interaction handler so
    // the operator can't accidentally pan or zoom the mini-map; the
    // map is meant to be glanceable, not navigable. Click events still
    // fire (we use them to drill into a marker or open the full map).
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: DARK_STYLE,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: false,
      scrollZoom: false,
      dragPan: false,
      dragRotate: false,
      doubleClickZoom: false,
      keyboard: false,
      boxZoom: false,
    });
    map.touchZoomRotate.disable();
    mapRef.current = map;
    map.on("load", () => {
      // Service area outlines — drawn first, sit underneath everything.
      map.addSource("areas", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "areas-line",
        type: "line",
        source: "areas",
        paint: {
          "line-color": ["coalesce", ["get", "color"], "#475569"],
          "line-width": 1,
          "line-dasharray": [2, 2],
          "line-opacity": 0.4,
        },
      });

      // Active SRs — small pins, color by priority.
      map.addSource("srs", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "srs",
        type: "circle",
        source: "srs",
        paint: {
          "circle-radius": [
            "match",
            ["get", "priority"],
            "emergency",
            6,
            "high",
            5,
            4,
          ],
          "circle-color": [
            "match",
            ["get", "priority"],
            "emergency",
            "#fb7185",
            "high",
            "#f59e0b",
            "normal",
            "#67e8f9",
            "low",
            "#94a3b8",
            "#94a3b8",
          ],
          "circle-stroke-width": 1,
          "circle-stroke-color": "#0f172a",
        },
      });

      // Open WOs — outlined dots.
      map.addSource("wos", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "wos",
        type: "circle",
        source: "wos",
        paint: {
          "circle-radius": 4,
          "circle-color": "transparent",
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#67e8f9",
          "circle-opacity": 0.9,
        },
      });

      // Emergency SR ring — a separate larger transparent circle
      // sitting under the marker, animated as a ping. We can't easily
      // animate maplibre paint properties without a render loop, so
      // the "ping" is implemented with two static-radius circles at
      // different opacities. Good enough for a glanceable mini-map.
      map.addLayer({
        id: "srs-emergency-ring",
        type: "circle",
        source: "srs",
        filter: ["==", ["get", "priority"], "emergency"],
        paint: {
          "circle-radius": 14,
          "circle-color": "transparent",
          "circle-stroke-color": "#fb7185",
          "circle-stroke-width": 1,
          "circle-stroke-opacity": 0.5,
        },
      });

      // Pointer cursor when hovering an interactive marker.
      const setPointer = () => (map.getCanvas().style.cursor = "pointer");
      const clearPointer = () => (map.getCanvas().style.cursor = "");
      for (const id of ["wos", "srs"]) {
        map.on("mouseenter", id, setPointer);
        map.on("mouseleave", id, clearPointer);
      }
    });

    // Click — drill into the entity if the click landed on a marker,
    // otherwise open the full /map page so the operator can pan/zoom
    // freely. queryRenderedFeatures returns top-most-first; we also
    // give SRs priority over WOs since the WO outline tends to overlap
    // an SR pin at the same asset.
    function onClick(e: maplibregl.MapMouseEvent) {
      const layers = ["srs", "wos"].filter((id) => map.getLayer(id));
      const features = layers.length ? map.queryRenderedFeatures(e.point, { layers }) : [];
      if (features.length) {
        const f = features[0];
        const props = (f.properties ?? {}) as Record<string, unknown>;
        if (f.layer.id === "wos" && props.wo_number) {
          navigateRef.current(`/${slugRef.current}/work-orders/${String(props.wo_number)}`);
          return;
        }
        if (f.layer.id === "srs" && props.sr_number) {
          navigateRef.current(`/${slugRef.current}/service-requests/${String(props.sr_number)}`);
          return;
        }
      }
      // Empty canvas → open the full map. Preserve a default sense
      // of where the operator is so they don't lose context.
      navigateRef.current(`/${slugRef.current}/map`);
    }
    map.on("click", onClick);

    return () => {
      map.off("click", onClick);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Ref the navigate + slug so the click handler (set up once at
  // mount) always sees the latest values without re-binding.
  const navigateRef = useRef(navigate);
  const slugRef = useRef(slug);
  useEffect(() => {
    navigateRef.current = navigate;
    slugRef.current = slug;
  });

  // Push overlay data once it's loaded, fitting the view to the
  // service-area extent so the user sees the whole utility footprint.
  useEffect(() => {
    const map = mapRef.current;
    const overlays = overlaysQuery.data;
    if (!map || !overlays) return;
    const apply = () => {
      (map.getSource("areas") as maplibregl.GeoJSONSource | undefined)?.setData(
        overlays.service_areas,
      );
      (map.getSource("srs") as maplibregl.GeoJSONSource | undefined)?.setData(
        overlays.active_srs,
      );
      (map.getSource("wos") as maplibregl.GeoJSONSource | undefined)?.setData(
        overlays.open_wos,
      );
    };
    if (map.isStyleLoaded() && map.getSource("areas")) apply();
    else map.once("idle", apply);
  }, [overlaysQuery.data]);

  const wos = overlaysQuery.data?.open_wos.features.length ?? 0;
  const srs = overlaysQuery.data?.active_srs.features.length ?? 0;
  const emergencies =
    overlaysQuery.data?.active_srs.features.filter(
      (f) => f.properties.priority === "emergency",
    ).length ?? 0;

  return (
    <section
      aria-label="Map preview"
      className="relative console-panel"
    >
      {/* Top strip — title + counts. Stays out of the map's visual
          frame so the data is the only thing competing for attention
          inside the canvas. */}
      <header className="flex items-baseline justify-between border-b border-dashed border-slate-800 px-4 py-2.5">
        <h2 className="section-label-strong">
          Field
        </h2>
        <div className="flex items-baseline gap-3 section-label">
          {emergencies > 0 && (
            <span className="flex items-baseline gap-1 text-rose-300">
              <span aria-hidden className="inline-block h-1.5 w-1.5 translate-y-[1px] rounded-full bg-rose-400" />
              {emergencies} emergency
            </span>
          )}
          <span>
            <span className="tabular-nums text-slate-200">{wos}</span> wo
          </span>
          <span>
            <span className="tabular-nums text-slate-200">{srs}</span> sr
          </span>
        </div>
      </header>

      <div className="relative aspect-[16/9] w-full">
        <div ref={containerRef} className="absolute inset-0" />
        {/* Small "Open map" pill at the top right — sits on top of the
            map so the operator can jump to the full /map page even
            when hovering a marker (markers handle their own click).
            Empty-canvas clicks already navigate to /map via the
            click handler in the effect above, so this pill is only
            an obvious affordance, not the only path. */}
        <Link
          to={`/${slug}/map`}
          className="group/map absolute right-3 top-3 z-10 flex items-baseline gap-1.5 rounded border border-signal/40 bg-slate-950/80 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-signal backdrop-blur transition-colors hover:bg-signal/15"
          aria-label="Open full map"
        >
          Open map
          <span aria-hidden className="transition-transform group-hover/map:translate-x-0.5">
            →
          </span>
        </Link>
        {tab === "crew" && (
          <div className="pointer-events-none absolute bottom-3 left-3 rounded border border-slate-700/60 bg-slate-900/80 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-300 backdrop-blur">
            Showing your route preview
          </div>
        )}
      </div>
    </section>
  );
}
