import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ScheduleCreateInput,
  type ScheduleListResponse,
  type ScheduleRead,
  type ScheduleTickResponse,
  type ScheduleUpdateInput,
  createSchedule,
  deleteSchedule,
  listSchedules,
  tickSchedules,
  updateSchedule,
} from "./api";

const KEY = "schedules";

export function useSchedules() {
  return useQuery<ScheduleListResponse, Error>({
    queryKey: [KEY],
    queryFn: listSchedules,
  });
}

export function useCreateSchedule() {
  const qc = useQueryClient();
  return useMutation<ScheduleRead, Error, ScheduleCreateInput>({
    mutationFn: createSchedule,
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useUpdateSchedule(id: number) {
  const qc = useQueryClient();
  return useMutation<ScheduleRead, Error, ScheduleUpdateInput>({
    mutationFn: (patch) => updateSchedule(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useDeleteSchedule() {
  const qc = useQueryClient();
  return useMutation<void, Error, number>({
    mutationFn: deleteSchedule,
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useTickSchedules() {
  const qc = useQueryClient();
  return useMutation<ScheduleTickResponse, Error>({
    mutationFn: tickSchedules,
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}
