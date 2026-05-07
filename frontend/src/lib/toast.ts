import { useEffect, useState } from "react";

/**
 * Module-level toast store. Anywhere in the tree can call `showToast()`
 * — there's no React provider to wire up. The single ToastHost mounted
 * at the app root subscribes to the store and renders.
 *
 * Used in place of confirm dialogs for reversible actions ("close this
 * SR", "mark complete"). Instant feedback + a 4s window to undo is
 * faster than a modal, less rude than no confirmation, and matches
 * what every modern app does.
 */

export interface Toast {
  id: number;
  message: string;
  /** When set, the toast renders an "Undo" button that calls this. The
   * caller is responsible for actually unwinding the action — typically
   * by deferring the network commit until the toast expires (cleanest)
   * OR by firing a compensating mutation on undo. */
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

export function useToasts(): Toast[] {
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
