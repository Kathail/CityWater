import { apiJson } from "../../lib/apiClient";

export interface DashboardWoKpis {
  open: number;
  in_progress: number;
  overdue: number;
  stale_open: number;
  completed_this_week: number;
  stops_completed_this_week: number;
  hours_this_week: number;
  completion_rate_30d: number | null;
  avg_close_hours_30d: number | null;
}

export interface DashboardSrKpis {
  new: number;
  triaged: number;
  dispatched: number;
  closed_this_week: number;
  avg_resolution_hours_30d: number | null;
}

export interface DashboardQueueItem {
  wo_number: string;
  title: string;
  category: string;
  priority: string;
  status: string;
  scheduled_for: string | null;
  due_by: string | null;
  is_overdue: boolean;
  asset_total: number;
  asset_done: number;
}

export interface DashboardActivityItem {
  kind: "comment" | "transition";
  occurred_at: string;
  entity_type: string;
  // Human-readable code (wo_number / sr_number / inspection_number).
  // Backend resolves the internal id → code; null when the row is
  // soft-deleted or otherwise no longer reachable.
  entity_code: string | null;
  summary: string;
}

export interface DashboardCategoryBucket {
  category: string;
  count: number;
}

export interface DashboardPriorityBucket {
  priority: string;
  count: number;
}

export interface DashboardThroughputDay {
  date: string;
  completed: number;
}

export interface DashboardAreaRow {
  id: number;
  code: string;
  name: string;
  kind: "maintenance" | "water_system" | "sewer_system" | "storm_system";
  color: string | null;
  active_wos: number;
  overdue_wos: number;
  active_srs: number;
}

export interface DashboardResponse {
  wo_kpis: DashboardWoKpis;
  sr_kpis: DashboardSrKpis;
  today_queue: DashboardQueueItem[];
  recent_activity: DashboardActivityItem[];
  wo_by_category_30d: DashboardCategoryBucket[];
  sr_by_priority_30d: DashboardPriorityBucket[];
  throughput_7d: DashboardThroughputDay[];
  by_area: DashboardAreaRow[];
}

export function getDashboard(): Promise<DashboardResponse> {
  return apiJson<DashboardResponse>("/api/v1/dashboard");
}
