import { apiJson } from "../../lib/apiClient";

export type LinkEntityType = "work_order" | "inspection" | "service_request";
export type LinkKind = "parent_of" | "related" | "caused_by";

export interface LinkRead {
  id: number;
  source_type: LinkEntityType;
  source_id: number;
  target_type: LinkEntityType;
  target_id: number;
  kind: LinkKind;
  note: string | null;
  created_by: number | null;
  created_at: string;
  source_ref: string | null;
  target_ref: string | null;
}

export interface LinkListResponse {
  items: LinkRead[];
}

export interface LinkCreateInput {
  source_type: LinkEntityType;
  source_id: number;
  target_type: LinkEntityType;
  target_id: number;
  kind?: LinkKind;
  note?: string;
}

export function listLinks(
  entityType: LinkEntityType,
  entityId: number,
): Promise<LinkListResponse> {
  const qs = new URLSearchParams({
    entity_type: entityType,
    entity_id: String(entityId),
  });
  return apiJson<LinkListResponse>(`/api/v1/links?${qs.toString()}`);
}

export function createLink(input: LinkCreateInput): Promise<LinkRead> {
  return apiJson<LinkRead>("/api/v1/links", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteLink(id: number): Promise<void> {
  return apiJson<void>(`/api/v1/links/${id}`, { method: "DELETE" });
}
