import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "../../lib/apiClient";
import { translateApiError } from "../../lib/translateApiError";
import { Logo } from "../../components/Logo";
import { login } from "./api";
import { ME_QUERY_KEY } from "./useAuth";

/**
 * Auto-login landing page for the public "Try the demo" CTA.
 *
 * Marketing site links here directly (citywater.ca → app.citywater.ca/demo)
 * so visitors skip the regular sign-in form. We POST the canned demo
 * credentials, navigate into the seeded tenant on success, and surface
 * a clear error + retry path on failure.
 *
 * Diagnostics:
 *  - The current step is rendered to the user so a hang is visible
 *    ("Authenticating…" stuck means the POST is the bottleneck).
 *  - A watchdog after 8s offers a "Try again" + "Sign in instead"
 *    escape hatch so visitors aren't stranded if the SW or backend
 *    misbehaves.
 *  - The whole flow is also `console.log`-traced so a screenshot of
 *    the devtools console makes triage trivial.
 */

const DEMO_LOGIN = {
  tenant_slug: "demo",
  email: "admin@demo.citywater.io",
  password: "DemoPassword123!",
};

type Step =
  | "starting"
  | "posting"
  | "navigating"
  | "done";

type Phase =
  | { kind: "loading"; step: Step }
  | { kind: "stalled"; step: Step }
  | { kind: "error"; message: string }
  | { kind: "done" };

const STALL_MS = 8_000;

const STEP_LABEL: Record<Step, string> = {
  starting: "Initialising…",
  posting: "Authenticating…",
  navigating: "Loading your dashboard…",
  done: "Ready.",
};

export function DemoLoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>({ kind: "loading", step: "starting" });
  const [retryToken, setRetryToken] = useState(0);
  const inFlightRef = useRef(false);

  // Watchdog: if loading hasn't progressed in STALL_MS, switch to a
  // "stalled" phase that exposes manual recovery.
  useEffect(() => {
    if (phase.kind !== "loading") return;
    const t = window.setTimeout(() => {
      setPhase((p) => (p.kind === "loading" ? { kind: "stalled", step: p.step } : p));
    }, STALL_MS);
    return () => window.clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    let cancelled = false;
    console.log("[demo] start", { token: retryToken });

    (async () => {
      try {
        setPhase({ kind: "loading", step: "posting" });
        console.log("[demo] POST /api/v1/auth/login");
        const data = await login(DEMO_LOGIN);
        if (cancelled) return;
        console.log("[demo] login ok", { slug: data.tenant.slug });
        setPhase({ kind: "loading", step: "navigating" });
        queryClient.setQueryData(ME_QUERY_KEY, data);
        navigate(`/${data.tenant.slug}/`, { replace: true });
        setPhase({ kind: "done" });
      } catch (err) {
        if (cancelled) return;
        console.error("[demo] login failed", err);
        const message =
          err instanceof ApiError && err.code === "bad_credentials"
            ? "Demo tenant isn't seeded yet. Reach out and we'll fix it."
            : translateApiError(err as Error);
        setPhase({ kind: "error", message });
      } finally {
        inFlightRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate, queryClient, retryToken]);

  function retry() {
    setPhase({ kind: "loading", step: "starting" });
    setRetryToken((n) => n + 1);
  }

  // Force-reset the service worker + caches and reload — last-resort
  // recovery for visitors stuck on a stale SW. Useful enough that we
  // expose it from the stalled UI even before things have outright
  // failed.
  async function hardReset() {
    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
    } catch (e) {
      console.warn("[demo] hard-reset partial", e);
    } finally {
      window.location.replace("/demo");
    }
  }

  const isLoading = phase.kind === "loading" || phase.kind === "stalled";
  const isStalled = phase.kind === "stalled";

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12 text-slate-100">
      <div className="w-full max-w-md space-y-6 rounded-lg border border-slate-800 bg-slate-900 p-6 text-center shadow-2xl shadow-blue-500/5 sm:p-8">
        <div className="flex flex-col items-center gap-3">
          <Logo size={56} />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-400">
              CityWater
            </p>
            <h1 className="text-xl font-semibold text-slate-100">
              {phase.kind === "error" ? "Couldn't load the demo" : "Loading the demo…"}
            </h1>
          </div>
        </div>

        {isLoading && (
          <div className="space-y-4">
            <p className="text-sm text-slate-400">
              Signing you into a sandbox tenant pre-loaded with 12 months of simulated work.
            </p>
            <div className="flex items-center justify-center gap-3">
              <div
                role="status"
                aria-label="Loading"
                className="h-6 w-6 animate-spin rounded-full border-2 border-slate-700 border-t-emerald-400"
              />
              <span className="text-xs uppercase tracking-wider text-slate-500">
                {STEP_LABEL[phase.step]}
              </span>
            </div>
            {isStalled && (
              <div className="space-y-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-left text-xs text-amber-100">
                <p>
                  This is taking longer than expected. The page may be running an outdated cached
                  version. Try:
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={retry}
                    className="flex-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 font-medium text-emerald-100 hover:bg-emerald-500/20"
                  >
                    Try again
                  </button>
                  <button
                    type="button"
                    onClick={hardReset}
                    className="flex-1 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 font-medium text-amber-100 hover:bg-amber-500/20"
                  >
                    Reset cache & reload
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {phase.kind === "error" && (
          <div className="space-y-3 text-left">
            <p className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {phase.message}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={retry}
                className="flex-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-100 transition-colors hover:border-emerald-400 hover:bg-emerald-500/20"
              >
                Try again
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
            href="mailto:contact@citywater.ca"
            className="text-blue-400 hover:text-blue-300 hover:underline"
          >
            contact@citywater.ca
          </a>
        </p>
      </div>
    </main>
  );
}
