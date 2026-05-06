import { Link, useParams } from "react-router-dom";

export interface ClickedFeature {
  asset_uid: string;
  class_code: string;
  domain: string;
  status: string;
  condition: number | null;
}

interface Props {
  feature: ClickedFeature;
  onClose: () => void;
}

export function AssetSidePanel({ feature, onClose }: Props) {
  const { slug } = useParams<{ slug: string }>();
  return (
    <aside
      className="absolute right-4 top-4 w-72 rounded-lg border border-slate-200 bg-white p-4 shadow-lg z-10"
      role="region"
      aria-label="Selected asset"
    >
      <header className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase text-slate-500">{feature.domain}</p>
          <h3 className="font-mono text-base text-slate-900">{feature.asset_uid}</h3>
          <p className="text-xs text-slate-500">{feature.class_code}</p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close panel"
          className="text-slate-400 hover:text-slate-700"
        >
          ✕
        </button>
      </header>
      <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
        <dt className="text-slate-500">Status</dt>
        <dd className="text-slate-800">{feature.status}</dd>
        <dt className="text-slate-500">Condition</dt>
        <dd className="text-slate-800">{feature.condition ?? "—"}</dd>
      </dl>
      <Link
        to={`/${slug}/assets/${feature.asset_uid}`}
        className="mt-4 inline-block text-sm text-slate-900 underline"
      >
        View / edit details →
      </Link>
    </aside>
  );
}
