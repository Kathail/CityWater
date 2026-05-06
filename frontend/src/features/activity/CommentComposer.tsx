import { useState, type FormEvent } from "react";
import { ApiError } from "../../lib/apiClient";
import { type ActivityEntityType } from "./api";
import { useCreateComment } from "./hooks";

/**
 * Tablet-first comment composer.
 *
 * Quick-phrase chips are field-crew shortcuts — one tap appends the phrase
 * and a space, so an operator can stitch together a comment in 2-3 taps:
 *   [Site visited] [Found leak at] [pipe joint]
 * Every chip has a 44px+ tap target so it works with a gloved finger.
 */

const QUICK_PHRASES = [
  "Site visited",
  "Found leak",
  "Repaired",
  "Awaiting parts",
  "Crew dispatched",
  "Customer notified",
  "On hold — weather",
  "Reset complete",
  "Hydrant flushed",
  "Valve exercised",
  "Photos uploaded",
  "Returning tomorrow",
];

interface Props {
  entityType: ActivityEntityType;
  entityId: number;
}

export function CommentComposer({ entityType, entityId }: Props) {
  const [body, setBody] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const create = useCreateComment(entityType, entityId);

  function appendPhrase(phrase: string) {
    setBody((prev) => {
      if (!prev) return phrase + " ";
      const sep = prev.endsWith(" ") || prev.endsWith("\n") ? "" : " ";
      return prev + sep + phrase + " ";
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setErrorMessage(null);
    try {
      await create.mutateAsync({
        entity_type: entityType,
        entity_id: entityId,
        body: body.trim(),
      });
      setBody("");
    } catch (err) {
      setErrorMessage(err instanceof ApiError ? err.message : String(err));
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="Add a comment…"
        className="block w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-base text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
      />

      <div className="flex flex-wrap gap-2">
        {QUICK_PHRASES.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => appendPhrase(p)}
            className="min-h-11 rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 hover:border-blue-500/50 hover:bg-slate-800 active:bg-slate-700"
          >
            {p}
          </button>
        ))}
      </div>

      {errorMessage && (
        <p className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {errorMessage}
        </p>
      )}

      <div className="flex justify-end gap-2">
        {body && (
          <button
            type="button"
            onClick={() => setBody("")}
            className="btn-ghost min-h-11 px-4 py-2 text-sm"
          >
            Clear
          </button>
        )}
        <button
          type="submit"
          disabled={create.isPending || !body.trim()}
          className="btn-primary min-h-11 px-5 py-2 text-sm"
        >
          {create.isPending ? "Posting…" : "Post comment"}
        </button>
      </div>
    </form>
  );
}
