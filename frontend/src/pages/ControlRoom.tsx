import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import L from "leaflet";
import { CircleMarker, MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import BuildingsLayer from "../components/BuildingsLayer";
import SimulatePanel from "../components/SimulatePanel";
import {
  api,
  ApiError,
  fetchBuildings,
  type AttentionRow,
  type BuildingFeature,
  type DestinationType,
  type ReviewDecision,
  type Dashboard as DashboardT,
  type PlanStatus,
  type Simulation,
  type WardDetail,
  type WardSummary2,
} from "../lib/api";
import { bigLitres, formatNum } from "../lib/area";
import { useI18n, type StringKey } from "../lib/i18n";
import { litresScale, night, statusColor, water } from "../lib/tokens";

/*
 * Desktop "control room" for the ward dashboard: wards on the left, a full-screen dark map in the middle,
 * the selected ward (or plan) in the inspector on the right, and the data sources along the bottom.
 * Phones keep the stacked dashboard.
 */

const STATUS_ORDER: PlanStatus[] = ["planned", "applied", "installed", "verified", "needs_attention"];
const BASEMAP = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}";
const BASEMAP_ATTRIBUTION = "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors | Buildings &copy; Overture Maps";
const DELHI: [number, number] = [28.6139, 77.209];
/** Litres-a-year scale on the light basemap: pale for small roofs, deep blue for big ones. */
const ROOF_SCALE = litresScale;

type WardRow = DashboardT["wards"][number];

const DEST_ORDER: DestinationType[] = ["onsite_recharge", "water_body", "storm_drain", "storage_reuse"];
const DEST_COLOR: Record<DestinationType, string> = {
  onsite_recharge: statusColor.verified,
  water_body: water[400],
  storm_drain: night.cta,
  storage_reuse: statusColor.installed,
};
const DECISION_RING: Record<ReviewDecision, string> = {
  approved: statusColor.verified,
  site_visit: statusColor.installed,
  rejected: statusColor.needs_attention,
};

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const builtCount = (b: Record<PlanStatus, number>) => b.installed + b.verified + b.needs_attention;

/** Green when most built systems are verified, yellow when some are, red when problems dominate. */
function tier(w: { byStatus: Record<PlanStatus, number> }): "good" | "mid" | "bad" | "none" {
  const built = builtCount(w.byStatus);
  if (!built) return "none";
  if (w.byStatus.needs_attention / built > 0.3) return "bad";
  return w.byStatus.verified / built >= 0.5 ? "good" : "mid";
}
const TIER_COLOR = { good: statusColor.verified, mid: statusColor.installed, bad: statusColor.needs_attention, none: night.muted } as const;

/** Header height, so the control room fills exactly the space under it. */
function useHeaderHeight(): number {
  const [h, setH] = useState(61);
  useEffect(() => {
    const header = document.querySelector("header");
    if (!header) return;
    const update = () => setH(header.getBoundingClientRect().height);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(header);
    return () => ro.disconnect();
  }, []);
  return h;
}

