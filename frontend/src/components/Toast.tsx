import { dismissToast, useToasts, type Toast } from "../lib/toast";

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
