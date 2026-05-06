import { useQuery } from "@tanstack/react-query";
import {
  type ReportCatalogEntry,
  type ReportPayload,
  listReports,
  runReport,
} from "./api";

export function useReportCatalog() {
  return useQuery<ReportCatalogEntry[], Error>({
    queryKey: ["reports", "catalog"],
    queryFn: listReports,
  });
}

export function useReport(slug: string | undefined, params: Record<string, string>) {
  return useQuery<ReportPayload, Error>({
    queryKey: ["reports", slug, params],
    queryFn: () => runReport(slug!, params),
    enabled: !!slug,
  });
}
