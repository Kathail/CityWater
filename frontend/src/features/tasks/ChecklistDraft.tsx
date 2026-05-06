import { useMemo } from "react";
import { interpolate, safeEvaluate } from "../../lib/expr";
import type { ProcedureStep, TaskDefinitionRead } from "./api";

/**
 * Aggregates the `comment_when_checked` templates of every ticked
 * procedure step into a single draft, interpolated against task_data.
 * Suggestive only — operator taps "Use this comment" to insert into the
 * activity composer.
 */

interface Props {
  task: TaskDefinitionRead;
  taskData: Record<string, unknown>;
  onPick: (text: string) => void;
}

type StepState = Record<number, boolean | null>;

function isChecked(step: ProcedureStep, taskData: Record<string, unknown>): boolean {
  // Mirrors ProcedureRunner: auto-rule wins, otherwise manual flag in
  // task_data._steps drives.
  if (step.auto_complete_when) {
    return safeEvaluate(step.auto_complete_when, taskData, false);
  }
  const state = (taskData._steps as StepState | undefined) ?? {};
  return state[step.n] === true;
}

export function ChecklistDraft({ task, taskData, onPick }: Props) {
  const lines = useMemo<string[]>(() => {
    const steps = task.procedure?.steps ?? [];
    const out: string[] = [];
    for (const step of steps) {
      if (!step.comment_when_checked) continue;
      if (!isChecked(step, taskData)) continue;
      out.push(interpolate(step.comment_when_checked, taskData));
    }
    return out;
  }, [task, taskData]);

  if (lines.length === 0) return null;

  const draft = lines.map((l) => `- ${l}`).join("\n");

  return (
    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wider text-emerald-300">
          Draft from checklist ({lines.length} item{lines.length === 1 ? "" : "s"})
        </p>
        <button
          type="button"
          onClick={() => onPick(draft)}
          className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-100 hover:border-emerald-400 hover:bg-emerald-500/20"
        >
          Use as comment
        </button>
      </div>
      <pre className="whitespace-pre-wrap text-sm text-slate-200">{draft}</pre>
    </div>
  );
}
