import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { EmptyState, ErrorState, Skeleton } from "../components/States";
import { AttentionTab, GapTab } from "../components/OfficerTabs";
import SimulatePanel from "../components/SimulatePanel";
import ControlRoom from "./ControlRoom";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import { api, ApiError, type Dashboard as DashboardT, type PlanStatus } from "../lib/api";
import { formatNum } from "../lib/area";
import { useI18n } from "../lib/i18n";
import { ink, statusColor as STATUS_COLOR, statusIcon as STATUS_ICON } from "../lib/tokens";

const STATUS_ORDER: PlanStatus[] = ["planned", "applied", "installed", "verified", "needs_attention"];


const BASEMAP = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}";
const BASEMAP_ATTRIBUTION = "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors";

function FitBounds({ points }: { points: DashboardT["points"] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length) map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lon])), { padding: [24, 24], maxZoom: 15 });
  }, [points, map]);
  return null;
}

function Kpi({ label, value, icon }: { label: string; value: number; icon?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-panel p-4">
      <div className="text-sm text-ink-muted">
        {icon && <span aria-hidden="true">{icon} </span>}
        {label}
      </div>
      <div className="mt-1 text-3xl font-bold tabular-nums text-ink">{formatNum(value)}</div>
    </div>
  );
}

function useDesktop(): boolean {
  const query = "(min-width: 1024px)";
  const [match, setMatch] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    const on = () => setMatch(mq.matches);
    mq?.addEventListener("change", on);
    return () => mq?.removeEventListener("change", on);
  }, []);
  return match;
}

/** Desktop gets the map-first control room; phones (and ?view=list) get the stacked dashboard. */
export default function Dashboard() {
  const desktop = useDesktop();
  const [params] = useSearchParams();
  return desktop && params.get("view") !== "list" ? <ControlRoom /> : <DashboardList />;
}

