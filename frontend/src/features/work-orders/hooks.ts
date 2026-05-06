import { useQuery } from "@tanstack/react-query";
import {
  type WorkOrderDetail,
  type WorkOrderListParams,
  type WorkOrderListResponse,
  type WorkOrderTemplate,
  getWorkOrder,
  listTemplates,
  listWorkOrders,
} from "./api";

export function useWorkOrders(params: WorkOrderListParams) {
  return useQuery<WorkOrderListResponse, Error>({
    queryKey: ["work-orders", params],
    queryFn: () => listWorkOrders(params),
    placeholderData: (prev) => prev,
  });
}

export function useWorkOrder(wo_number: string | undefined) {
  return useQuery<WorkOrderDetail, Error>({
    queryKey: ["work-order", wo_number],
    queryFn: () => getWorkOrder(wo_number!),
    enabled: !!wo_number,
  });
}

export function useTemplates() {
  return useQuery<WorkOrderTemplate[], Error>({
    queryKey: ["wo-templates"],
    queryFn: listTemplates,
    staleTime: 5 * 60 * 1000,
  });
}
