import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { CircleMarker, MapContainer, Polygon, TileLayer, useMap } from "react-leaflet";
import { api, ApiError, type Plan } from "../lib/api";
import { formatInr, formatNum } from "../lib/area";
import { Rich, useI18n } from "../lib/i18n";
import { night, water } from "../lib/tokens";

const ESRI_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const ESRI_ATTRIBUTION = "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community";

/** Counts a number up from 0 once (instantly when the user prefers less motion). */
export function useCountUp(target: number, ms = 1100): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setValue(target);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      setValue(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, ms]);
  return value;
}

/** Frames the roof outline once the map has its real size (MapContainer ignores bounds when a center is given). */
function FitRoof({ bounds }: { bounds: [[number, number], [number, number]] | null }) {
  const map = useMap();
  useEffect(() => {
    if (!bounds) return;
    const fit = () => {
      map.invalidateSize();
      map.fitBounds(bounds, { padding: [48, 48], maxZoom: 20, animate: false });
    };
    fit();
    const id = window.setTimeout(fit, 120);
    return () => window.clearTimeout(id);
  }, [map, bounds]);
  return null;
}

/** Non-interactive satellite view of the user's roof with its outline. */
export function RoofMiniMap({ plan }: { plan: Plan }) {
  const ring = useMemo(
    () => (plan.roofPolygon ? plan.roofPolygon.coordinates[0].map(([lon, lat]) => [lat, lon] as [number, number]) : null),
    [plan.roofPolygon],
  );
  const bounds = useMemo(() => {
    if (!ring) return null;
    const lats = ring.map((p) => p[0]);
    const lons = ring.map((p) => p[1]);
    return [
      [Math.min(...lats), Math.min(...lons)],
      [Math.max(...lats), Math.max(...lons)],
    ] as [[number, number], [number, number]];
  }, [ring]);
  return (
    <MapContainer
      center={ring ? ring[0] : [plan.lat, plan.lon]}
      zoom={19}
      maxZoom={21}
      zoomControl={false}
      dragging={false}
      scrollWheelZoom={false}
      doubleClickZoom={false}
      touchZoom={false}
      keyboard={false}
      className="h-full w-full"
    >
      <TileLayer url={ESRI_URL} attribution={ESRI_ATTRIBUTION} maxNativeZoom={19} maxZoom={21} />
      <FitRoof bounds={bounds} />
      {ring ? (
        <Polygon positions={ring} pathOptions={{ color: "#ffffff", weight: 3, fillColor: water[400], fillOpacity: 0.4 }} />
      ) : (
        <CircleMarker center={[plan.lat, plan.lon]} radius={9} pathOptions={{ color: night.panel, weight: 3, fillColor: night.cta, fillOpacity: 1 }} />
      )}
    </MapContainer>
  );
}

/** Row of drops, one per water tanker (capped), so the number has a picture. */
function TankerDrops({ n }: { n: number }) {
  const shown = Math.min(20, Math.max(1, Math.round(n)));
  return (
    <div className="flex flex-wrap gap-1.5" aria-hidden="true">
      {Array.from({ length: shown }, (_, i) => (
        <svg key={i} viewBox="0 0 24 24" className="h-6 w-5 drop-in" style={{ animationDelay: `${300 + i * 60}ms` }}>
          <path d="M12 2C12 2 4 11 4 15.5a8 8 0 0 0 16 0C20 11 12 2 12 2z" fill={water[400]} />
          <path d="M8.5 15.5a3.5 3.5 0 0 0 3.5 3.5" stroke={water[100]} strokeWidth="1.8" fill="none" strokeLinecap="round" />
        </svg>
      ))}
    </div>
  );
}

