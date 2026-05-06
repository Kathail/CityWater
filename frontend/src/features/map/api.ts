import { apiJson } from "../../lib/apiClient";

export interface TileLayerDescriptor {
  id: string;
  class_code: string;
  domain: "water" | "sewer" | "storm";
  name: string;
  geometry_type: "Point" | "LineString" | "Polygon";
  color: string | null;
  icon: string | null;
  source: string;
  source_layer: string;
  filter: unknown[];
}

export function listTileLayers(): Promise<TileLayerDescriptor[]> {
  return apiJson<TileLayerDescriptor[]>("/api/v1/tile-layers");
}

export interface WoFeatureProps {
  kind: "work_order";
  wo_number: string;
  title: string;
  category: string;
  priority: string;
  status: string;
  scheduled_for: string | null;
  due_by: string | null;
  asset_uid: string | null;
}

export interface SrFeatureProps {
  kind: "service_request";
  sr_number: string;
  category: string;
  domain: string;
  priority: string;
  status: string;
  reported_at: string | null;
  reported_address: string | null;
  asset_uid: string | null;
}

export interface MapOverlays {
  open_wos: GeoJSON.FeatureCollection<GeoJSON.Point, WoFeatureProps>;
  active_srs: GeoJSON.FeatureCollection<GeoJSON.Point, SrFeatureProps>;
}

export function getMapOverlays(): Promise<MapOverlays> {
  return apiJson<MapOverlays>("/api/v1/map/overlays");
}
