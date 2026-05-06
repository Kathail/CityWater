import { useQuery } from "@tanstack/react-query";
import {
  type InspectionListParams,
  type InspectionListResponse,
  type InspectionRead,
  getInspection,
  listInspections,
} from "./api";

export function useInspections(params: InspectionListParams) {
  return useQuery<InspectionListResponse, Error>({
    queryKey: ["inspections", params],
    queryFn: () => listInspections(params),
    placeholderData: (prev) => prev,
  });
}

export function useInspection(n: string | undefined) {
  return useQuery<InspectionRead, Error>({
    queryKey: ["inspection", n],
    queryFn: () => getInspection(n!),
    enabled: !!n,
  });
}