/** The headline result: big litres number, tankers, legal status, and the roof itself. */
export function PlanHero({ plan }: { plan: Plan }) {
  const { t } = useI18n();
  const litres = useCountUp(Math.round(plan.litresPerYear / 100) * 100);
  return (
    <section className="overflow-hidden rounded-(--radius-card) border border-line bg-panel shadow-[0_1px_2px_rgb(49_31_24_/_0.04),0_18px_40px_-28px_rgb(49_31_24_/_0.45)]">
      <div className="grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="space-y-5 p-6 sm:p-8">
          <p className="text-sm font-semibold text-glow">{t("planHeroLabel")}</p>
          <div>
            <div className="font-display text-[clamp(3rem,8vw,5.25rem)] font-bold leading-none tracking-tight text-ink tabular-nums">
              {formatNum(Math.round(litres))}
            </div>
            <p className="mt-2 text-xl text-ink-soft">{t("litresAYear")}</p>
          </div>
          <div className="space-y-2">
            <TankerDrops n={plan.tankersEquivalent} />
            <p className="text-ink-soft">{t("tankersLine", { n: formatNum(Math.round(plan.tankersEquivalent * 10) / 10) })}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span
              className={`rounded-full px-3 py-1 text-sm font-semibold ${plan.mandatory ? "bg-amber-100 text-amber-900" : "bg-panel-2 text-ink-soft"}`}
            >
              {plan.mandatory ? t("requiredBadge") : t("optionalBadge")}
            </span>
            <span className="rounded-full bg-water-50 px-3 py-1 text-sm font-semibold text-glow">{t(`structure_${plan.structure.type}`)}</span>
          </div>
        </div>
        <figure className="relative min-h-60 border-t border-line lg:min-h-full lg:border-l lg:border-t-0">
          <div className="absolute inset-0">
            <RoofMiniMap plan={plan} />
          </div>
          <figcaption className="absolute left-3 top-3 z-[500] rounded-lg bg-panel/95 px-3 py-1.5 text-sm font-semibold text-ink shadow">
            {t("yourRoofArea", { n: formatNum(Math.round(plan.roofAreaM2)) })}
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

/** Four key numbers in a row. Payback shows a call to add the bill when it can't be worked out yet. */
export function StatStrip({ plan, onAddBill }: { plan: Plan; onAddBill: () => void }) {
  const { t } = useI18n();
  const m = plan.money;
  const tiles: { label: string; value: ReactNode; tone?: "good" }[] = [
    { label: t("statYouPay"), value: formatInr(m.netCostInr) },
    { label: t("statYearly"), value: m.annualBenefitInr > 0 ? formatInr(m.annualBenefitInr) : "—", tone: m.annualBenefitInr > 0 ? "good" : undefined },
    {
      label: t("statPayback"),
      value:
        m.paybackYears !== null ? (
          t("years", { n: formatNum(m.paybackYears) })
        ) : (
          <button type="button" onClick={onAddBill} className="text-base font-semibold text-cta underline underline-offset-4 hover:text-cta-hover">
            {t("addBillShort")}
          </button>
        ),
    },
    { label: t("statRain"), value: t("mmYear", { n: formatNum(Math.round(plan.rainfallMm)) }) },
  ];
  return (
    <dl className="grid grid-cols-2 overflow-hidden rounded-(--radius-card) border border-line bg-panel lg:grid-cols-4">
      {tiles.map((x, i) => (
        <div key={x.label} className={`space-y-1 p-5 ${i % 2 ? "border-l border-line" : ""} ${i >= 2 ? "border-t border-line lg:border-t-0" : ""} ${i === 2 ? "lg:border-l" : ""}`}>
          <dt className="text-sm text-ink-muted">{x.label}</dt>
          <dd className={`font-display text-xl font-bold tabular-nums sm:text-3xl ${x.tone === "good" ? "text-status-verified" : "text-ink"}`}>{x.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Prominent prompt for the Jal Board water bill: one field, saved straight to the plan, numbers update in place. */
export function BillBanner({ plan, onPlanChange, focusSignal }: { plan: Plan; onPlanChange: (p: Plan) => void; focusSignal: number }) {
  const { t } = useI18n();
  const id = useId();
  const [bill, setBill] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (focusSignal) document.getElementById(id)?.focus();
  }, [focusSignal, id]);

  async function save() {
    const value = Number(bill);
    if (!(value > 0)) return;
    setSaving(true);
    setError(null);
    try {
      onPlanChange(await api.updatePlan(plan.planId, { monthlyWaterBill: value }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-(--radius-card) border border-cta/30 bg-water-50 p-5 sm:p-6" aria-labelledby={`${id}-t`}>
      <div className="grid items-end gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <h2 id={`${id}-t`} className="text-lg font-bold text-ink">
            {t("billBannerTitle")}
          </h2>
          <p className="mt-1 text-ink-soft">
            <Rich text={t("billBannerBody")} />
          </p>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label htmlFor={id} className="sr-only">
            {t("billQ")}
          </label>
          <div className="flex h-11 items-center rounded-lg border border-line-strong bg-panel focus-within:border-cta focus-within:ring-2 focus-within:ring-cta/20">
            <span className="pl-3 text-ink-muted">₹</span>
            <input id={id} className="h-full w-28 bg-transparent px-2 text-base text-ink outline-none" inputMode="decimal" value={bill} onChange={(e) => setBill(e.target.value)} />
            <span className="pr-3 text-sm text-ink-muted">{t("perMonth")}</span>
          </div>
          <button className="btn-primary h-11 min-h-0" disabled={saving || !(Number(bill) > 0)}>
            {saving ? t("saving") : t("save")}
          </button>
        </form>
      </div>
      {error && (
        <p className="mt-3 text-sm text-red-800" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
