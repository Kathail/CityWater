import { useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "../../lib/apiClient";
import { translateApiError } from "../../lib/translateApiError";
import { Logo } from "../../components/Logo";
import { login, type AuthEnvelope } from "./api";
import { ME_QUERY_KEY } from "./useAuth";

/**
 * Auto-login landing page for the public "Try the demo" CTA.
 *
 * Marketing site links here directly (citywater.ca → app.citywater.ca/demo)
 * so visitors skip the regular sign-in form. We POST the canned demo
 * credentials, navigate into the seeded tenant on success, and surface
 * a clear error + retry path on failure.
 *
 * Same demo creds that LoginPage.tsx uses for its in-form button.
 */

const DEMO_LOGIN = {
  tenant_slug: "demo",
  email: "admin@demo.citywater.io",
  password: "DemoPassword123!",
};

export function DemoLoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const startedRef = useRef(false);

  const demoMutation = useMutation<AuthEnvelope, Error>({
    mutationFn: () => login(DEMO_LOGIN),
    onSuccess: (data) => {
      queryClient.setQueryData(ME_QUERY_KEY, data);
      navigate(`/${data.tenant.slug}/`, { replace: true });
    },
  });

  // Fire once on mount. Strict-mode double-invocation in dev would
  // otherwise hit the rate limiter on the demo login endpoint.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    demoMutation.mutate();
  }, [demoMutation]);

  const friendlyError =
    demoMutation.error instanceof ApiError && demoMutation.error.code === "bad_credentials"
      ? "Demo tenant isn't seeded yet. Reach out and I'll fix that."
      : demoMutation.error
        ? translateApiError(demoMutation.error)
        : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
      <div className="w-full max-w-md space-y-6 rounded-lg border border-slate-800 bg-slate-900 p-8 text-center shadow-2xl shadow-blue-500/5">
        <div className="flex flex-col items-center gap-3">
          <Logo size={56} />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-400">
              CityWater
            </p>
            <h1 className="text-xl font-semibold text-slate-100">Loading the demo…</h1>
          </div>
        </div>

        {!demoMutation.isError ? (
          <p className="text-sm text-slate-400">
            Signing you into a sandbox tenant pre-loaded with 12 months of simulated work.
          </p>
        ) : (
          <div className="space-y-3 text-left">
            <p className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {friendlyError}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  startedRef.current = false;
                  demoMutation.reset();
                  startedRef.current = true;
                  demoMutation.mutate();
                }}
                disabled={demoMutation.isPending}
                className="flex-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-100 transition-colors hover:border-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50"
              >
                {demoMutation.isPending ? "Retrying…" : "Try again"}
              </button>
              <Link
                to="/login"
                className="flex-1 rounded-md border border-slate-700 bg-slate-800/40 px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:border-slate-600 hover:bg-slate-800"
              >
                Sign in instead
              </Link>
            </div>
          </div>
        )}

        <p className="text-xs text-slate-500">
          Questions?{" "}
          <a
            href="mailto:klc.cahill@gmail.com"
            className="text-blue-400 hover:text-blue-300 hover:underline"
          >
            klc.cahill@gmail.com
          </a>
        </p>
      </div>
    </main>
  );
}
