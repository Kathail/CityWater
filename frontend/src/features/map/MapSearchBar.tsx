import { useEffect, useState } from "react";
import { apiJson } from "../../lib/apiClient";
import { useMapOverlays } from "./hooks";

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
  geometry?: GeoJSON.Geometry | null;
  address_cached?: string | null;
}

interface AssetListResp {
  items: AssetItem[];
}

export function MapSearchBar({ onPick }: { onPick: (hit: MapSearchHit) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<MapSearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);

  // Reuse the same overlay query as the LayerPanel so we don't double-
  // fetch and so freshly-created WOs/SRs (which invalidate the
  // ["map-overlays"] key) appear in search results without a refresh.
  const overlays = useMapOverlays();

  // Debounced asset lookup + WO/SR filter against the overlay cache.
  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const trimmed = q.trim();
    const timer = window.setTimeout(async () => {
      const wos = searchOverlay(overlays.data?.open_wos.features ?? [], trimmed, "wo");
      const srs = searchOverlay(overlays.data?.active_srs.features ?? [], trimmed, "sr");
      let assets: MapSearchHit[] = [];
      try {
        const d = await apiJson<AssetListResp>(
          `/api/v1/assets?q=${encodeURIComponent(trimmed)}&page_size=8`,
        );
        assets = d.items.map((a) => assetToHit(a)).filter((h): h is MapSearchHit => h !== null);
      } catch {
        // Network error — keep WO/SR hits, swallow the assets miss.
      }
      if (cancelled) return;
      const merged = [...wos, ...srs, ...assets].slice(0, 10);
      setHits(merged);
      setActive(0);
      setOpen(merged.length > 0);
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [q, overlays.data]);

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
    <span className={`mr-1.5 inline-block rounded px-1 text-[9px] font-medium ${palette[kind]}`}>
      {labels[kind]}
    </span>
  );
}

function assetToHit(a: AssetItem): MapSearchHit | null {
  const pt = representativePoint(a.geometry);
  if (!pt) return null;
  return {
    kind: "asset",
    uid: a.asset_uid,
    label: a.address_cached ?? a.class_code,
    lon: pt[0],
    lat: pt[1],
    class_code: a.class_code,
    domain: a.domain,
    status: a.status,
    priority: null,
  };
}

/** Reduce any geometry to a single (lon, lat) pair we can flyTo. */
function representativePoint(geom: GeoJSON.Geometry | null | undefined): [number, number] | null {
  if (!geom) return null;
  switch (geom.type) {
    case "Point":
      return geom.coordinates as [number, number];
    case "LineString": {
      const cs = geom.coordinates;
      if (cs.length === 0) return null;
      // Midpoint vertex — close enough for a fly-to.
      return cs[Math.floor(cs.length / 2)] as [number, number];
    }
    case "Polygon": {
      const ring = geom.coordinates[0];
      if (!ring || ring.length === 0) return null;
      // Average vertices as a cheap centroid; good enough for navigation.
      let sx = 0,
        sy = 0,
        n = 0;
      for (const [x, y] of ring) {
        sx += x;
        sy += y;
        n++;
      }
      return n ? [sx / n, sy / n] : null;
    }
    default:
      return null;
  }
}

function searchOverlay(
  features: readonly GeoJSON.Feature<GeoJSON.Point>[],
  query: string,
  kind: "wo" | "sr",
): MapSearchHit[] {
  const q = query.toLowerCase();
  const hits: MapSearchHit[] = [];
  for (const f of features) {
    // The overlay endpoint emits typed properties (WoFeatureProps /
    // SrFeatureProps), but searchOverlay is generic over both — index
    // through Record<string, unknown> at the use site so TS doesn't
    // complain about the union-typed fields.
    const props = (f.properties ?? {}) as Record<string, unknown>;
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
