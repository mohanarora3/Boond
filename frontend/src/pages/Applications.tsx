import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import L from "leaflet";
import { CircleMarker, MapContainer, Polygon, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import { ErrorState, Skeleton } from "../components/States";
import {
  api,
  ApiError,
  type ApplicationRow,
  type Applications as ApplicationsT,
  type Destination,
  type NearbyWater,
  type ReviewDecision,
  type WaterFeature,
} from "../lib/api";
import { formatInr, formatNum } from "../lib/area";
import { useI18n, type StringKey } from "../lib/i18n";
import { distanceLabel, kindLabel } from "../lib/waterLabels";
import { night, statusColor, water } from "../lib/tokens";

/*
 * Ward officer inbox: every application a homeowner has actually filed (no demo data), newest first.
 * The officer opens one, sees the roof and the real ponds, lakes, reservoirs and drains around it (OpenStreetMap),
 * decides, and picks where the water goes. The homeowner sees the decision on their plan page.
 */

const ESRI_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const ESRI_ATTRIBUTION = "Imagery &copy; Esri, Maxar | Water &copy; OpenStreetMap contributors";
const DECISIONS: ReviewDecision[] = ["approved", "site_visit", "rejected"];
const DECISION_COLOR: Record<ReviewDecision, string> = {
  approved: statusColor.verified,
  site_visit: statusColor.installed,
  rejected: statusColor.needs_attention,
};

function useDate() {
  const { lang } = useI18n();
  return (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleDateString(lang === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

/* ---------- Map ---------- */

/** Far-off features would zoom the map out past the house. */
function worthFraming(f: WaterFeature) {
  return f.distanceM <= 2500;
}

function Fit({ row, points }: { row: ApplicationRow; points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    const all: [number, number][] = [[row.lat, row.lon], ...points];
    // The map sits in a grid cell that may still be settling; measure first so the frame is right.
    const id = window.setTimeout(() => {
      map.invalidateSize();
      if (all.length === 1) map.setView(all[0], 18);
      else map.fitBounds(L.latLngBounds(all), { padding: [40, 40], maxZoom: 18 });
    }, 50);
    return () => window.clearTimeout(id);
  }, [map, row.lat, row.lon, points]);
  return null;
}

function ApplicationMap({
  row,
  features,
  selected,
  onPick,
}: {
  row: ApplicationRow;
  features: WaterFeature[];
  selected: WaterFeature | null;
  onPick: (f: WaterFeature) => void;
}) {
  const { t } = useI18n();
  const ring = row.roofPolygon?.coordinates[0].map(([lon, lat]) => [lat, lon] as [number, number]);
  // Frame the house with what matters: the chosen feature, else the nearest pond and the nearest drain.
  const framing = useMemo(() => {
    const pick = selected
      ? [selected]
      : [features.find((f) => f.category === "water_body"), features.find((f) => f.category === "channel")].filter(Boolean);
    return (pick as WaterFeature[]).filter(worthFraming).map((f) => [f.lat, f.lon] as [number, number]);
  }, [features, selected]);

  return (
    <MapContainer center={[row.lat, row.lon]} zoom={17} maxZoom={20} className="h-full w-full" scrollWheelZoom={false}>
      <TileLayer url={ESRI_URL} attribution={ESRI_ATTRIBUTION} maxNativeZoom={19} maxZoom={20} />
      <Fit row={row} points={framing} />
      {selected && (
        <Polyline
          positions={[
            [row.lat, row.lon],
            [selected.lat, selected.lon],
          ]}
          pathOptions={{ color: night.panel, weight: 3, dashArray: "6 8", opacity: 0.95 }}
        />
      )}
      {features.map((f) => {
        const on = selected?.osmId === f.osmId;
        const body = f.category === "water_body";
        return (
          <CircleMarker
            key={f.osmId}
            center={[f.lat, f.lon]}
            radius={on ? 11 : body ? 8 : 6}
            eventHandlers={{ click: () => onPick(f) }}
            pathOptions={{ color: night.panel, weight: on ? 3 : 2, fillColor: body ? water[400] : night.cta, fillOpacity: 1 }}
          >
            <Tooltip direction="top" offset={[0, -8]}>
              {`${f.name || kindLabel(t, f.kind)} · ${distanceLabel(t, f.distanceM)}`}
            </Tooltip>
          </CircleMarker>
        );
      })}
      {ring ? (
        <Polygon positions={ring} pathOptions={{ color: "#ffffff", weight: 3, fillColor: statusColor.installed, fillOpacity: 0.45 }} />
      ) : null}
      <CircleMarker center={[row.lat, row.lon]} radius={7} pathOptions={{ color: "#ffffff", weight: 3, fillColor: statusColor.installed, fillOpacity: 1 }} />
    </MapContainer>
  );
}

/* ---------- Pieces ---------- */

function DecisionPill({ decision }: { decision: ReviewDecision }) {
  const { t } = useI18n();
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold"
      style={{ background: `${DECISION_COLOR[decision]}1f`, color: DECISION_COLOR[decision] }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: DECISION_COLOR[decision] }} aria-hidden="true" />
      {t(`decisionDone_${decision}`)}
    </span>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="font-semibold text-ink tabular-nums">{children}</dd>
    </div>
  );
}

function Choice({
  name,
  checked,
  onChange,
  disabled,
  title,
  detail,
  suggested,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  title: string;
  detail?: string;
  suggested?: boolean;
}) {
  const { t } = useI18n();
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3 transition ${
        checked ? "border-cta bg-cta/5" : "border-line hover:border-line-strong"
      } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
    >
      <input type="radio" name={name} className="mt-1 h-4 w-4 accent-[var(--color-cta)]" checked={checked} onChange={onChange} disabled={disabled} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2 font-medium text-ink">
          {title}
          {suggested && <span className="rounded-full bg-water-50 px-2 py-0.5 text-xs font-semibold text-glow">{t("appsSuggested")}</span>}
        </span>
        {detail && <span className="mt-0.5 block text-sm text-ink-muted">{detail}</span>}
      </span>
    </label>
  );
}

