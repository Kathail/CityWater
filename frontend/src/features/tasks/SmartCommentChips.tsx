import { useMemo } from "react";
import { interpolateWithMissing, safeEvaluate } from "../../lib/expr";
import type { SmartComment } from "./api";

/**
 * Tappable comment suggestions, rendered against the operator's current
 * task_data. Conditions filter what shows; `{var}` placeholders are
 * substituted live.
 *
 * Suggestive only — tapping calls onPick with the rendered text. The
 * caller decides whether to insert, append, replace, or do nothing.
 * Operator stays in full control.
 *
 * Suggestions whose `{var}` placeholders haven't been filled yet render
 * as dimmed, non-clickable chips with a "fill <field>" caption. Posting
 * "Cleared after ? min." into the audit feed has been a recurring
 * artefact when operators tick procedure steps faster than they fill
 * the numeric fields the comment depends on, and the chip is the
 * smaller surface — easier to make disable-correct than to police the
 * comment composer downstream.
 */

interface Props {
  smartComments: SmartComment[] | undefined;
  taskData: Record<string, unknown>;
  onPick: (text: string) => void;
  className?: string;
}

interface Rendered {
  id: string;
  text: string;
  missing: string[];
}

export function SmartCommentChips({ smartComments, taskData, onPick, className }: Props) {
  const visible = useMemo<Rendered[]>(() => {
    if (!smartComments?.length) return [];
    const seen = new Set<string>();
    const out: Rendered[] = [];
    for (const c of smartComments) {
      if (!c?.id || !c?.text || seen.has(c.id)) continue;
      // Empty/missing condition = always show, mirroring show_if rules.
      if (c.condition && !safeEvaluate(c.condition, taskData, false)) continue;
      const { text, missing } = interpolateWithMissing(c.text, taskData);
      out.push({ id: c.id, text, missing });
      seen.add(c.id);
    }
    return out;
  }, [smartComments, taskData]);

  if (visible.length === 0) return null;

  return (
    <div className={className}>
      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
        Suggestions
      </p>
      <div className="flex flex-wrap gap-2">
        {visible.map((s) =>
          s.missing.length > 0 ? (
            // Dimmed, non-clickable. The caption surfaces the field
            // name(s) the operator still needs to fill — clicking the
            // chip would otherwise insert "Cleared after ? min." into
            // the comment.
            <span
              key={s.id}
              aria-disabled="true"
              title={`Fill ${s.missing.join(", ")} above to enable this suggestion`}
              className="min-h-11 max-w-full cursor-not-allowed rounded-full border border-dashed border-slate-700 bg-slate-900/40 px-3 py-1.5 text-left text-sm text-slate-500"
            >
              <span>{s.text}</span>
              <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-amber-300/80">
                fill {s.missing.join(", ")}
              </span>
            </span>
          ) : (
            <button
              key={s.id}
              type="button"
              onClick={() => onPick(s.text)}
              className="min-h-11 max-w-full rounded-full border border-signal/40 bg-signal/10 px-3 py-1.5 text-left text-sm text-blue-100 hover:border-signal hover:bg-signal/20"
              title="Tap to insert. You can edit it after."
            >
              {s.text}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
