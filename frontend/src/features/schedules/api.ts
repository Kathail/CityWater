import { apiJson } from "../../lib/apiClient";

export type ScheduleKind = "work_order" | "inspection";

export interface ScheduleRead {
  id: number;
  name: string;
  description: string | null;
  kind: ScheduleKind;
  rrule: string;
  spec: Record<string, unknown>;
  asset_id: number | null;
  asset_uid: string | null;
  next_run_at: string | null;
  last_run_at: string | null;
  active: boolean;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface ScheduleListResponse {
  items: ScheduleRead[];
}

export interface ScheduleCreateInput {
  name: string;
  description?: string;
  kind: ScheduleKind;
  rrule: string;
  spec?: Record<string, unknown>;
  asset_uid?: string;
  next_run_at?: string;
  active?: boolean;
}

export interface ScheduleUpdateInput {
  name?: string;
  description?: string;
  rrule?: string;
  spec?: Record<string, unknown>;
  asset_uid?: string;
  next_run_at?: string;
  active?: boolean;
}

export interface ScheduleTickResponse {
  fired: number;
  schedules_processed: number;
  instances: string[];
}

export function listSchedules(): Promise<ScheduleListResponse> {
  return apiJson<ScheduleListResponse>("/api/v1/schedules");
}

export function getSchedule(id: number): Promise<ScheduleRead> {
  return apiJson<ScheduleRead>(`/api/v1/schedules/${id}`);
}

export function createSchedule(input: ScheduleCreateInput): Promise<ScheduleRead> {
  return apiJson<ScheduleRead>("/api/v1/schedules", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateSchedule(
  id: number,
  patch: ScheduleUpdateInput,
): Promise<ScheduleRead> {
  return apiJson<ScheduleRead>(`/api/v1/schedules/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteSchedule(id: number): Promise<void> {
  return apiJson<void>(`/api/v1/schedules/${id}`, { method: "DELETE" });
}

export function tickSchedules(): Promise<ScheduleTickResponse> {
  return apiJson<ScheduleTickResponse>("/api/v1/schedules/tick", { method: "POST" });
}
