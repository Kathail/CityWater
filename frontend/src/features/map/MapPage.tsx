import { useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MapLibreMap, type MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useTileLayers } from "./hooks";
import { LayerPanel } from "./LayerPanel";
import type { BasemapId } from "./basemap";
import { AssetSidePanel, type ClickedFeature } from "./AssetSidePanel";
import { MapContextMenu } from "./MapContextMenu";
import { AddAssetDialog } from "./AddAssetDialog";

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

  const [basemap, setBasemap] = useState<BasemapId>("osm");
  const [visibleClasses, setVisibleClasses] = useState<Set<string>>(new Set());
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

  // Bind click + contextmenu handlers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onClick = (e: MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, {
        filter: ["has", "asset_uid"],
      });
      if (features.length > 0) {
        const f = features[0];
        const props = f.properties ?? {};
        setSelected({
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
    return () => {
      map.off("click", onClick);
      map.off("contextmenu", onContext);
    };
  }, []);

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
      />
      <div className="relative flex-1">
        <div ref={containerRef} className="absolute inset-0" data-testid="map-container" />
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
