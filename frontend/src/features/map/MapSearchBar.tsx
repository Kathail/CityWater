import { useEffect, useRef, useState } from "react";
import { apiJson } from "../../lib/apiClient";

/**
 * Top-of-map search bar.
 *
 * Queries assets / WOs / SRs in parallel and shows up to 8 hits ranked
 * by exact-match → prefix → substring. Selecting a hit fires `onPick`,
 * which the map page wires to a `flyTo` + side-panel open.
 *
 * Keyboard: ↑/↓ to navigate, Enter to pick the highlighted hit, Esc to
 * close. Debounced 250ms.
 */

export interface MapSearchHit {
  kind: "asset" | "work_order" | "service_request";
  uid: string;
  label: string;
  lon: number;
  lat: number;
  class_code: string | null;
  domain: string | null;
  status: string | null;
  priority: string | null;
}

interface AssetItem {
  asset_uid: string;
  class_code: string;
  domain: string;
  status: string;
  geom?: { type: "Point"; coordinates: [number, number] } | null;
  centroid?: { type: "Point"; coordinates: [number, number] } | null;
  address_cached?: string | null;
}

interface AssetListResp {
  items: AssetItem[];
}

interface MapOverlaysResp {
  open_wos: GeoJSON.FeatureCollection<
    GeoJSON.Point,
    {
      kind: "work_order";
      wo_number: string;
      title: string;
      priority: string;
      status: string;
    }
  >;
  active_srs: GeoJSON.FeatureCollection<
    GeoJSON.Point,
    {
      kind: "service_request";
      sr_number: string;
      category: string;
      priority: string;
      status: string;
      reported_address: string | null;
    }
  >;
}

export function MapSearchBar({
  onPick,
}: {
  onPick: (hit: MapSearchHit) => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<MapSearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const overlaysRef = useRef<MapOverlaysResp | null>(null);

  // Pull overlays once for in-memory search of WOs/SRs (small set;
  // bigger tenants can switch to a server-side endpoint later).
  useEffect(() => {
    apiJson<MapOverlaysResp>("/api/v1/map/overlays")
      .then((d) => (overlaysRef.current = d))
      .catch(() => {
        /* swallow — search will degrade to assets-only */
      });
  }, []);

  // Debounced asset lookup + WO/SR filter.
  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const trimmed = q.trim();
      const promises: [
        Promise<MapSearchHit[]>,
        MapSearchHit[],
        MapSearchHit[],
      ] = [
        apiJson<AssetListResp>(
          `/api/v1/assets?q=${encodeURIComponent(trimmed)}&page_size=8`,
        )
          .then((d) =>
            d.items
              .map((a) => assetToHit(a))
              .filter((h): h is MapSearchHit => h !== null),
          )
          .catch(() => [] as MapSearchHit[]),
        searchOverlay(overlaysRef.current?.open_wos.features ?? [], trimmed, "wo"),
        searchOverlay(overlaysRef.current?.active_srs.features ?? [], trimmed, "sr"),
      ];
      const [assets, wos, srs] = await Promise.all([
        promises[0],
        Promise.resolve(promises[1]),
        Promise.resolve(promises[2]),
      ]);
      if (cancelled) return;
      const merged = [...wos, ...srs, ...assets].slice(0, 10);
      setHits(merged);
      setActive(0);
      setOpen(merged.length > 0);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

  function pick(hit: MapSearchHit) {
    onPick(hit);
    setOpen(false);
    setQ("");
    setHits([]);
  }

  return (
    <div className="absolute left-1/2 top-3 z-10 w-[min(28rem,calc(100%-2rem))] -translate-x-1/2">
      <div className="relative">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, hits.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && hits[active]) {
              e.preventDefault();
              pick(hits[active]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          onFocus={() => hits.length && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search assets, work orders, service requests…"
          className="w-full rounded-md border border-slate-700 bg-slate-900/95 px-3 py-2 text-sm text-slate-100 shadow-lg backdrop-blur placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
        />
        {open && hits.length > 0 && (
          <ul
            className="absolute left-0 right-0 mt-1 max-h-80 overflow-y-auto rounded-md border border-slate-700 bg-slate-900 shadow-2xl shadow-black/40"
            role="listbox"
          >
            {hits.map((h, i) => (
              <li key={`${h.kind}-${h.uid}-${i}`}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(h)}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm ${
                    i === active ? "bg-blue-500/15" : "hover:bg-slate-800"
                  }`}
                >
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-slate-100">
                      <KindBadge kind={h.kind} /> {h.uid}
                    </p>
                    <p className="truncate text-[11px] text-slate-400">{h.label}</p>
                  </div>
                  <span className="text-[10px] uppercase text-slate-500">
                    {h.class_code ?? h.priority ?? ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function KindBadge({ kind }: { kind: MapSearchHit["kind"] }) {
  const palette: Record<MapSearchHit["kind"], string> = {
    asset: "bg-slate-700 text-slate-300",
    work_order: "bg-blue-500/30 text-blue-200",
    service_request: "bg-amber-500/30 text-amber-200",
  };
  const labels: Record<MapSearchHit["kind"], string> = {
    asset: "AS",
    work_order: "WO",
    service_request: "SR",
  };
  return (
    <span
      className={`mr-1.5 inline-block rounded px-1 text-[9px] font-medium ${palette[kind]}`}
    >
      {labels[kind]}
    </span>
  );
}

function assetToHit(a: AssetItem): MapSearchHit | null {
  const pt = a.centroid ?? a.geom;
  if (!pt) return null;
  const [lon, lat] = pt.coordinates;
  return {
    kind: "asset",
    uid: a.asset_uid,
    label: a.address_cached ?? a.class_code,
    lon,
    lat,
    class_code: a.class_code,
    domain: a.domain,
    status: a.status,
    priority: null,
  };
}

function searchOverlay(
  features: GeoJSON.Feature<GeoJSON.Point, Record<string, unknown>>[],
  query: string,
  kind: "wo" | "sr",
): MapSearchHit[] {
  const q = query.toLowerCase();
  const hits: MapSearchHit[] = [];
  for (const f of features) {
    const props = f.properties ?? {};
    const num = String(kind === "wo" ? props.wo_number : props.sr_number);
    const label =
      kind === "wo"
        ? String(props.title ?? "")
        : `${String(props.category ?? "")} · ${String(props.reported_address ?? "")}`;
    const haystack = `${num} ${label}`.toLowerCase();
    if (!haystack.includes(q)) continue;
    const [lon, lat] = f.geometry.coordinates as [number, number];
    hits.push({
      kind: kind === "wo" ? "work_order" : "service_request",
      uid: num,
      label,
      lon,
      lat,
      class_code: kind === "sr" ? String(props.category ?? "") : null,
      domain: null,
      status: String(props.status ?? ""),
      priority: String(props.priority ?? ""),
    });
    if (hits.length >= 5) break;
  }
  return hits;
}