/* ---------- Detail + decision ---------- */

function Detail({ row, onSaved }: { row: ApplicationRow; onSaved: (r: ApplicationRow) => void }) {
  const { t } = useI18n();
  const date = useDate();
  const [nearby, setNearby] = useState<NearbyWater | null>(null);
  const [nearbyError, setNearbyError] = useState(false);
  const [decision, setDecision] = useState<ReviewDecision | null>(row.review?.decision ?? null);
  const [destKey, setDestKey] = useState<string | null>(null);
  const [note, setNote] = useState(row.review?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    setNearby(null);
    setNearbyError(false);
    api
      .nearbyWater(row.planId)
      .then((n) => live && setNearby(n))
      .catch(() => live && setNearbyError(true));
    return () => {
      live = false;
    };
  }, [row.planId]);

  const features = nearby?.features ?? [];
  const bodies = features.filter((f) => f.category === "water_body").slice(0, 5);
  const drains = features.filter((f) => f.category === "channel").slice(0, 3);
  const keyOf = (d: Destination | null | undefined) => (!d ? null : d.osmId ? `osm:${d.osmId}` : d.type);

  // Start from the saved decision, else from the suggestion once the map data arrives.
  useEffect(() => {
    if (destKey) return;
    const start = row.review?.destination ?? nearby?.suggestion;
    if (start) setDestKey(keyOf(start));
  }, [nearby, row.review, destKey]);

  const selectedFeature = destKey?.startsWith("osm:") ? features.find((f) => `osm:${f.osmId}` === destKey) ?? null : null;
  const suggestedKey = keyOf(nearby?.suggestion);
  const rechargeOk = row.openSpace && !row.structure.rechargeRuledOut;

  function destination(): Destination | null {
    if (!destKey) return null;
    if (selectedFeature)
      return {
        type: selectedFeature.category === "water_body" ? "water_body" : "storm_drain",
        osmId: selectedFeature.osmId,
        name: selectedFeature.name,
        kind: selectedFeature.kind,
        distanceM: selectedFeature.distanceM,
      };
    if (destKey.startsWith("osm:")) return row.review?.destination ?? null; // saved feature no longer in the live list
    return { type: destKey as Destination["type"] };
  }

  const needsNote = decision === "site_visit" || decision === "rejected";
  const canSave = !!decision && (decision !== "approved" || !!destination()) && (!needsNote || note.trim().length > 0);

  async function save() {
    if (!decision) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const plan = await api.review(row.planId, { decision, destination: decision === "approved" ? destination() : null, note: note.trim() });
      onSaved({ ...row, review: plan.review ?? null });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const safety = [
    ...row.feasibility.reasons.map((r) => ({ code: r, tone: "bad" as const })),
    ...row.feasibility.warnings.map((r) => ({ code: r, tone: "warn" as const })),
  ];

  return (
    <article className="overflow-hidden rounded-(--radius-card) border border-line bg-panel shadow-[0_1px_2px_rgb(49_31_24_/_0.04),0_18px_40px_-28px_rgb(49_31_24_/_0.45)]">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line p-5 sm:p-6">
        <div className="min-w-0 space-y-1">
          <p className="text-sm text-ink-muted">
            {row.ward} · {t("appsFiled", { date: date(row.appliedAt) })}
          </p>
          <h2 className="text-xl font-bold text-ink">{row.address}</h2>
        </div>
        {row.review && <DecisionPill decision={row.review.decision} />}
      </header>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Map and the facts the officer checks */}
        <div className="border-b border-line lg:border-b-0 lg:border-r">
          <div className="relative h-72 lg:h-96">
            <ApplicationMap
              row={row}
              features={features}
              selected={selectedFeature}
              onPick={(f) => {
                setDestKey(`osm:${f.osmId}`);
                setDecision((d) => d ?? "approved");
              }}
            />
            <ul className="pointer-events-none absolute bottom-3 left-3 z-[500] space-y-1 rounded-lg bg-panel/95 px-3 py-2 text-xs text-ink shadow">
              <li className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: statusColor.installed }} aria-hidden="true" />
                {t("appsLegendHouse")}
              </li>
              <li className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: water[400] }} aria-hidden="true" />
                {t("appsLegendBody")}
              </li>
              <li className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: night.cta }} aria-hidden="true" />
                {t("appsLegendDrain")}
              </li>
            </ul>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-4 p-5 sm:grid-cols-3 sm:p-6">
            <Fact label={t("appsRoof")}>{t("sqmN", { n: formatNum(Math.round(row.roofAreaM2)) })}</Fact>
            <Fact label={t("appsPlot")}>{t("sqmN", { n: formatNum(Math.round(row.plotAreaM2)) })}</Fact>
            <Fact label={t("appsResidents")}>{formatNum(row.residents)}</Fact>
            <Fact label={t("appsSystem")}>
              {row.structure.count > 1 ? `${row.structure.count} × ` : ""}
              {t(`structure_${row.structure.type}`)}
            </Fact>
            <Fact label={t("appsLitres")}>{t("litresN", { n: formatNum(Math.round(row.litresPerYear / 100) * 100) })}</Fact>
            <Fact label={t("appsOwnerPays")}>{formatInr(row.netCostInr)}</Fact>
          </dl>
          <div className="space-y-2 border-t border-line p-5 sm:p-6">
            <h3 className="text-sm font-semibold text-ink">{t("appsSiteSafety")}</h3>
            {safety.length === 0 ? (
              <p className="text-sm text-ink-soft">{row.openSpace ? t("appsSafetyClear") : t("appsNoOpenSpace")}</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {safety.map((s) => (
                  <li key={s.code + s.tone} className={s.tone === "bad" ? "text-red-800" : "text-amber-900"}>
                    {s.tone === "bad" ? t(`reason_${s.code}`) : t(`warning_${s.code}`)}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1 pt-2 text-sm">
              <a href={row.applicationUrl} target="_blank" rel="noreferrer" className="font-semibold text-cta underline underline-offset-4">
                {t("appsOpenPdf")}
              </a>
              <Link to={`/plan/${row.planId}`} className="font-semibold text-cta underline underline-offset-4">
                {t("appsOpenPlan")}
              </Link>
            </div>
          </div>
        </div>

        {/* Decision */}
        <form
          className="space-y-5 p-5 sm:p-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSave) save();
          }}
        >
          <fieldset className="space-y-2.5">
            <legend className="text-[0.95rem] font-semibold text-ink">{t("appsDecision")}</legend>
            <div role="radiogroup" aria-label={t("appsDecision")} className="mt-2.5 inline-flex w-full rounded-lg border border-line-strong bg-panel p-1">
              {DECISIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={decision === d}
                  onClick={() => {
                    setDecision(d);
                    setSaved(false);
                  }}
                  className={`min-h-10 flex-1 rounded-md px-3 text-sm font-medium transition ${
                    decision === d ? "text-white shadow-sm" : "text-ink-soft hover:bg-panel-2 hover:text-ink"
                  }`}
                  style={decision === d ? { background: DECISION_COLOR[d] } : undefined}
                >
                  {t(`decision_${d}`)}
                </button>
              ))}
            </div>
          </fieldset>

          {decision === "approved" && (
            <fieldset className="space-y-3">
              <legend className="text-[0.95rem] font-semibold text-ink">{t("appsDestTitle")}</legend>
              <p className="-mt-1 text-sm text-ink-muted">{t("appsDestHelp")}</p>
              {nearby?.suggestion && (
                <p className="rounded-lg bg-water-50 px-3 py-2 text-sm text-ink-soft">
                  {t(nearby.suggestion.why.startsWith("recharge_unsafe") ? "why_recharge_unsafe" : (`why_${nearby.suggestion.why}` as StringKey))}
                </p>
              )}

              <Choice
                name="dest"
                checked={destKey === "onsite_recharge"}
                onChange={() => setDestKey("onsite_recharge")}
                disabled={!rechargeOk}
                title={t("dest_onsite_recharge")}
                detail={rechargeOk ? t("destHelp_onsite_recharge") : t("destHelp_onsite_blocked")}
                suggested={suggestedKey === "onsite_recharge"}
              />

              <div className="space-y-2">
                <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">{t("dest_water_body")}</p>
                {!nearby && !nearbyError && <div className="skeleton h-12" />}
                {nearby && bodies.length === 0 && <p className="text-sm text-ink-muted">{nearby.available ? t("appsNoBodies") : t("appsWaterDown")}</p>}
                {bodies.map((f) => (
                  <Choice
                    key={f.osmId}
                    name="dest"
                    checked={destKey === `osm:${f.osmId}`}
                    onChange={() => setDestKey(`osm:${f.osmId}`)}
                    title={f.name || kindLabel(t, f.kind)}
                    detail={f.name ? `${kindLabel(t, f.kind)} · ${distanceLabel(t, f.distanceM)}` : distanceLabel(t, f.distanceM)}
                    suggested={suggestedKey === `osm:${f.osmId}`}
                  />
                ))}
              </div>

              <div className="space-y-2">
                <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">{t("dest_storm_drain")}</p>
                {!nearby && !nearbyError && <div className="skeleton h-12" />}
                {nearby && drains.length === 0 && <p className="text-sm text-ink-muted">{nearby.available ? t("appsNoDrains") : t("appsWaterDown")}</p>}
                {drains.map((f) => (
                  <Choice
                    key={f.osmId}
                    name="dest"
                    checked={destKey === `osm:${f.osmId}`}
                    onChange={() => setDestKey(`osm:${f.osmId}`)}
                    title={f.name || kindLabel(t, f.kind)}
                    detail={f.name ? `${kindLabel(t, f.kind)} · ${distanceLabel(t, f.distanceM)}` : distanceLabel(t, f.distanceM)}
                    suggested={suggestedKey === `osm:${f.osmId}`}
                  />
                ))}
              </div>

              <Choice
                name="dest"
                checked={destKey === "storage_reuse"}
                onChange={() => setDestKey("storage_reuse")}
                title={t("dest_storage_reuse")}
                detail={t("destHelp_storage_reuse")}
                suggested={suggestedKey === "storage_reuse"}
              />
              {nearbyError && <p className="text-sm text-amber-900">{t("appsWaterDown")}</p>}
              {nearby?.stale && nearby.available && <p className="text-sm text-ink-muted">{t("appsWaterStale")}</p>}
            </fieldset>
          )}

          <div className="space-y-1.5">
            <label htmlFor="review-note" className="block text-[0.95rem] font-semibold text-ink">
              {t("appsNote")}
            </label>
            <p className="text-sm text-ink-muted">{t("appsNoteHelp")}</p>
            <textarea
              id="review-note"
              rows={3}
              maxLength={600}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-lg border border-line-strong bg-panel px-3 py-2 text-base text-ink outline-none focus:border-cta focus:ring-2 focus:ring-cta/20"
            />
          </div>

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
              {error}
            </p>
          )}
          {saved && (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900" role="status">
              {t("appsSaved")}
            </p>
          )}
          <div className="border-t border-line pt-5">
            <button className="btn-primary h-12 w-full" disabled={!canSave || saving}>
              {saving ? t("saving") : row.review ? t("appsUpdate") : t("appsSubmit")}
            </button>
            {row.review && (
              <p className="mt-2 text-center text-sm text-ink-muted">
                {t("appsLastDecision", { decision: t(`decisionDone_${row.review.decision}`), date: date(row.review.decidedAt) })}
              </p>
            )}
          </div>
        </form>
      </div>
    </article>
  );
}

