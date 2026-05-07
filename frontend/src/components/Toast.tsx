import { useEffect, useState } from "react";

/**
 * Tiny toast-with-undo used in place of confirm dialogs for reversible
 * actions ("close this SR", "mark complete", "delete row"). The instant
 * feedback + a 4s window to undo is faster than a modal, less rude
 * than no confirmation, and matches what every modern app does.
 *
 * Module-level store rather than React context so the hook isn't
 * coupled to a provider — anywhere in the tree can call `showToast()`.
 * The single ToastHost mounted at the app root subscribes and renders.
 */

export interface Toast {
  id: number;
  message: string;
  /** When set, the toast renders an "Undo" button that calls this. The
   * caller is responsible for actually unwinding the action — typically
   * by holding off on the network commit until the toast expires, OR by
   * issuing a compensating mutation when undo is pressed. */
  undo?: () => void;
  /** Style. "info" is the default; "success" tints emerald. */
  tone?: "info" | "success" | "danger";
  /** Total time to live, ms. Default 4000. */
  ttl?: number;
}

type Listener = (toasts: Toast[]) => void;

let counter = 0;
let toasts: Toast[] = [];
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l(toasts);
}

export function showToast(toast: Omit<Toast, "id">): number {
  const id = ++counter;
  const t: Toast = { id, ttl: 4000, tone: "info", ...toast };
  toasts = [...toasts, t];
  emit();
  if (t.ttl) {
    window.setTimeout(() => dismissToast(id), t.ttl);
  }
  return id;
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

function useToasts(): Toast[] {
  const [snapshot, setSnapshot] = useState<Toast[]>(toasts);
  useEffect(() => {
    const l: Listener = (next) => setSnapshot(next);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return snapshot;
}

const TONE_CLASSES: Record<NonNullable<Toast["tone"]>, string> = {
  info: "border-slate-700 bg-slate-900 text-slate-100",
  success: "border-emerald-500/40 bg-emerald-950/80 text-emerald-100",
  danger: "border-red-500/40 bg-red-950/80 text-red-100",
};

export function ToastHost() {
  const items = useToasts();
  if (items.length === 0) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2 sm:bottom-6 sm:right-6"
    >
      {items.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-center gap-3 rounded-md border px-3 py-2 text-sm shadow-lg ${TONE_CLASSES[t.tone ?? "info"]}`}
        >
          <span className="flex-1">{t.message}</span>
          {t.undo && (
            <button
              type="button"
              onClick={() => {
                t.undo?.();
                dismissToast(t.id);
              }}
              className="rounded border border-current/40 px-2 py-0.5 text-xs font-medium hover:bg-white/5"
            >
              Undo
            </button>
          )}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismissToast(t.id)}
            className="text-slate-400 hover:text-slate-200"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
