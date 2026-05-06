import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ActivityEntityType,
  type CommentCreateInput,
  type CommentListResponse,
  type CommentRead,
  type HistoryResponse,
  createComment,
  deleteComment,
  listComments,
  listHistory,
  updateComment,
} from "./api";

const commentsKey = (t: ActivityEntityType, id: number) =>
  ["comments", t, id] as const;
const historyKey = (t: ActivityEntityType, id: number) =>
  ["history", t, id] as const;

export function useComments(t: ActivityEntityType, id: number | undefined) {
  return useQuery<CommentListResponse, Error>({
    queryKey: commentsKey(t, id ?? 0),
    queryFn: () => listComments(t, id!),
    enabled: id !== undefined && id > 0,
  });
}

export function useHistory(t: ActivityEntityType, id: number | undefined) {
  return useQuery<HistoryResponse, Error>({
    queryKey: historyKey(t, id ?? 0),
    queryFn: () => listHistory(t, id!),
    enabled: id !== undefined && id > 0,
    refetchOnMount: true,
  });
}

export function useCreateComment(t: ActivityEntityType, id: number | undefined) {
  const qc = useQueryClient();
  return useMutation<CommentRead, Error, CommentCreateInput>({
    mutationFn: createComment,
    onSuccess: () => {
      if (id !== undefined) {
        qc.invalidateQueries({ queryKey: commentsKey(t, id) });
        qc.invalidateQueries({ queryKey: historyKey(t, id) });
      }
    },
  });
}

export function useUpdateComment(t: ActivityEntityType, id: number | undefined) {
  const qc = useQueryClient();
  return useMutation<CommentRead, Error, { commentId: number; body: string }>({
    mutationFn: ({ commentId, body }) => updateComment(commentId, body),
    onSuccess: () => {
      if (id !== undefined) qc.invalidateQueries({ queryKey: commentsKey(t, id) });
    },
  });
}

export function useDeleteComment(t: ActivityEntityType, id: number | undefined) {
  const qc = useQueryClient();
  return useMutation<void, Error, number>({
    mutationFn: deleteComment,
    onSuccess: () => {
      if (id !== undefined) {
        qc.invalidateQueries({ queryKey: commentsKey(t, id) });
        qc.invalidateQueries({ queryKey: historyKey(t, id) });
      }
    },
  });
}
