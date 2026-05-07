import { Link, useParams } from "react-router-dom";

export type ClickedFeature =
  | {
      kind: "asset";
      asset_uid: string;
      class_code: string;
      domain: string;
      status: string;
      condition: number | null;
    }
  | {
      kind: "work_order";
      wo_number: string;
      title: string;
      category: string;
      priority: string;
      status: string;
      asset_uid: string | null;
    }
  | {
      kind: "service_request";
      sr_number: string;
      category: string;
      priority: string;
      status: string;
      reported_address: string | null;
      asset_uid: string | null;
    };

interface Props {
  feature: ClickedFeature;
  onClose: () => void;
}

export function AssetSidePanel({ feature, onClose }: Props) {
  const { slug } = useParams<{ slug: string }>();

  if (feature.kind === "work_order") {
    return (
      <PanelShell onClose={onClose} eyebrow="WORK ORDER" title={feature.wo_number}>
        <p className="text-sm text-slate-200">{feature.title}</p>
        <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
          <Tag label="Status" value={feature.status} />
          <Tag label="Priority" value={feature.priority} priority={feature.priority} />
          <Tag label="Category" value={feature.category} />
          {feature.asset_uid && (
            <Tag
              label="Asset"
              valueNode={
                <Link
                  to={`/${slug}/assets/${feature.asset_uid}`}
                  className="font-mono hover:text-blue-300"
                >
                  {feature.asset_uid}
                </Link>
              }
            />
          )}
        </dl>
        <Link
          to={`/${slug}/work-orders/${feature.wo_number}`}
          className="mt-4 inline-block text-sm text-blue-300 hover:text-blue-200"
        >
          Open work order →
        </Link>
      </PanelShell>
    );
  }

  if (feature.kind === "service_request") {
    return (
      <PanelShell onClose={onClose} eyebrow="SERVICE REQUEST" title={feature.sr_number}>
        <dl className="mt-1 grid grid-cols-2 gap-y-1 text-sm">
          <Tag label="Category" value={feature.category} />
          <Tag label="Priority" value={feature.priority} priority={feature.priority} />
          <Tag label="Status" value={feature.status} />
          {feature.reported_address && <Tag label="Reported at" value={feature.reported_address} />}
          {feature.asset_uid && (
            <Tag
              label="Asset"
              valueNode={
                <Link
                  to={`/${slug}/assets/${feature.asset_uid}`}
                  className="font-mono hover:text-blue-300"
                >
                  {feature.asset_uid}
                </Link>
              }
            />
          )}
        </dl>
        <Link
          to={`/${slug}/service-requests/${feature.sr_number}`}
          className="mt-4 inline-block text-sm text-blue-300 hover:text-blue-200"
        >
          Open service request →
        </Link>
      </PanelShell>
    );
  }

  // Asset
  return (
    <PanelShell
      onClose={onClose}
      eyebrow={(feature.domain || "ASSET").toUpperCase()}
      title={feature.asset_uid}
    >
      <p className="text-xs text-slate-400">{feature.class_code}</p>
      <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
        <Tag label="Status" value={feature.status} />
        <Tag label="Condition" value={feature.condition ?? "—"} />
      </dl>
      <div className="mt-4 flex flex-col gap-2">
        <Link
          to={`/${slug}/assets/${feature.asset_uid}`}
          className="text-sm text-blue-300 hover:text-blue-200"
        >
          Open asset details →
        </Link>
        <Link
          to={`/${slug}/work-orders?asset_uid=${encodeURIComponent(feature.asset_uid)}`}
          className="text-sm text-slate-300 hover:text-blue-200"
        >
          View work orders for this asset →
        </Link>
      </div>
    </PanelShell>
  );
}

function PanelShell({
  onClose,
  eyebrow,
  title,
  children,
}: {
  onClose: () => void;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <aside
      className="absolute right-4 top-4 w-80 rounded-lg border border-slate-800 bg-slate-900 p-4 shadow-2xl shadow-black/40 z-10"
      role="region"
      aria-label="Selected feature"
    >
      <header className="flex items-start justify-between">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
            {eyebrow}
          </p>
          <h3 className="font-mono text-base text-slate-100">{title}</h3>
        </div>
        <button
          onClick={onClose}
          aria-label="Close panel"
          className="text-slate-400 hover:text-slate-200"
        >
          ✕
        </button>
      </header>
      {children}
    </aside>
  );
}

function Tag({
  label,
  value,
  valueNode,
  priority,
}: {
  label: string;
  value?: string | number;
  valueNode?: React.ReactNode;
  priority?: string;
}) {
  const palette: Record<string, string> = {
    emergency: "text-red-300",
    high: "text-amber-300",
    normal: "text-blue-300",
    low: "text-slate-400",
  };
  const cls = priority ? (palette[priority] ?? "text-slate-100") : "text-slate-100";
  return (
    <>
      <dt className="text-slate-400">{label}</dt>
      <dd className={cls}>{valueNode ?? String(value ?? "")}</dd>
    </>
  );
}
