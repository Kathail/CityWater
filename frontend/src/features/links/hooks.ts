import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type LinkCreateInput,
  type LinkEntityType,
  type LinkListResponse,
  type LinkRead,
  createLink,
  deleteLink,
  listLinks,
} from "./api";

export const linkQueryKey = (type: LinkEntityType, id: number) =>
  ["links", type, id] as const;

export function useLinks(type: LinkEntityType, id: number | undefined) {
  return useQuery<LinkListResponse, Error>({
    queryKey: linkQueryKey(type, id ?? 0),
    queryFn: () => listLinks(type, id!),
    enabled: id !== undefined && id > 0,
  });
}

export function useCreateLink(type: LinkEntityType, id: number | undefined) {
  const qc = useQueryClient();
  return useMutation<LinkRead, Error, LinkCreateInput>({
    mutationFn: createLink,
    onSuccess: (link) => {
      if (id !== undefined) {
        qc.invalidateQueries({ queryKey: linkQueryKey(type, id) });
      }
      // Also refresh the *target* entity's link list, so its detail page
      // would show the new link if open.
      qc.invalidateQueries({
        queryKey: linkQueryKey(link.target_type, link.target_id),
      });
    },
  });
}

export function useDeleteLink(type: LinkEntityType, id: number | undefined) {
  const qc = useQueryClient();
  return useMutation<void, Error, number>({
    mutationFn: deleteLink,
    onSuccess: () => {
      if (id !== undefined) {
        qc.invalidateQueries({ queryKey: linkQueryKey(type, id) });
      }
    },
  });
}