function DashboardList() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const ward = params.get("ward") ?? undefined;
  const tab = (params.get("tab") as "overview" | "attention" | "gap" | null) ?? "overview";
  const view: Record<string, string> = params.get("view") === "list" ? { view: "list" } : {};
  const setWard = (w: string | undefined) => setParams({ ...view, ...(w ? { ward: w } : {}), ...(tab !== "overview" ? { tab } : {}) }, { replace: true });
  const setTab = (next: "overview" | "attention" | "gap") =>
    setParams({ ...view, ...(ward ? { ward } : {}), ...(next !== "overview" ? { tab: next } : {}) }, { replace: true });
  const [reload, setReload] = useState(0);
  const [wards, setWards] = useState<string[]>([]);
  const [data, setData] = useState<DashboardT | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<PlanStatus | null>(null);

  useEffect(() => {
    setError(null);
    api
      .dashboard(ward)
      .then((d) => {
        setData(d);
        setWards((old) => (old.length ? old : d.wards.map((w) => w.ward)));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  }, [ward, reload]);

  const s = data?.selected;
  const selectedWard = data?.wards.find((w) => w.ward === ward);
  const built = s ? s.byStatus.installed + s.byStatus.verified + s.byStatus.needs_attention : 0;
  const segments = useMemo(
    () => (s ? STATUS_ORDER.filter((st) => s.byStatus[st] > 0).map((st) => ({ status: st, count: s.byStatus[st] })) : []),
    [s],
  );

  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-ink">{t("dashTitle")}</h1>
          <Link to="/dashboard" className="btn-ghost hidden lg:inline-flex">
            {t("crBackToMap")} →
          </Link>
        </div>
        <p className="mt-1 text-ink-muted">{t("dashIntro")}</p>
      </header>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label={t("colWard")}>
        {[undefined, ...wards].map((w) => (
          <button
            key={w ?? "all"}
            type="button"
            onClick={() => setWard(w)}
            aria-pressed={ward === w}
            className={`min-h-11 shrink-0 rounded-full border px-4 font-semibold ${
              ward === w ? "border-ink bg-ink text-deep" : "border-line-strong bg-panel text-ink-soft"
            }`}
          >
            {w ?? t("allWards")}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-1 rounded-(--radius-control) bg-line p-1" role="tablist" aria-label={t("dashTitle")}>
        {(["overview", "attention", "gap"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`min-h-11 rounded-xl px-2 text-sm font-semibold ${tab === k ? "bg-panel text-glow shadow" : "text-ink-soft"}`}
          >
            {t(k === "overview" ? "tabOverview" : k === "attention" ? "tabAttention" : "tabGap")}
          </button>
        ))}
      </div>

      {tab === "attention" && <AttentionTab ward={ward} />}
      {tab === "gap" && <GapTab ward={ward} />}

      {tab === "overview" && error && <ErrorState message={error} onRetry={() => setReload((n) => n + 1)} />}
      {tab === "overview" && !data && !error && <Skeleton lines={2} />}

      {tab === "overview" && s && data && (
        <>
          <section className="rounded-3xl bg-ink p-6 text-deep shadow-lg">
            <div className="text-5xl font-bold tracking-tight tabular-nums">{formatNum(s.harvestingLitres)}</div>
            <div className="mt-1 text-water-50">{t("harvestingHero")}</div>
            <div className="mt-3 text-sm text-water-100">{t("ofPotential", { n: formatNum(s.potentialLitres) })}</div>
          </section>

          <section className="grid grid-cols-2 gap-3">
            <Kpi label={t("kpiPlans")} value={s.total} />
            <Kpi label={t("kpiBuilt")} value={built} />
            <Kpi label={t("kpiVerified")} value={s.byStatus.verified} />
            <Kpi label={t("kpiAttention")} value={s.byStatus.needs_attention} />
          </section>

          <section className="card">
            <h2 className="text-lg font-bold text-ink">{t("pipeline")}</h2>
            {s.total === 0 ? (
              <div className="mt-3">
                <EmptyState>{t("emptyWard")}</EmptyState>
              </div>
            ) : (
              <>
                <div className="mt-3 flex h-6 w-full gap-[2px] overflow-hidden rounded" role="img" aria-label={t("pipeline")}>
                  {segments.map(({ status, count }) => (
                    <div
                      key={status}
                      title={`${t(`status_${status}`)}: ${count}`}
                      onMouseEnter={() => setHover(status)}
                      onMouseLeave={() => setHover(null)}
                      className="h-full transition-opacity first:rounded-l last:rounded-r"
                      style={{
                        width: `${(count / s.total) * 100}%`,
                        background: STATUS_COLOR[status],
                        opacity: hover && hover !== status ? 0.35 : 1,
                      }}
                    />
                  ))}
                </div>
                <ul className="mt-4 grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {STATUS_ORDER.map((st) => (
                    <li
                      key={st}
                      className={`flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 ${hover === st ? "bg-panel-2" : ""}`}
                      onMouseEnter={() => setHover(st)}
                      onMouseLeave={() => setHover(null)}
                    >
                      <span className="flex items-center gap-2 text-ink-soft">
                        <span className="h-3 w-3 rounded-sm" style={{ background: STATUS_COLOR[st] }} aria-hidden="true" />
                        <span aria-hidden="true">{STATUS_ICON[st]}</span>
                        {t(`status_${st}`)}
                      </span>
                      <span className="font-semibold tabular-nums text-ink">{s.byStatus[st]}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {data.points.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-lg font-bold text-ink">{t("mapTitle")}</h2>
              <div className="h-80 overflow-hidden rounded-2xl border border-line">
                <MapContainer center={[28.6139, 77.209]} zoom={11} className="h-full w-full">
                  <TileLayer url={BASEMAP} attribution={BASEMAP_ATTRIBUTION} maxNativeZoom={16} />
                  <FitBounds points={data.points} />
                  {data.points.map((p) => (
                    <CircleMarker
                      key={p.planId}
                      center={[p.lat, p.lon]}
                      radius={hover === p.status ? 10 : 7}
                      pathOptions={{ color: ink.white, weight: 2, fillColor: STATUS_COLOR[p.status], fillOpacity: hover && hover !== p.status ? 0.3 : 1 }}
                    >
                      <Popup>
                        <div className="space-y-1">
                          <div className="font-semibold">
                            {STATUS_ICON[p.status]} {t(`status_${p.status}`)}
                          </div>
                          <div>{formatNum(p.litresPerYear)} L/yr</div>
                          <Link to={`/plan/${p.planId}`}>{t("viewPlan")} →</Link>
                        </div>
                      </Popup>
                    </CircleMarker>
                  ))}
                </MapContainer>
              </div>
            </section>
          )}

          {selectedWard?.slug && (
            <>
              <Link to={`/ward/${selectedWard.slug}`} className="btn-secondary w-full">
                {t("seeWardMap")}
              </Link>
              <SimulatePanel slug={selectedWard.slug} wardName={selectedWard.ward} />
            </>
          )}

          <section className="card overflow-x-auto">
            <h2 className="text-lg font-bold text-ink">{t("wardTable")}</h2>
            <table className="mt-3 w-full text-left text-sm">
              <thead className="text-ink-muted">
                <tr>
                  <th className="py-2 pr-3 font-medium">{t("colWard")}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t("kpiPlans")}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t("kpiBuilt")}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t("kpiVerified")}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t("colLitres")}</th>
                  <th className="py-2 text-right font-medium">{t("complianceScore")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line text-ink">
                {data.wards.map((w) => (
                  <tr key={w.ward} className={w.ward === ward ? "bg-water-50" : ""}>
                    <td className="py-2 pr-3">
                      <button type="button" className="min-h-9 text-left font-semibold text-glow" onClick={() => setWard(w.ward)}>
                        {w.ward}
                      </button>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{w.total}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {w.byStatus.installed + w.byStatus.verified + w.byStatus.needs_attention}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{w.byStatus.verified}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatNum(w.harvestingLitres)}</td>
                    <td className="py-2 text-right tabular-nums">
                      {w.complianceScore === null ? "—" : `${formatNum(Math.round(w.complianceScore * 1000) / 10)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
