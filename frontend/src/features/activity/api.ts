import { apiJson } from "../../lib/apiClient";

export type ActivityEntityType =
  | "work_order"
  | "inspection"
  | "service_request"
  | "schedule";

// ----- Comments -----

export interface CommentRead {
  id: number;
  entity_type: ActivityEntityType;
  entity_id: number;
  body: string;
  created_by: number | null;
  author_name: string | null;
  created_at: string;
  edited_at: string | null;
}

export interface CommentListResponse {
  items: CommentRead[];
}

export interface CommentCreateInput {
  entity_type: ActivityEntityType;
  entity_id: number;
  body: string;
}

export function listComments(
  entityType: ActivityEntityType,
  entityId: number,
): Promise<CommentListResponse> {
  const qs = new URLSearchParams({
    entity_type: entityType,
    entity_id: String(entityId),
  });
  return apiJson<CommentListResponse>(`/api/v1/comments?${qs.toString()}`);
}

export function createComment(input: CommentCreateInput): Promise<CommentRead> {
  return apiJson<CommentRead>("/api/v1/comments", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateComment(id: number, body: string): Promise<CommentRead> {
  return apiJson<CommentRead>(`/api/v1/comments/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ body }),
  });
}

export function deleteComment(id: number): Promise<void> {
  return apiJson<void>(`/api/v1/comments/${id}`, { method: "DELETE" });
}

// ----- History (audit log scoped to one entity) -----

export interface HistoryEvent {
  id: number;
  occurred_at: string;
  actor: string | null;
  actor_id: number | null;
  action: string;
  entity_type: string;
  entity_id: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface HistoryResponse {
  items: HistoryEvent[];
}

export function listHistory(
  entityType: ActivityEntityType,
  entityId: number,
): Promise<HistoryResponse> {
  const qs = new URLSearchParams({
    entity_type: entityType,
    entity_id: String(entityId),
  });
  return apiJson<HistoryResponse>(`/api/v1/history?${qs.toString()}`);
}
