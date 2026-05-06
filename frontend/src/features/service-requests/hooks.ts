import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type DispatchInput,
  type ServiceRequestCreateInput,
  type ServiceRequestCreateResponse,
  type ServiceRequestListParams,
  type ServiceRequestListResponse,
  type ServiceRequestRead,
  type ServiceRequestUpdateInput,
  createServiceRequest,
  dispatchServiceRequest,
  getServiceRequest,
  listServiceRequests,
  updateServiceRequest,
} from "./api";

export const SR_LIST_KEY = "service-requests";
export const SR_DETAIL_KEY = "service-request";

export function useServiceRequests(params: ServiceRequestListParams) {
  return useQuery<ServiceRequestListResponse, Error>({
    queryKey: [SR_LIST_KEY, params],
    queryFn: () => listServiceRequests(params),
    placeholderData: (prev) => prev,
  });
}

export function useServiceRequest(sr_number: string | undefined) {
  return useQuery<ServiceRequestRead, Error>({
    queryKey: [SR_DETAIL_KEY, sr_number],
    queryFn: () => getServiceRequest(sr_number!),
    enabled: !!sr_number,
  });
}

export function useCreateServiceRequest() {
  const qc = useQueryClient();
  return useMutation<ServiceRequestCreateResponse, Error, ServiceRequestCreateInput>({
    mutationFn: createServiceRequest,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [SR_LIST_KEY] });
    },
  });
}

export function useUpdateServiceRequest(sr_number: string) {
  const qc = useQueryClient();
  return useMutation<ServiceRequestRead, Error, ServiceRequestUpdateInput>({
    mutationFn: (patch) => updateServiceRequest(sr_number, patch),
    onSuccess: (sr) => {
      qc.setQueryData([SR_DETAIL_KEY, sr_number], sr);
      qc.invalidateQueries({ queryKey: [SR_LIST_KEY] });
    },
  });
}

export function useDispatchServiceRequest(sr_number: string) {
  const qc = useQueryClient();
  return useMutation<ServiceRequestRead, Error, DispatchInput>({
    mutationFn: (input) => dispatchServiceRequest(sr_number, input),
    onSuccess: (sr) => {
      qc.setQueryData([SR_DETAIL_KEY, sr_number], sr);
      qc.invalidateQueries({ queryKey: [SR_LIST_KEY] });
      qc.invalidateQueries({ queryKey: ["work-orders"] });
    },
  });
}
