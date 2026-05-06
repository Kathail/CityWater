import { apiJson } from "../../lib/apiClient";

export type WoStatus =
  | "draft"
  | "open"
  | "assigned"
  | "in_progress"
  | "on_hold"
  | "completed"
  | "cancelled";

export type WoPriority = "low" | "normal" | "high" | "emergency";

export type WoType = "planned" | "reactive";

export type WoCategory =
  | "main_break"
  | "flushing"
  | "valve_exercise"
  | "cleaning"
  | "inspection"
  | "repair"
  | "install"
  | "other";

export interface WorkOrderListItem {
  wo_number: string;
  type: WoType;
  category: WoCategory;
  priority: WoPriority;
  status: WoStatus;
  title: string;
  asset_uid: string | null;
  assigned_to: number | null;
  crew_id: number | null;
  due_by: string | null;
  created_at: string;
}

export interface WorkOrderListResponse {
  items: WorkOrderListItem[];
  page: number;
  page_size: number;
  total: number;
}

export interface Task {
  id: number;
  sequence: number;
  title: string;
  description: string | null;
  is_complete: boolean;
  completed_at: string | null;
}

export interface TimeLog {
  id: number;
  user_id: number;
  started_at: string;
  ended_at: string;
  hours_decimal: string;
  notes: string | null;
}

export interface Material {
  id: number;
  material_code: string | null;
  description: string;
  quantity: string;
  unit: string | null;
  unit_cost: string | null;
}

export interface Attachment {
  id: number;
  kind: "photo" | "doc" | "sketch";
  s3_key: string;
  content_type: string;
  original_filename: string;
  size_bytes: number;
  taken_at: string | null;
}

export interface WorkOrderDetail extends WorkOrderListItem {
  description: string | null;
  location: Record<string, unknown> | null;
  template_id: number | null;
  scheduled_for: string | null;
  started_at: string | null;
  completed_at: string | null;
  reported_by: number | null;
  resolution: string | null;
  attrs: Record<string, unknown>;
  updated_at: string;
  tasks: Task[];
  time_logs: TimeLog[];
  materials: Material[];
  attachments: Attachment[];
  materials_total: string | null;
}

export interface WorkOrderListParams {
  status?: WoStatus;
  assigned_to?: string;
  crew_id?: number;
  asset_uid?: string;
  q?: string;
  page?: number;
  page_size?: number;
}

export interface WorkOrderCreateInput {
  title: string;
  type?: WoType;
  category?: WoCategory;
  priority?: WoPriority;
  description?: string;
  asset_uid?: string;
  from_template_id?: number;
  due_by?: string;
  assigned_to?: number;
  crew_id?: number;
}

export interface WorkOrderTemplate {
  id: number;
  name: string;
  category: WoCategory;
  default_priority: WoPriority;
  applies_to_classes: string[];
  task_template: { title?: string; description?: string; sequence?: number }[];
  instructions: string | null;
}

export function listWorkOrders(params: WorkOrderListParams = {}): Promise<WorkOrderListResponse> {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") search.set(k, String(v));
  }
  const qs = search.toString();
  return apiJson<WorkOrderListResponse>(`/api/v1/work-orders${qs ? `?${qs}` : ""}`);
}

export function getWorkOrder(wo_number: string): Promise<WorkOrderDetail> {
  return apiJson<WorkOrderDetail>(`/api/v1/work-orders/${encodeURIComponent(wo_number)}`);
}

export function createWorkOrder(input: WorkOrderCreateInput): Promise<WorkOrderDetail> {
  return apiJson<WorkOrderDetail>("/api/v1/work-orders", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateWorkOrder(
  wo_number: string,
  input: Partial<WorkOrderCreateInput> & { resolution?: string | null },
): Promise<WorkOrderDetail> {
  return apiJson<WorkOrderDetail>(`/api/v1/work-orders/${encodeURIComponent(wo_number)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function transitionWorkOrder(
  wo_number: string,
  to: WoStatus,
  note?: string,
): Promise<WorkOrderDetail> {
  return apiJson<WorkOrderDetail>(
    `/api/v1/work-orders/${encodeURIComponent(wo_number)}/transition`,
    { method: "POST", body: JSON.stringify({ to, note }) },
  );
}

export function addTask(wo_number: string, title: string): Promise<Task> {
  return apiJson<Task>(`/api/v1/work-orders/${encodeURIComponent(wo_number)}/tasks`, {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

export function updateTask(
  wo_number: string,
  task_id: number,
  patch: Partial<Task>,
): Promise<Task> {
  return apiJson<Task>(`/api/v1/work-orders/${encodeURIComponent(wo_number)}/tasks/${task_id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function logTime(
  wo_number: string,
  input: { started_at: string; ended_at: string; notes?: string },
): Promise<TimeLog> {
  return apiJson<TimeLog>(`/api/v1/work-orders/${encodeURIComponent(wo_number)}/time`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function logMaterial(
  wo_number: string,
  input: {
    description: string;
    quantity: string;
    unit?: string;
    unit_cost?: string;
    material_code?: string;
  },
): Promise<Material> {
  return apiJson<Material>(`/api/v1/work-orders/${encodeURIComponent(wo_number)}/materials`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function uploadAttachment(
  wo_number: string,
  file: File,
  kind: "photo" | "doc" | "sketch" = "doc",
): Promise<Attachment> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("kind", kind);
  return apiJson<Attachment>(`/api/v1/work-orders/${encodeURIComponent(wo_number)}/attachments`, {
    method: "POST",
    body: fd,
  });
}

export function listTemplates(): Promise<WorkOrderTemplate[]> {
  return apiJson<WorkOrderTemplate[]>("/api/v1/wo-templates");
}
