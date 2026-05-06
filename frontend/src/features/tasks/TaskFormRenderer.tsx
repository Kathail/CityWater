import { type ChangeEvent } from "react";
import { safeEvaluate } from "../../lib/expr";
import { type FormField, type TaskDefinitionRead } from "./api";

/**
 * Generic form generator for task definitions.
 *
 * Renders the task's `form` array in order. Hides fields whose `show_if`
 * evaluates false against the current task_data + entityContext. Numeric
 * inputs use `inputMode="numeric"` so a tablet's keypad opens. Tap
 * targets are 44px+ for gloved-finger use.
 *
 * The renderer is presentation-only — it doesn't fetch or save. The
 * parent calls `onChange` with each edit and decides when to POST.
 */

export type TaskData = Record<string, unknown>;

interface Props {
  task: TaskDefinitionRead;
  value: TaskData;
  onChange: (next: TaskData) => void;
  entityContext?: Record<string, unknown>;
  errors?: Record<string, string>;
  readOnly?: boolean;
}

const inputClass =
  "block w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-base text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none";

export function TaskFormRenderer({
  task,
  value,
  onChange,
  entityContext = {},
  errors = {},
  readOnly = false,
}: Props) {
  const ctx = { ...entityContext, ...value };

  function set(id: string, v: unknown) {
    onChange({ ...value, [id]: v });
  }

  return (
    <div className="space-y-4">
      {task.form.map((field) => {
        if (!safeEvaluate(field.show_if ?? null, ctx, true)) return null;
        return (
          <FieldRow
            key={field.id}
            field={field}
            value={value[field.id]}
            onChange={(v) => set(field.id, v)}
            error={errors[field.id]}
            disabled={readOnly || field.read_only}
          />
        );
      })}
    </div>
  );
}

