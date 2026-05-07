import type { PillTone } from "../../components/StatusPill";
import type { WoPriority, WoStatus } from "./api";

/**
 * Status / priority → StatusPill tone mapping for work orders.
 *
 * One source of truth so the WO list, detail page, kanban board,
 * dashboard "today's queue", and any future surface all agree on the
 * colour of "in progress" or "high".
 */

export const WO_STATUS_TONE: Record<WoStatus, PillTone> = {
  draft: "muted",
  open: "info",
  assigned: "info",
  in_progress: "info",
  on_hold: "warning",
  completed: "success",
  cancelled: "neutral",
};

export const WO_PRIORITY_TONE: Record<WoPriority, PillTone> = {
  low: "muted",
  normal: "neutral",
  high: "warning",
  emergency: "danger",
};

/**
 * Allowed status transitions, byte-equivalent to backend
 * `app/services/wo_state.py:TRANSITIONS`. Both the detail page's
 * "Move to…" buttons and the list page's row-action quick actions
 * use this so we never offer a transition the API would reject.
 */
export const WO_TRANSITIONS: Record<WoStatus, WoStatus[]> = {
  draft: ["open", "cancelled"],
  open: ["assigned", "on_hold", "cancelled"],
  assigned: ["in_progress", "on_hold", "cancelled"],
  in_progress: ["completed", "on_hold"],
  on_hold: ["open", "assigned", "in_progress", "cancelled"],
  completed: [],
  cancelled: [],
};

export function canTransition(from: WoStatus, to: WoStatus): boolean {
  return WO_TRANSITIONS[from]?.includes(to) ?? false;
}
