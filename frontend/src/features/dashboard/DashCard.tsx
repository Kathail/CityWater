import type { ReactNode } from "react";
import { Link } from "react-router-dom";

/**
 * Standardised dashboard card. Single source of truth for card
 * styling so the seven sub-panels read as siblings (same border,
 * same padding, same header treatment, same trailing-link style).
 *
 * Slots:
 *   title     — the section's eyebrow heading
 *   trailing  — right-aligned content in the header (count, link, etc.)
 *   to/linkLabel — convenience: render a "See all →" link automatically
 *   children  — body
 */

interface Props {
  title: string;
  to?: string;
  linkLabel?: string;
  trailing?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function DashCard({
  title,
  to,
  linkLabel = "See all",
  trailing,
  children,
  className = "",
}: Props) {
  return (
    <section
      className={`rounded-md border border-slate-800 bg-slate-900 p-4 shadow-sm shadow-black/20 ${className}`.trim()}
    >
      <header className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
          {title}
        </h2>
        <div className="flex items-center gap-3 text-xs">
          {trailing}
          {to && (
            <Link
              to={to}
              className="group inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-blue-300 transition-colors hover:bg-blue-500/10 hover:text-blue-200"
            >
              {linkLabel}
              <span
                aria-hidden="true"
                className="transition-transform group-hover:translate-x-0.5"
              >
                →
              </span>
            </Link>
          )}
        </div>
      </header>
      {children}
    </section>
  );
}
