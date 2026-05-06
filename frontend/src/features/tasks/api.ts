import { apiJson } from "../../lib/apiClient";

export type Produces = "work_order" | "inspection" | "service_request";
export type TaskStatus = "draft" | "active" | "archived";

export interface FormFieldChoice {
  value: string;
  label: string;
}

export interface FormField {
  id: string;
  type:
    | "boolean"
    | "number"
    | "text"
    | "textarea"
    | "choice"
    | "multi_choice"
    | "asset_pick"
    | "datetime"
    | "duration"
    | "photo"
    | "signature";
  label: string;
  default?: unknown;
  show_if?: string;
  required_for_complete?: boolean;
  read_only?: boolean;
  help?: string;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  choices?: FormFieldChoice[];
  asset_class?: string;
  near_meters?: number;
  default_from?: string;
}

export interface ProcedureStep {
  n: number;
  title: string;
  detail?: string;
  auto_complete_when?: string;
}

export interface Procedure {
  preconditions?: string[];
  ppe?: string[];
  tools_materials?: { item: string; qty: number }[];
  steps?: ProcedureStep[];
  post_actions?: string[];
  regulatory?: { jurisdiction: string; ref: string }[];
}

export interface TaskDefinitionBrief {
  id: number;
  code: string;
  version: number;
  status: TaskStatus;
  title: string;
  summary: string | null;
  produces: Produces;
  default_category: string | null;
  default_priority: string | null;
  default_domain: string | null;
  applies_to_classes: string[];
  created_at: string;
  updated_at: string;
}

export interface TaskDefinitionRead extends TaskDefinitionBrief {
  triggers: Record<string, unknown>[];
  prefill: Record<string, unknown>;
  form: FormField[];
  canned_comments: string[];
  procedure: Procedure;
  completion: Record<string, unknown>;
  spawns: Record<string, unknown>[];
  clocks: Record<string, unknown>[];
  lang: string;
}

export interface TaskListResponse {
  items: TaskDefinitionBrief[];
}

export interface ValidateResponse {
  is_valid: boolean;
  is_complete: boolean;
  field_errors: Record<string, string>;
  unmet_requirements: string[];
}

export function listTaskDefinitions(params: {
  status?: TaskStatus;
  domain?: string;
  cls?: string;
  q?: string;
} = {}): Promise<TaskListResponse> {
  const search = new URLSearchParams();
  if (params.status) search.set("status", params.status);
  if (params.domain) search.set("domain", params.domain);
  if (params.cls) search.set("class", params.cls);
  if (params.q) search.set("q", params.q);
  const qs = search.toString();
  return apiJson<TaskListResponse>(
    `/api/v1/task-definitions${qs ? `?${qs}` : ""}`,
  );
}

export function getTaskDefinition(code: string): Promise<TaskDefinitionRead> {
  return apiJson<TaskDefinitionRead>(
    `/api/v1/task-definitions/${encodeURIComponent(code)}`,
  );
}

export function validateTaskData(
  code: string,
  task_data: Record<string, unknown>,
  entity_ctx: Record<string, unknown> = {},
): Promise<ValidateResponse> {
  return apiJson<ValidateResponse>(
    `/api/v1/task-definitions/${encodeURIComponent(code)}/validate`,
    {
      method: "POST",
      body: JSON.stringify({ task_data, entity_ctx }),
    },
  );
}