function FitTo({ bounds }: { bounds: L.LatLngBoundsExpression | null }) {
  const map = useMap();
  const key = JSON.stringify(bounds);
  useEffect(() => {
    if (!bounds) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    map.flyToBounds(bounds, { padding: [70, 70], maxZoom: 16, duration: reduce ? 0 : 1.1, animate: !reduce });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}

function Mono({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`mono-label ${className}`}>{children}</span>;
}

export default function ControlRoom() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const headerH = useHeaderHeight();

  const [ward, setWard] = useState<string | undefined>(undefined);
  const [data, setData] = useState<DashboardT | null>(null);
  const [geo, setGeo] = useState<WardSummary2[]>([]);
  const [detail, setDetail] = useState<WardDetail | null>(null);
  const [buildings, setBuildings] = useState<BuildingFeature[] | null>(null);
  const [attention, setAttention] = useState<AttentionRow[] | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<DashboardT["points"][number] | null>(null);
  const [sim, setSim] = useState<Simulation | null>(null);
  const [raining, setRaining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  // City-wide list (never filtered) for the rail and the map chips.
  const [all, setAll] = useState<DashboardT | null>(null);
  useEffect(() => {
    api.dashboard().then(setAll).catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
    api.wards().then(setGeo).catch(() => setGeo([]));
  }, [reload]);

  // The selected ward's numbers and plan points.
  useEffect(() => {
    setError(null);
    setSelectedPlan(null);
    setSim(null);
    api
      .dashboard(ward)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
    setAttention(null);
    api
      .attention(ward)
      .then((r) => setAttention(r.rows))
      .catch(() => setAttention([]));
  }, [ward, reload]);

  const wardRow: WardRow | undefined = all?.wards.find((w) => w.ward === ward);
  const slug = wardRow?.slug ?? null;

  // Building footprints for wards that have them.
  useEffect(() => {
    let alive = true;
    setDetail(null);
    setBuildings(null);
    if (!slug) return;
    api
      .ward(slug)
      .then(async (w) => {
        if (!alive) return;
        setDetail(w);
        // If footprints fail to load, keep the ward's numbers and show plans only.
        const features = await fetchBuildings(w.buildingsUrl).catch(() => [] as BuildingFeature[]);
        if (alive) setBuildings(features);
      })
      .catch(() => alive && setDetail(null));
    return () => {
      alive = false;
    };
  }, [slug]);

  const geoBySlug = useMemo(() => new Map(geo.map((g) => [g.slug, g])), [geo]);
  const bounds = useMemo<L.LatLngBoundsExpression | null>(() => {
    if (detail) {
      const [w, s, e, n] = detail.bbox;
      return [
        [s, w],
        [n, e],
      ];
    }
    const pts = ward ? (data?.points ?? []).map((p) => [p.lat, p.lon] as [number, number]) : geo.map((g) => [g.centroid[1], g.centroid[0]] as [number, number]);
    return pts.length ? (pts as L.LatLngBoundsExpression) : null;
  }, [detail, data, geo, ward]);

  const buckets = useMemo(() => detail?.colourBuckets ?? [], [detail]);
  const outcomes = useMemo(() => new Map(sim?.plans.map((p) => [p.buildingId, p.outcome]) ?? []), [sim]);
  const fillFor = useCallback(
    (f: BuildingFeature) => {
      if (sim) {
        const o = outcomes.get(f.properties.buildingId);
        return o === "captured" ? water[600] : o === "broken" ? statusColor.needs_attention : night.muted;
      }
      return ROOF_SCALE[Math.min(ROOF_SCALE.length - 1, buckets.filter((edge) => f.properties.litresPerYear >= edge).length)];
    },
    [sim, outcomes, buckets],
  );

  const chip = useCallback(
    (litres: number) => {
      const b = bigLitres(litres);
      return b.key === "crore" ? t("chipCrore", { n: b.n }) : b.key === "lakh" ? t("chipLakh", { n: b.n }) : t("litresShort", { n: b.n });
    },
    [t],
  );

  const s = data?.selected;
  const totals = useMemo(() => {
    const ws = all?.wards ?? [];
    return {
      wards: ws.length,
      plans: ws.reduce((n, w) => n + w.total, 0),
      verified: ws.reduce((n, w) => n + w.byStatus.verified, 0),
    };
  }, [all]);
  const ranking = useMemo(() => [...(all?.wards ?? [])].sort((a, b) => b.harvestingLitres - a.harvestingLitres), [all]);
  const maxLitres = Math.max(1, ...ranking.map((w) => w.harvestingLitres));
  const hero = bigLitres(s?.harvestingLitres ?? 0);
  const heroUnit: StringKey = hero.key === "crore" ? "unitCrore" : hero.key === "lakh" ? "unitLakh" : "unitLitres";
  const compliance = wardRow?.complianceScore;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[1000] grid grid-cols-[320px_minmax(0,1fr)_380px] bg-deep" style={{ top: headerH }}>
      {/* ---------- Left rail: wards ---------- */}
      <aside className="flex min-h-0 flex-col border-r border-line bg-panel">
        <div className="border-b border-line px-5 pb-5 pt-6">
          <Mono className="text-glow">{t("crEyebrow")}</Mono>
          <h1 className="mt-3 font-display text-[2.1rem] font-extrabold uppercase leading-[0.92] tracking-tight text-ink">{t("crHeadline")}</h1>
          <p className="mt-3 text-sm leading-relaxed text-ink-muted">{t("crSub")}</p>
        </div>
        <dl className="grid grid-cols-3 border-b border-line">
          {[
            [t("crWards"), totals.wards],
            [t("kpiPlans"), totals.plans],
            [t("kpiVerified"), totals.verified],
          ].map(([label, n], i) => (
            <div key={i} className="border-r border-line px-4 py-3 last:border-r-0">
              <dd className="text-xl font-semibold tabular-nums text-ink">{formatNum(Number(n))}</dd>
              <dt>
                <Mono>{label}</Mono>
              </dt>
            </div>
          ))}
        </dl>

        <nav className="min-h-0 flex-1 overflow-y-auto" aria-label={t("colWard")}>
          {[undefined, ...(all?.wards.map((w) => w.ward) ?? [])].map((w) => {
            const row = all?.wards.find((x) => x.ward === w);
            const active = ward === w;
            const tr = row ? tier(row) : "none";
            return (
              <button
                key={w ?? "all"}
                type="button"
                onClick={() => setWard(w)}
                aria-pressed={active}
                className={`group relative grid min-h-16 w-full grid-cols-[2.25rem_1fr_auto] items-center gap-3 border-b border-line px-4 text-left transition-[background,padding] hover:bg-panel-2 hover:pl-5 ${
                  active ? "bg-panel-2" : ""
                }`}
              >
                <span className={`absolute inset-y-0 left-0 w-[3px] bg-cta transition-transform ${active ? "scale-y-100" : "scale-y-0"}`} aria-hidden="true" />
                <span
                  className="grid h-9 w-9 place-items-center border border-line-strong bg-panel-2 text-lg transition-transform group-hover:-rotate-3"
                  style={{ boxShadow: row ? `inset 0 -3px 0 ${TIER_COLOR[tr]}` : undefined }}
                  aria-hidden="true"
                >
                  {(w ?? t("crAllWards")).slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0">
                  <b className="block truncate text-sm font-semibold uppercase tracking-wide text-ink">{w ?? t("crAllWards")}</b>
                  <Mono className="mt-0.5 block normal-case">
                    {row
                      ? t("crRowSub", { n: row.total, v: row.byStatus.verified })
                      : t("crRowSub", { n: totals.plans, v: totals.verified })}
                  </Mono>
                </span>
                <span className="text-right">
                  <b className="block font-mono text-sm tabular-nums text-water-700">{chip(row ? row.harvestingLitres : (all?.selected.harvestingLitres ?? 0))}</b>
                  {row && row.complianceScore !== null && (
                    <Mono className="block">{t("crPct", { n: formatNum(Math.round(row.complianceScore * 1000) / 10) })}</Mono>
                  )}
                  {(row ? row.applications?.awaiting : all?.selected.applications?.awaiting) ? (
                    <span className="mt-1 inline-block bg-status-applied/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-status-applied">
                      {t("crToReview", { n: (row ? row.applications?.awaiting : all?.selected.applications?.awaiting) ?? 0 })}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </nav>

        <Link to="/start" className="flex min-h-14 items-center gap-3 bg-cta px-5 font-bold text-cta-ink hover:bg-cta-hover">
          <span className="text-xl" aria-hidden="true">
            ＋
          </span>
          {t("crPlanBuilding")}
        </Link>
        <Link to="/dashboard?view=list" className="flex min-h-11 items-center justify-between border-t border-line px-5 text-sm text-ink-soft hover:bg-panel-2">
          {t("crListView")} <span aria-hidden="true">→</span>
        </Link>
      </aside>

      {/* ---------- Map stage ---------- */}
      <section className="cr-map relative min-w-0 overflow-hidden" aria-label={t("mapTitle")}>
        <MapContainer center={DELHI} zoom={11} maxZoom={19} zoomControl={false} preferCanvas className="h-full w-full">
          <TileLayer url={BASEMAP} attribution={BASEMAP_ATTRIBUTION} maxNativeZoom={16} maxZoom={19} />
          <FitTo bounds={bounds} />
          {buildings && detail && <BuildingsLayer features={buildings} buckets={buckets} polygonsMinZoom={detail.polygonsMinZoom} fillFor={fillFor} />}

          {/* All wards: one chip per ward with litres captured by built systems. */}
          {!ward &&
            all?.wards.map((w) => {
              const g = w.slug ? geoBySlug.get(w.slug) : undefined;
              if (!g) return null;
              const tr = tier(w);
              const icon = L.divIcon({
                className: "",
                iconSize: [0, 0],
                html: `<div class="ward-chip" style="--chip:${TIER_COLOR[tr]}"><b>${escapeHtml(chip(w.harvestingLitres))}</b><span>${escapeHtml(w.ward)}</span></div>`,
              });
              return <Marker key={w.ward} position={[g.centroid[1], g.centroid[0]]} icon={icon} eventHandlers={{ click: () => setWard(w.ward) }} />;
            })}

          {/* Plans in the selected ward, coloured by status. */}
          {/* Filed applications get a ring: green approved, amber site visit, red not approved, blue dashed awaiting. */}
          {ward &&
            data?.points
              .filter((p) => p.filed)
              .map((p) => (
                <CircleMarker
                  key={`ring-${p.planId}`}
                  center={[p.lat, p.lon]}
                  radius={(selectedPlan?.planId === p.planId ? 11 : 7) + 5}
                  pathOptions={{
                    color: p.review ? DECISION_RING[p.review] : statusColor.applied,
                    weight: 2.5,
                    dashArray: p.review ? undefined : "3 4",
                    fill: false,
                  }}
                  eventHandlers={{ click: () => setSelectedPlan(p) }}
                />
              ))}
          {ward &&
            data?.points.map((p) => (
              <CircleMarker
                key={p.planId}
                center={[p.lat, p.lon]}
                radius={selectedPlan?.planId === p.planId ? 11 : 7}
                pathOptions={{ color: night.panel, weight: selectedPlan?.planId === p.planId ? 3 : 1.5, fillColor: statusColor[p.status], fillOpacity: 1 }}
                eventHandlers={{ click: () => setSelectedPlan(p) }}
              />
            ))}
        </MapContainer>
        <div className="map-vignette absolute inset-0 z-[450]" aria-hidden="true" />
        {raining && <div className="rain-overlay pointer-events-none absolute inset-0 z-[460]" aria-hidden="true" />}

        <div className="pointer-events-none absolute left-7 top-6 z-[500] max-w-[70%]">
          <Mono className="text-glow">{ward ? t("crMapEyebrowWard") : t("crMapEyebrowAll")}</Mono>
          <h2 className="mt-2 font-display text-[clamp(2.4rem,5vw,4.5rem)] font-extrabold uppercase leading-[0.9] tracking-tight text-ink [text-shadow:0_2px_18px_rgb(255_255_255_/_0.9)]">
            {ward ?? t("crAllWards")}
          </h2>
          {s && (
            <p className="mt-2 font-mono text-xs text-ink-soft">
              {t("crRowSub", { n: s.total, v: s.byStatus.verified })} ·{" "}
              <b className="text-cta">{t("crBuiltN", { n: builtCount(s.byStatus) })}</b>
              {s.applications?.awaiting ? (
                <>
                  {" · "}
                  <b className="text-status-applied">{t("crAwaitingN", { n: s.applications.awaiting })}</b>
                </>
              ) : null}
            </p>
          )}
        </div>

        {/* Legend */}
        <div className="glass absolute bottom-20 left-6 z-[500] flex flex-wrap gap-x-4 gap-y-1 rounded-none px-4 py-2.5">
          {(ward ? STATUS_ORDER : (["good", "mid", "bad"] as const)).map((k) => (
            <span key={k} className="flex items-center gap-2 text-xs text-ink-soft">
              <i
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: ward ? statusColor[k as PlanStatus] : TIER_COLOR[k as "good" | "mid" | "bad"] }}
                aria-hidden="true"
              />
              {ward ? t(`status_${k as PlanStatus}`) : t(k === "good" ? "crTierGood" : k === "mid" ? "crTierMid" : "crTierBad")}
            </span>
          ))}
          {ward && (
            <span className="flex items-center gap-2 text-xs text-ink-soft">
              <i className="h-3 w-3 rounded-full border-2" style={{ borderColor: statusColor.verified }} aria-hidden="true" />
              {t("crLegendApproved")}
            </span>
          )}
        </div>

        {/* Evidence bar */}
        <div className="absolute inset-x-0 bottom-0 z-[500] grid grid-cols-4 border-t border-line bg-panel/95 backdrop-blur">
          {[
            [t("crRainfall"), detail ? `${formatNum(Math.round(detail.rainfallMm))} mm · ${detail.rainfallSource}` : t("crRainfallAll")],
            [t("crBuildings"), detail ? formatNum(detail.buildingCount) : "—"],
            [t("crRequired"), detail ? formatNum(detail.requiredCount) : "—"],
            [t("crVerification"), t("crVerificationVal")],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0 border-r border-line px-5 py-3 last:border-r-0">
              <Mono className="block">{label}</Mono>
              <b className="mt-1 block truncate font-mono text-xs font-medium text-ink">{value}</b>
            </div>
          ))}
        </div>

        {error && (
          <div className="absolute right-6 top-6 z-[600] max-w-sm border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900" role="alert">
            {error}{" "}
            <button type="button" className="ml-2 font-semibold underline" onClick={() => setReload((n) => n + 1)}>
              {t("retry")}
            </button>
          </div>
        )}
        {ward && slug && !buildings && (
          <div className="glass absolute right-6 top-6 z-[500] rounded-none px-4 py-2 text-sm text-ink-soft" role="status">
            {t("wardLoading")}
          </div>
        )}
      </section>

      {/* ---------- Inspector ---------- */}
      <aside className="min-h-0 overflow-y-auto border-l border-line bg-panel">
        <div className="flex items-start justify-between gap-3 border-b border-line px-6 py-5">
          <div className="min-w-0">
            <Mono>{selectedPlan ? t("crSelectedPlan") : t("crSelectedWard")}</Mono>
            <h2 className="mt-1 truncate font-display text-2xl font-extrabold uppercase tracking-tight text-ink">{ward ?? t("crAllWards")}</h2>
          </div>
          {(ward || selectedPlan) && (
            <button
              type="button"
              className="grid h-10 w-10 shrink-0 place-items-center border border-line-strong text-ink-soft hover:border-cta hover:text-cta"
              onClick={() => (selectedPlan ? setSelectedPlan(null) : setWard(undefined))}
              aria-label={selectedPlan ? t("close") : t("crShowAll")}
              title={selectedPlan ? t("close") : t("crShowAll")}
            >
              {selectedPlan ? "✕" : "⌗"}
            </button>
          )}
        </div>

        {selectedPlan && (
          <section className="space-y-3 border-b border-line bg-panel-2 px-6 py-5" aria-live="polite">
            <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: statusColor[selectedPlan.status] }}>
              <i className="h-2.5 w-2.5 rounded-full" style={{ background: statusColor[selectedPlan.status] }} aria-hidden="true" />
              {t(`status_${selectedPlan.status}`)}
            </div>
            <div className="font-display text-4xl font-extrabold tabular-nums text-ink">{t("litresShort", { n: formatNum(selectedPlan.litresPerYear) })}</div>
            <Mono>{t("litresPerYear")}</Mono>
            {selectedPlan.filed && (
              <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: selectedPlan.review ? DECISION_RING[selectedPlan.review] : statusColor.applied }}>
                <i className="h-2.5 w-2.5 rounded-full border-2" style={{ borderColor: "currentColor" }} aria-hidden="true" />
                {t(`crPlanReview_${selectedPlan.review ?? "awaiting"}`)}
              </p>
            )}
            {selectedPlan.filed && !selectedPlan.review && (
              <Link to={`/officer/applications?plan=${encodeURIComponent(selectedPlan.planId)}`} className="btn-secondary w-full rounded-none">
                {t("crAppsReview")} →
              </Link>
            )}
            <button type="button" className="btn-primary w-full rounded-none" onClick={() => navigate(`/plan/${selectedPlan.planId}`)}>
              {t("crOpenPlan")} →
            </button>
          </section>
        )}

        {/* Hero number */}
        <section className="relative overflow-hidden border-b border-line border-l-[3px] border-l-cta px-6 py-6">
          <Mono>{t("crHeroLabel")}</Mono>
          <div className="mt-3 flex items-baseline gap-2">
            <strong className="font-display text-6xl font-extrabold leading-none tracking-tight tabular-nums text-ink">{hero.n}</strong>
            <span className="text-lg font-semibold text-water-700">{t(heroUnit)}</span>
          </div>
          {s && <p className="mt-2 font-mono text-xs text-ink-muted">{t("ofPotential", { n: formatNum(s.potentialLitres) })}</p>}
          {compliance !== undefined && compliance !== null && (
            <div className="mt-4 inline-flex items-center gap-2 border border-cta/60 px-3 py-1.5 font-mono text-sm text-cta">
              {t("crCompliance", { n: formatNum(Math.round(compliance * 1000) / 10) })}
            </div>
          )}
        </section>

        {/* Where plans stand */}
        {s && (
          <section className="border-b border-line px-6 py-5">
            <div className="flex items-baseline justify-between">
              <Mono>{t("pipeline")}</Mono>
              <Mono className="text-ink-soft">{t("crTotalN", { n: s.total })}</Mono>
            </div>
            <ul className="mt-3 space-y-2.5">
              {STATUS_ORDER.map((st) => (
                <li key={st} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
                  <span className="flex items-center gap-2 text-sm text-ink-soft">
                    <i className="h-2.5 w-2.5 rounded-full" style={{ background: statusColor[st] }} aria-hidden="true" />
                    {t(`status_${st}`)}
                  </span>
                  <b className="font-mono text-sm tabular-nums text-ink">{s.byStatus[st]}</b>
                  <span className="col-span-2 h-1 bg-line" aria-hidden="true">
                    <span className="block h-full" style={{ width: `${s.total ? (s.byStatus[st] / s.total) * 100 : 0}%`, background: statusColor[st] }} />
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Applications: what the ward officer has decided, and where approved water goes */}
        {s?.applications && <ApplicationsPanel apps={s.applications} ward={ward} />}

        {/* Simulate monsoon (wards with footprints) */}
        {slug && buildings && (
          <section className="border-b border-line px-6 py-5 [&_.card]:rounded-none [&_.card]:border-white/10 [&_.card]:bg-transparent [&_.card]:p-0 [&_.card]:shadow-none">
            <SimulatePanel slug={slug} wardName={ward ?? ""} dailyCycles={detail?.dailyCycles} onResult={setSim} onPlaying={setRaining} />
          </section>
        )}

        {/* Ward ranking */}
        <section className="border-b border-line px-6 py-5">
          <div className="flex items-baseline justify-between">
            <Mono>{t("wardTable")}</Mono>
            <Mono className="text-ink-soft">{t("crMostWater")}</Mono>
          </div>
          <ol className="mt-3">
            {ranking.map((w, i) => (
              <li key={w.ward}>
                <button
                  type="button"
                  onClick={() => setWard(w.ward)}
                  className={`grid min-h-10 w-full grid-cols-[1.5rem_6.5rem_1fr_auto] items-center gap-3 text-left hover:bg-panel-2 ${w.ward === ward ? "text-cta" : "text-ink"}`}
                >
                  <span className="font-mono text-xs text-ink-muted">{String(i + 1).padStart(2, "0")}</span>
                  <span className="truncate text-xs font-semibold uppercase">{w.ward}</span>
                  <span className="h-1 bg-line" aria-hidden="true">
                    <span className="block h-full" style={{ width: `${(w.harvestingLitres / maxLitres) * 100}%`, background: TIER_COLOR[tier(w)] }} />
                  </span>
                  <span className="font-mono text-xs tabular-nums">{chip(w.harvestingLitres)}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>

        {/* Verification receipts: systems needing attention */}
        <section className="px-6 py-5">
          <div className="flex items-baseline justify-between">
            <Mono>{t("crReceipts")}</Mono>
            <Mono className="text-ink-soft">{attention ? t("crTotalN", { n: attention.length }) : "…"}</Mono>
          </div>
          {attention && attention.length === 0 && <p className="mt-3 text-sm text-ink-muted">{t("noAttention")}</p>}
          <ul className="mt-2">
            {attention?.slice(0, 5).map((r) => (
              <li key={r.planId}>
                <button
                  type="button"
                  onClick={() => navigate(`/plan/${r.planId}`)}
                  className="grid min-h-14 w-full grid-cols-[0.5rem_1fr_auto] items-center gap-3 border-b border-line text-left hover:bg-panel-2"
                >
                  <i className="h-2 w-2 bg-status-attention" aria-hidden="true" />
                  <span className="min-w-0">
                    <b className="block truncate text-sm text-ink">
                      {r.lastVerdict ? t(`verdict_${r.lastVerdict}`) : t("status_needs_attention")}
                      {r.lastComponent ? ` · ${t(`component_${r.lastComponent}`)}` : ""}
                    </b>
                    <Mono className="block normal-case">
                      {r.ward ?? "—"} · {t(`structure_${r.structure}`)}
                    </Mono>
                  </span>
                  <span className="font-mono text-xs text-red-800">{r.daysOpen !== null ? t("daysN", { n: r.daysOpen }) : "—"}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-ink-muted">{t("estimateNote")}</p>
        </section>
      </aside>
    </div>
  );
}

function ApplicationsPanel({ apps, ward }: { apps: NonNullable<DashboardT["selected"]["applications"]>; ward?: string }) {
  const { t } = useI18n();
  const cells: [StringKey, number, string][] = [
    ["crAppsAwaiting", apps.awaiting, statusColor.applied],
    ["crAppsApproved", apps.approved, statusColor.verified],
    ["crAppsSiteVisit", apps.siteVisit, statusColor.installed],
    ["crAppsRejected", apps.rejected, statusColor.needs_attention],
  ];
  const maxDest = Math.max(1, ...DEST_ORDER.map((d) => apps.destinations[d].litres));
  return (
    <section className="border-b border-line px-6 py-5">
      <div className="flex items-baseline justify-between">
        <Mono>{t("crApps")}</Mono>
        <Mono className="text-ink-soft">{t("crTotalN", { n: apps.filed })}</Mono>
      </div>
      {apps.filed === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">{t("crAppsNone")}</p>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-2 border border-line">
            {cells.map(([label, n, colour], i) => (
              <div key={label} className={`px-3 py-2.5 ${i % 2 ? "border-l border-line" : ""} ${i >= 2 ? "border-t border-line" : ""}`}>
                <dd className="font-display text-2xl font-extrabold tabular-nums" style={{ color: n ? colour : undefined }}>
                  {formatNum(n)}
                </dd>
                <dt>
                  <Mono>{t(label)}</Mono>
                </dt>
              </div>
            ))}
          </dl>
          {apps.approved > 0 && (
            <div className="mt-4">
              <div className="flex items-baseline justify-between gap-2">
                <Mono>{t("crWaterGoes")}</Mono>
              </div>
              <p className="mt-1 font-mono text-xs text-ink-muted">{t("crAppsApprovedLitres", { n: formatNum(apps.approvedLitres) })}</p>
              <ul className="mt-2 space-y-2">
                {DEST_ORDER.filter((d) => apps.destinations[d].plans > 0).map((d) => (
                  <li key={d} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
                    <span className="text-sm text-ink-soft">{t(`dest_${d}`)}</span>
                    <b className="font-mono text-xs tabular-nums text-ink">{formatNum(apps.destinations[d].plans)}</b>
                    <span className="col-span-2 h-1 bg-line" aria-hidden="true">
                      <span className="block h-full" style={{ width: `${(apps.destinations[d].litres / maxDest) * 100}%`, background: DEST_COLOR[d] }} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Link
            to={`/officer/applications${ward ? `?ward=${encodeURIComponent(ward)}` : ""}`}
            className="mt-4 flex min-h-11 items-center justify-between border border-cta px-4 text-sm font-semibold text-cta hover:bg-cta hover:text-cta-ink"
          >
            {t("crAppsReview")}
            {apps.awaiting > 0 && <span className="font-mono text-xs">{t("crToReview", { n: apps.awaiting })}</span>}
            <span aria-hidden="true">→</span>
          </Link>
        </>
      )}
    </section>
  );
}
