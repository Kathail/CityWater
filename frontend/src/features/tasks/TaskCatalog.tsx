import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ErrorState, LoadingState } from "../../components/States";
import { StatusPill as SharedStatusPill, type PillTone } from "../../components/StatusPill";
import { type TaskListResponse, listTaskDefinitions } from "./api";

/**
 * Read-only catalog of task definitions for admins. Editing is via API
 * for now; visual editor lands later.
 */

export function TaskCatalog() {
  const { slug } = useParams<{ slug: string }>();
  const query = useQuery<TaskListResponse, Error>({
    queryKey: ["task-definitions"],
    queryFn: () => listTaskDefinitions(),
  });

  return (
    <div className="p-8 space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-slate-100">Task definitions</h1>
        <p className="mt-1 text-sm text-slate-400">
          Forms, procedures, and completion contracts for every kind of operator work. Editing is
          API-only for now — a visual editor lands in a follow-up release.
        </p>
      </header>

      {query.isLoading && <LoadingState />}
      {query.isError && (
        <ErrorState message="Failed to load task definitions." retry={() => query.refetch()} />
      )}

      {query.data && (
        <div className="surface overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-950/40 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2">Produces</th>
                <th className="px-3 py-2">Domain</th>
                <th className="px-3 py-2">Version</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {query.data.items.map((td) => (
                <tr key={td.id}>
                  <td className="px-3 py-2 font-mono text-xs text-slate-300">
                    <Link
                      to={`/${slug}/admin/task-definitions/${td.code}`}
                      className="hover:text-blue-300 hover:underline"
                    >
                      {td.code}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-100">{td.title}</td>
                  <td className="px-3 py-2 text-slate-300">{td.produces}</td>
                  <td className="px-3 py-2 text-slate-300">{td.default_domain ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-400">v{td.version}</td>
                  <td className="px-3 py-2">
                    <StatusPill status={td.status} />
                  </td>
                </tr>
              ))}
              {query.data.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-sm text-slate-500">
                    No task definitions yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const TASK_STATUS_TONE: Record<string, PillTone> = {
  draft: "muted",
  active: "success",
  archived: "neutral",
};

function StatusPill({ status }: { status: string }) {
  return <SharedStatusPill tone={TASK_STATUS_TONE[status] ?? "muted"}>{status}</SharedStatusPill>;
}
