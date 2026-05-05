import { apiJson } from "../../lib/apiClient";

export interface AssetClassOut {
  code: string;
  domain: string;
  name: string;
  geometry_type: "Point" | "LineString" | "Polygon";
  attribute_schema: Record<string, unknown>;
  default_criticality: number | null;
  icon: string | null;
  color: string | null;
  is_active: boolean;
}

export type GeoJsonGeometry =
  | { type: "Point"; coordinates: [number, number] }
  | { type: "LineString"; coordinates: [number, number][] }
  | { type: "Polygon"; coordinates: [number, number][][] };

export interface AssetOut {
  asset_uid: string;
  class_code: string;
  domain: string;
  geometry: GeoJsonGeometry;
  install_date: string | null;
  decommission_date: string | null;
  material: string | null;
  diameter_mm: number | null;
  length_m: string | null;
  depth_m: string | null;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  warranty_until: string | null;
  condition: number | null;
  criticality: number | null;
  status: "active" | "abandoned" | "removed" | "proposed";
  attrs: Record<string, unknown>;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssetListResponse {
  items: AssetOut[];
  page: number;
  page_size: number;
  total: number;
}

export interface AssetCreateInput {
  class_code: string;
  asset_uid?: string;
  geometry: GeoJsonGeometry;
  material?: string | null;
  diameter_mm?: number | null;
  length_m?: number | string | null;
  depth_m?: number | string | null;
  manufacturer?: string | null;
  model?: string | null;
  serial_number?: string | null;
  install_date?: string | null;
  decommission_date?: string | null;
  warranty_until?: string | null;
  condition?: number | null;
  criticality?: number | null;
  status?: "active" | "abandoned" | "removed" | "proposed";
  attrs?: Record<string, unknown>;
  notes?: string | null;
}

export type AssetUpdateInput = Partial<AssetCreateInput> & {
  geometry?: GeoJsonGeometry;
};

export interface AssetListParams {
  class?: string;
  domain?: "water" | "sewer" | "storm";
  status?: "active" | "abandoned" | "removed" | "proposed";
  bbox?: string;
  q?: string;
  page?: number;
  page_size?: number;
}

export interface AssetHistoryItem {
  occurred_at: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  user_uid: string | null;
  user_full_name: string | null;
}

export interface AssetHistoryResponse {
  items: AssetHistoryItem[];
  page: number;
  page_size: number;
  total: number;
}

export function listAssetClasses(): Promise<AssetClassOut[]> {
  return apiJson<AssetClassOut[]>("/api/v1/asset-classes");
}

export function listAssets(params: AssetListParams = {}): Promise<AssetListResponse> {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") {
      search.set(k, String(v));
    }
  }
  const qs = search.toString();
  return apiJson<AssetListResponse>(`/api/v1/assets${qs ? `?${qs}` : ""}`);
}

export function getAsset(asset_uid: string): Promise<AssetOut> {
  return apiJson<AssetOut>(`/api/v1/assets/${encodeURIComponent(asset_uid)}`);
}

export function createAsset(input: AssetCreateInput): Promise<AssetOut> {
  return apiJson<AssetOut>("/api/v1/assets", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateAsset(asset_uid: string, input: AssetUpdateInput): Promise<AssetOut> {
  return apiJson<AssetOut>(`/api/v1/assets/${encodeURIComponent(asset_uid)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteAsset(asset_uid: string): Promise<void> {
  return apiJson<void>(`/api/v1/assets/${encodeURIComponent(asset_uid)}`, {
    method: "DELETE",
  });
}

export function getAssetHistory(asset_uid: string): Promise<AssetHistoryResponse> {
  return apiJson<AssetHistoryResponse>(`/api/v1/assets/${encodeURIComponent(asset_uid)}/history`);
}
