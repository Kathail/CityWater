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