function FieldRow({
  field,
  value,
  onChange,
  error,
  disabled,
}: {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
  error?: string;
  disabled?: boolean;
}) {
  const labelEl = (
    <span className="block text-sm font-medium text-slate-200">
      {field.label}
      {field.required_for_complete && (
        <span className="ml-1 text-blue-400" aria-label="required">
          *
        </span>
      )}
      {field.unit && (
        <span className="ml-2 text-xs text-slate-500">({field.unit})</span>
      )}
    </span>
  );
  const helpEl = field.help ? (
    <p className="mt-1 text-xs text-slate-500">{field.help}</p>
  ) : null;
  const errorEl = error ? (
    <p className="mt-1 text-xs text-red-400">{error}</p>
  ) : null;

  switch (field.type) {
    case "boolean":
      return (
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            disabled={disabled}
            className="mt-1 h-5 w-5 rounded border-slate-700 bg-slate-900 text-blue-500 focus:ring-blue-500"
          />
          <div className="flex-1">
            {labelEl}
            {helpEl}
            {errorEl}
          </div>
        </label>
      );

    case "number":
      return (
        <label className="block">
          {labelEl}
          <input
            type="number"
            inputMode="numeric"
            value={typeof value === "number" ? value : ""}
            onChange={(e) =>
              onChange(e.target.value === "" ? null : Number(e.target.value))
            }
            min={field.min}
            max={field.max}
            step={field.step ?? "any"}
            disabled={disabled}
            className={`${inputClass} mt-2`}
          />
          {helpEl}
          {errorEl}
        </label>
      );

    case "text":
      return (
        <label className="block">
          {labelEl}
          <input
            type="text"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value || null)}
            disabled={disabled}
            className={`${inputClass} mt-2`}
          />
          {helpEl}
          {errorEl}
        </label>
      );

    case "textarea":
      return (
        <label className="block">
          {labelEl}
          <textarea
            rows={3}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value || null)}
            disabled={disabled}
            className={`${inputClass} mt-2`}
          />
          {helpEl}
          {errorEl}
        </label>
      );

    case "choice":
      return (
        <fieldset>
          <legend className="text-sm font-medium text-slate-200">
            {field.label}
            {field.required_for_complete && (
              <span className="ml-1 text-blue-400">*</span>
            )}
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {(field.choices ?? []).map((choice) => {
              const selected = value === choice.value;
              return (
                <button
                  key={choice.value}
                  type="button"
                  onClick={() => !disabled && onChange(selected ? null : choice.value)}
                  disabled={disabled}
                  aria-pressed={selected}
                  className={`min-h-11 rounded-full px-4 py-2 text-sm transition-colors ${
                    selected
                      ? "bg-blue-500 text-white shadow-sm shadow-blue-500/30"
                      : "bg-slate-900 text-slate-200 ring-1 ring-slate-700 hover:bg-slate-800 hover:ring-blue-500/40"
                  } disabled:opacity-50`}
                >
                  {choice.label}
                </button>
              );
            })}
          </div>
          {helpEl}
          {errorEl}
        </fieldset>
      );

    case "multi_choice": {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      return (
        <fieldset>
          <legend className="text-sm font-medium text-slate-200">{field.label}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {(field.choices ?? []).map((choice) => {
              const selected = arr.includes(choice.value);
              return (
                <button
                  key={choice.value}
                  type="button"
                  onClick={() => {
                    if (disabled) return;
                    onChange(
                      selected
                        ? arr.filter((v) => v !== choice.value)
                        : [...arr, choice.value],
                    );
                  }}
                  disabled={disabled}
                  aria-pressed={selected}
                  className={`min-h-11 rounded-full px-4 py-2 text-sm transition-colors ${
                    selected
                      ? "bg-blue-500 text-white"
                      : "bg-slate-900 text-slate-200 ring-1 ring-slate-700 hover:bg-slate-800"
                  } disabled:opacity-50`}
                >
                  <span className="mr-1.5">{selected ? "✓" : "+"}</span>
                  {choice.label}
                </button>
              );
            })}
          </div>
          {helpEl}
          {errorEl}
        </fieldset>
      );
    }

    case "asset_pick":
      // Real picker is a map-bounded selector wired to /api/v1/assets — for
      // this PR we surface a plain text input for the asset_uid; it'll get
      // upgraded to the map picker in a follow-up PR per the spec.
      return (
        <label className="block">
          {labelEl}
          <input
            type="text"
            placeholder={
              field.asset_class ? `Asset UID (${field.asset_class})` : "Asset UID"
            }
            value={typeof value === "string" ? value : ""}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              onChange(e.target.value || null)
            }
            disabled={disabled}
            className={`${inputClass} mt-2 font-mono`}
          />
          <p className="mt-1 text-xs text-slate-500">
            Picker UI lands in a follow-up PR — type the UID for now.
          </p>
          {errorEl}
        </label>
      );

    case "datetime":
      return (
        <label className="block">
          {labelEl}
          <input
            type="datetime-local"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value || null)}
            disabled={disabled}
            className={`${inputClass} mt-2`}
          />
          {errorEl}
        </label>
      );

    case "duration":
      return (
        <label className="block">
          {labelEl}
          <input
            type="number"
            inputMode="numeric"
            placeholder="minutes"
            value={typeof value === "number" ? value : ""}
            onChange={(e) =>
              onChange(e.target.value === "" ? null : Number(e.target.value))
            }
            disabled={disabled}
            className={`${inputClass} mt-2`}
          />
          {errorEl}
        </label>
      );

    case "photo":
    case "signature":
      // Camera + canvas integrations land later; the form should still
      // render a placeholder so the operator sees the slot.
      return (
        <div>
          {labelEl}
          <p className="mt-2 rounded border border-slate-800 bg-slate-900/40 p-3 text-xs text-slate-500">
            {field.type === "photo" ? "Photo capture" : "Signature capture"}{" "}
            arrives in a follow-up PR.
          </p>
        </div>
      );

    default:
      return null;
  }
}
