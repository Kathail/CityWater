import { apiJson } from "../../lib/apiClient";

export type InspectionKind =
  | "cctv"
  | "hydrant_flow"
  | "valve_exercise"
  | "manhole"
  | "catch_basin"
  | "lift_station_round";

export interface InspectionRead {
  id: number;
  inspection_number: string;
  kind: InspectionKind;
  asset_uid: string | null;
  work_order_number: string | null;
  performed_at: string;
  performed_by: number | null;
  overall_condition: number | null;
  pass: boolean | null;
  notes: string | null;
  data: Record<string, unknown>;
  attrs: Record<string, unknown>;
  task_definition_code: string | null;
  task_data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface InspectionListResponse {
  items: InspectionRead[];
  page: number;
  page_size: number;
  total: number;
}

export interface InspectionListParams {
  kind?: InspectionKind;
  asset_uid?: string;
  work_order?: string;
  performed_after?: string;
  performed_before?: string;
  pass?: "true" | "false";
  q?: string;
  page?: number;
  page_size?: number;
}

export interface InspectionCreateInput {
  kind: InspectionKind;
  asset_uid?: string;
  work_order_number?: string;
  performed_at: string;
  overall_condition?: number;
  pass?: boolean;
  notes?: string;
  data: Record<string, unknown>;
}

export function listInspections(
  params: InspectionListParams = {},
): Promise<InspectionListResponse> {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") search.set(k, String(v));
  }
  const qs = search.toString();
  return apiJson<InspectionListResponse>(`/api/v1/inspections${qs ? `?${qs}` : ""}`);
}

export function getInspection(n: string): Promise<InspectionRead> {
  return apiJson<InspectionRead>(`/api/v1/inspections/${encodeURIComponent(n)}`);
}

export function createInspection(input: InspectionCreateInput): Promise<InspectionRead> {
  return apiJson<InspectionRead>("/api/v1/inspections", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateInspection(
  n: string,
  patch: Partial<
    Pick<InspectionCreateInput, "performed_at" | "overall_condition" | "pass" | "notes" | "data">
  > & { task_data?: Record<string, unknown> },
): Promise<InspectionRead> {
  return apiJson<InspectionRead>(`/api/v1/inspections/${encodeURIComponent(n)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function exportInspectionsUrl(kind?: InspectionKind): string {
  const params = new URLSearchParams({ format: "csv" });
  if (kind) params.set("kind", kind);
  return `/api/v1/inspections/export?${params.toString()}`;
}

export interface PacpCode {
  code: string;
  description: string;
  group: "structural" | "om" | "construction" | "miscellaneous";
  is_structural: boolean;
  is_om: boolean;
  default_severity: number | null;
  is_active: boolean;
}

export function listPacpCodes(): Promise<PacpCode[]> {
  return apiJson<PacpCode[]>("/api/v1/pacp-codes");
}

export function importPacp(
  file: File,
  options: { asset_uid?: string; work_order_number?: string } = {},
): Promise<InspectionRead> {
  const fd = new FormData();
  fd.append("file", file);
  if (options.asset_uid) fd.append("asset_uid", options.asset_uid);
  if (options.work_order_number) fd.append("work_order_number", options.work_order_number);
  return apiJson<InspectionRead>("/api/v1/inspections/import-pacp", {
    method: "POST",
    body: fd,
  });
}
