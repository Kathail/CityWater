/**
 * Sticky top banner shown only when the active tenant is the public
 * demo. Communicates that this is sandbox data, surfaces a contact
 * email for follow-ups, and gives a one-click route back to the
 * marketing site.
 *
 * Mounted by TenantShell when `tenant.slug === "demo"`.
 */
export function DemoBanner() {
  return (
    <div
      role="region"
      aria-label="Demo environment notice"
      className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs text-emerald-100"
    >
      <p className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-flex items-center rounded bg-emerald-500/30 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-100"
        >
          Demo
        </span>
        <span>
          You're exploring a sandbox tenant pre-populated with simulated work. Changes are
          real but the data resets periodically.
        </span>
      </p>
      <p className="flex items-center gap-3 text-xs">
        <span className="text-emerald-200/70">Questions?</span>
        <a
          href="mailto:klc.cahill@gmail.com"
          className="font-medium text-emerald-100 underline-offset-2 hover:text-white hover:underline"
        >
          klc.cahill@gmail.com
        </a>
        <span aria-hidden="true" className="text-emerald-500/40">
          ·
        </span>
        <a
          href="https://citywater.ca"
          className="font-medium text-emerald-100 underline-offset-2 hover:text-white hover:underline"
        >
          ← Back to citywater.ca
        </a>
      </p>
    </div>
  );
}
