import { safeEvaluate } from "../../lib/expr";
import { type Procedure, type ProcedureStep, type TaskDefinitionRead } from "./api";

/**
 * Renders the task definition's procedure as a checklist.
 *
 * Each step's checkmark reflects either:
 *   - `auto_complete_when` evaluating true against the current task_data
 *   - or a manual override stored in `task_data._steps[n]`
 *
 * Manual checks persist back via `onChange`. Auto-checks aren't persisted —
 * if the underlying answer changes, the check follows.
 */

interface Props {
  task: TaskDefinitionRead;
  taskData: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

type StepState = Record<number, boolean | null>;

export function ProcedureRunner({ task, taskData, onChange }: Props) {
  const proc = task.procedure ?? ({} as Procedure);
  const steps = proc.steps ?? [];
  const stepState: StepState = (taskData._steps as StepState) ?? {};

  function isStepChecked(step: ProcedureStep): boolean {
    if (step.auto_complete_when) {
      return safeEvaluate(step.auto_complete_when, taskData, false);
    }
    return stepState[step.n] === true;
  }

  function toggleManual(step: ProcedureStep) {
    if (step.auto_complete_when) return; // auto-checked; manual toggle disabled
    const nextState: StepState = {
      ...stepState,
      [step.n]: stepState[step.n] === true ? null : true,
    };
    onChange({ ...taskData, _steps: nextState });
  }

  if (steps.length === 0 && !proc.preconditions?.length && !proc.ppe?.length) {
    return null;
  }

  return (
    <section className="surface space-y-4 p-4">
      <h2 className="text-xs font-medium uppercase tracking-wider text-slate-500">
        Procedure
      </h2>

      {(proc.preconditions ?? []).length > 0 && (
        <Block label="Preconditions">
          <ul className="space-y-1 text-sm text-slate-300">
            {proc.preconditions!.map((p, i) => (
              <li key={i}>• {p}</li>
            ))}
          </ul>
        </Block>
      )}

      {(proc.ppe ?? []).length > 0 && (
        <Block label="PPE">
          <p className="text-sm text-slate-300">{proc.ppe!.join(", ")}</p>
        </Block>
      )}

      {(proc.tools_materials ?? []).length > 0 && (
        <Block label="Tools / Materials">
          <ul className="space-y-1 text-sm text-slate-300">
            {proc.tools_materials!.map((t, i) => (
              <li key={i}>
                {t.qty} × {t.item}
              </li>
            ))}
          </ul>
        </Block>
      )}

      {steps.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
            Steps
          </p>
          <ol className="space-y-2">
            {steps.map((step) => {
              const checked = isStepChecked(step);
              const auto = !!step.auto_complete_when;
              return (
                <li key={step.n}>
                  <button
                    type="button"
                    onClick={() => toggleManual(step)}
                    disabled={auto}
                    className={`flex w-full items-start gap-3 rounded-md border p-3 text-left transition-colors ${
                      checked
                        ? "border-blue-500/40 bg-blue-500/10"
                        : "border-slate-800 bg-slate-900/60 hover:border-slate-700"
                    }`}
                  >
                    <span
                      className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded ${
                        checked
                          ? "bg-blue-500 text-white"
                          : "border border-slate-600"
                      }`}
                      aria-hidden
                    >
                      {checked ? "✓" : ""}
                    </span>
                    <div className="flex-1">
                      <p className="text-sm text-slate-100">
                        <span className="text-slate-500">{step.n}.</span>{" "}
                        {step.title}
                        {auto && (
                          <span className="ml-2 text-xs text-slate-500">
                            (auto)
                          </span>
                        )}
                      </p>
                      {step.detail && (
                        <p className="mt-1 text-xs text-slate-400">
                          {step.detail}
                        </p>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {(proc.regulatory ?? []).length > 0 && (
        <Block label="Regulatory">
          <ul className="space-y-1 text-xs text-slate-400">
            {proc.regulatory!.map((r, i) => (
              <li key={i}>
                <span className="font-mono">{r.jurisdiction}</span> · {r.ref}
              </li>
            ))}
          </ul>
        </Block>
      )}
    </section>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wider text-slate-500">
        {label}
      </p>
      {children}
    </div>
  );
}
