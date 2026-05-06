import { apiJson } from "../../lib/apiClient";

export type SrCategory =
  | "low_pressure"
  | "no_water"
  | "sewer_backup"
  | "flooding"
  | "odour"
  | "damaged_asset"
  | "other";

export type SrDomain = "water" | "sewer" | "storm";
export type SrStatus = "new" | "triaged" | "dispatched" | "closed" | "duplicate";
export type SrPriority = "low" | "normal" | "high" | "emergency";
export type SrClosureReason =
  | "resolved"
  | "duplicate"
  | "no_action"
  | "false_alarm"
  | "deferred";

export interface ServiceRequestRead {
  sr_number: string;
  category: SrCategory;
  domain: SrDomain;
  status: SrStatus;
  priority: SrPriority;
  reported_at: string;
  caller_name: string | null;
  caller_phone: string | null;
  caller_email: string | null;
  address: string | null;
  location: { type: "Point"; coordinates: [number, number] } | null;
  description: string | null;
  intake_user_id: number | null;
  work_order_id: number | null;
  work_order_number: string | null;
  closed_at: string | null;
  closure_notes: string | null;
  closure_reason: SrClosureReason | null;
  duplicate_of_sr_number: string | null;
  attrs: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DuplicateCandidate {
  sr_number: string;
  reported_at: string;
  distance_m: number;
  status: SrStatus;
  category: SrCategory;
  description: string | null;
}

export interface ServiceRequestListItem {
  sr_number: string;
  category: SrCategory;
  domain: SrDomain;
  status: SrStatus;
  priority: SrPriority;
  reported_at: string;
  caller_name: string | null;
  address: string | null;
  work_order_number: string | null;
  created_at: string;
}

export interface ServiceRequestListResponse {
  items: ServiceRequestListItem[];
  page: number;
  page_size: number;
  total: number;
}

export interface ServiceRequestListParams {
  status?: SrStatus;
  category?: SrCategory;
  domain?: SrDomain;
  since?: string;
  q?: string;
  page?: number;
  page_size?: number;
}

export interface ServiceRequestCreateInput {
  category: SrCategory;
  domain: SrDomain;
  priority?: SrPriority;
  caller_name?: string;
  caller_phone?: string;
  caller_email?: string;
  address?: string;
  location?: { type: "Point"; coordinates: [number, number] };
  description?: string;
  reported_at?: string;
}

export interface ServiceRequestCreateResponse {
  service_request: ServiceRequestRead;
  duplicates: DuplicateCandidate[];
}

export interface ServiceRequestUpdateInput {
  category?: SrCategory;
  domain?: SrDomain;
  priority?: SrPriority;
  status?: Exclude<SrStatus, "dispatched">;
  caller_name?: string | null;
  caller_phone?: string | null;
  caller_email?: string | null;
  address?: string | null;
  location?: { type: "Point"; coordinates: [number, number] } | null;
  description?: string | null;
  closure_notes?: string | null;
  closure_reason?: SrClosureReason | null;
  duplicate_of_sr_number?: string | null;
}

export interface DispatchInput {
  work_order: {
    title: string;
    description?: string;
    category?:
      | "main_break"
      | "flushing"
      | "valve_exercise"
      | "cleaning"
      | "inspection"
      | "repair"
      | "install"
      | "other";
    priority?: SrPriority;
    asset_uid?: string;
    assigned_to?: number;
    crew_id?: number;
    scheduled_for?: string;
    due_by?: string;
  };
}

export function listServiceRequests(
  params: ServiceRequestListParams = {},
): Promise<ServiceRequestListResponse> {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") search.set(k, String(v));
  }
  const qs = search.toString();
  return apiJson<ServiceRequestListResponse>(
    `/api/v1/service-requests${qs ? `?${qs}` : ""}`,
  );
}

export function getServiceRequest(sr_number: string): Promise<ServiceRequestRead> {
  return apiJson<ServiceRequestRead>(
    `/api/v1/service-requests/${encodeURIComponent(sr_number)}`,
  );
}

export function createServiceRequest(
  input: ServiceRequestCreateInput,
): Promise<ServiceRequestCreateResponse> {
  return apiJson<ServiceRequestCreateResponse>("/api/v1/service-requests", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateServiceRequest(
  sr_number: string,
  patch: ServiceRequestUpdateInput,
): Promise<ServiceRequestRead> {
  return apiJson<ServiceRequestRead>(
    `/api/v1/service-requests/${encodeURIComponent(sr_number)}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch),
    },
  );
}

export function dispatchServiceRequest(
  sr_number: string,
  input: DispatchInput,
): Promise<ServiceRequestRead> {
  return apiJson<ServiceRequestRead>(
    `/api/v1/service-requests/${encodeURIComponent(sr_number)}/dispatch`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}