/* ---------- Page ---------- */

export default function Applications() {
  const { t } = useI18n();
  const date = useDate();
  const [params, setParams] = useSearchParams();
  const ward = params.get("ward") ?? "";
  const [data, setData] = useState<ApplicationsT | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"awaiting" | "decided">("awaiting");
  const [selectedId, setSelectedId] = useState<string | null>(params.get("plan"));

  const load = useCallback(() => {
    setError(null);
    api
      .applications(ward || undefined)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  }, [ward]);
  useEffect(load, [load]);

  const rows = data?.rows ?? [];
  const awaiting = rows.filter((r) => !r.review);
  const decided = rows.filter((r) => r.review);
  const shown = tab === "awaiting" ? awaiting : decided;
  const selected = rows.find((r) => r.planId === selectedId) ?? null;

  // Open the first one so the page is never empty when there is work.
  useEffect(() => {
    if (!data) return;
    if (selected) return;
    const first = (awaiting[0] ?? decided[0]) || null;
    if (first) {
      setSelectedId(first.planId);
      if (!first.review) setTab("awaiting");
      else if (!awaiting.length) setTab("decided");
    }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  function choose(id: string) {
    setSelectedId(id);
    const next = new URLSearchParams(params);
    next.set("plan", id);
    setParams(next, { replace: true });
    if (window.matchMedia?.("(max-width: 1023px)").matches) document.getElementById("app-detail")?.scrollIntoView({ behavior: "smooth" });
  }

  function onSaved(updated: ApplicationRow) {
    setData((d) => {
      if (!d) return d;
      const was = d.rows.find((r) => r.planId === updated.planId);
      const firstDecision = was && !was.review && updated.review;
      return {
        ...d,
        rows: d.rows.map((r) => (r.planId === updated.planId ? updated : r)),
        wards: d.wards.map((w) => (firstDecision && w.ward === updated.ward ? { ...w, awaiting: Math.max(0, w.awaiting - 1) } : w)),
      };
    });
  }

  const totalAwaiting = data?.wards.reduce((n, w) => n + w.awaiting, 0) ?? 0;

  return (
    <div className="w-screen [margin-inline:calc(50%-50vw)]">
      <div className="mx-auto max-w-7xl space-y-6 px-4 sm:px-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold text-ink">{t("appsTitle")}</h1>
            <p className="max-w-2xl text-ink-soft">{t("appsSub")}</p>
          </div>
          <div className="space-y-1">
            <label htmlFor="apps-ward" className="block text-sm text-ink-muted">
              {t("colWard")}
            </label>
            <select
              id="apps-ward"
              className="h-11 min-w-56 rounded-lg border border-line-strong bg-panel px-3 text-base text-ink outline-none focus:border-cta focus:ring-2 focus:ring-cta/20"
              value={ward}
              onChange={(e) => {
                const next = new URLSearchParams();
                if (e.target.value) next.set("ward", e.target.value);
                setParams(next, { replace: true });
                setSelectedId(null);
                setData(null);
              }}
            >
              <option value="">
                {t("appsAllWards")}
                {data && !ward ? ` (${totalAwaiting})` : ""}
              </option>
              {data?.wards.map((w) => (
                <option key={w.ward} value={w.ward}>
                  {w.ward} ({w.awaiting})
                </option>
              ))}
            </select>
          </div>
        </header>

        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : !data ? (
          <Skeleton lines={3} />
        ) : rows.length === 0 ? (
          <section className="rounded-(--radius-card) border border-dashed border-line-strong bg-panel px-6 py-14 text-center">
            <h2 className="text-xl font-bold text-ink">{t("appsEmptyTitle")}</h2>
            <p className="mx-auto mt-2 max-w-lg text-ink-soft">{t("appsEmpty")}</p>
          </section>
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
            <aside className="space-y-3 lg:sticky lg:top-20">
              <div role="tablist" className="inline-flex w-full rounded-lg border border-line-strong bg-panel p-1">
                {(["awaiting", "decided"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={tab === k}
                    onClick={() => setTab(k)}
                    className={`min-h-10 flex-1 rounded-md px-3 text-sm font-medium transition ${
                      tab === k ? "bg-cta text-cta-ink shadow-sm" : "text-ink-soft hover:bg-panel-2"
                    }`}
                  >
                    {t(k === "awaiting" ? "appsAwaiting" : "appsDecided")} ({k === "awaiting" ? awaiting.length : decided.length})
                  </button>
                ))}
              </div>
              {shown.length === 0 ? (
                <p className="rounded-lg border border-line bg-panel px-4 py-6 text-center text-sm text-ink-muted">
                  {tab === "awaiting" ? t("appsAllDone") : t("appsNoneDecided")}
                </p>
              ) : (
                <ul className="overflow-hidden rounded-(--radius-card) border border-line bg-panel">
                  {shown.map((r) => {
                    const on = r.planId === selectedId;
                    const flagged = r.feasibility.reasons.length > 0;
                    return (
                      <li key={r.planId} className="border-b border-line last:border-0">
                        <button
                          type="button"
                          onClick={() => choose(r.planId)}
                          aria-current={on ? "true" : undefined}
                          className={`w-full space-y-1 border-l-4 px-4 py-3.5 text-left transition ${
                            on ? "border-l-cta bg-cta/5" : "border-l-transparent hover:bg-panel-2"
                          }`}
                        >
                          <span className="flex items-start justify-between gap-2">
                            <span className="line-clamp-2 font-semibold text-ink">{r.address}</span>
                            {r.review && <DecisionPill decision={r.review.decision} />}
                          </span>
                          <span className="block text-sm text-ink-muted">
                            {r.ward} · {date(r.appliedAt)}
                          </span>
                          <span className="flex flex-wrap gap-x-3 text-sm text-ink-soft">
                            <span>{t(`structure_${r.structure.type}`)}</span>
                            <span className="tabular-nums">{t("litresN", { n: formatNum(Math.round(r.litresPerYear / 1000) * 1000) })}</span>
                            {flagged && <span className="font-medium text-status-attention">{t("appsFlagged")}</span>}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </aside>
            <div id="app-detail" className="scroll-mt-20">
              {selected ? <Detail key={selected.planId} row={selected} onSaved={onSaved} /> : <p className="text-ink-muted">{t("appsPick")}</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
