import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CircleMarker, MapContainer, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import { api, ApiError, type AttentionRow, type Gap } from "../lib/api";
import { formatNum } from "../lib/area";
import { downloadCsv, toCsv } from "../lib/csv";
import { Rich, useI18n } from "../lib/i18n";
import { ink, statusColor } from "../lib/tokens";
import { EmptyState, ErrorState, Skeleton } from "./States";

const BASEMAP = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}";
const BASEMAP_ATTRIBUTION = "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors";

export function AttentionTab({ ward }: { ward?: string }) {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const [rows, setRows] = useState<AttentionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setRows(null);
    setError(null);
    api
      .attention(ward)
      .then((r) => setRows(r.rows))
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  }, [ward, reload]);

  if (error) return <ErrorState message={error} onRetry={() => setReload((n) => n + 1)} />;
  if (!rows) return <Skeleton hero={false} lines={2} />;
  if (rows.length === 0) return <EmptyState>{t("noAttention")}</EmptyState>;

  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(lang === "hi" ? "hi-IN" : "en-IN") : "");
  const issue = (r: AttentionRow) =>
    [r.lastVerdict ? t(`verdict_${r.lastVerdict}`) : "", r.lastComponent ? t(`component_${r.lastComponent}`) : ""].filter(Boolean).join(" · ");

  function exportCsv() {
    const header = [t("colPlan"), t("colWard"), t("colStructure"), t("colIssue"), t("colDaysOpen"), t("colLastCheck")];
    const body = rows!.map((r) => [r.planId, r.ward, t(`structure_${r.structure}`), issue(r), r.daysOpen, r.lastCheckAt?.slice(0, 10)]);
    downloadCsv(`boond-needs-attention${ward ? `-${ward.replace(/\s+/g, "-").toLowerCase()}` : ""}.csv`, toCsv(header, body));
  }

  return (
    <section className="card space-y-3">
      <div className="flex justify-end">
        <button type="button" className="btn-secondary min-h-11" onClick={exportCsv}>
          ⬇ {t("exportCsv")}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-ink-muted">
            <tr>
              <th className="py-2 pr-3 font-medium">{t("colDaysOpen")}</th>
              <th className="py-2 pr-3 font-medium">{t("colIssue")}</th>
              <th className="py-2 pr-3 font-medium">{t("colWard")}</th>
              <th className="py-2 pr-3 font-medium">{t("colLastCheck")}</th>
              <th className="py-2 font-medium">
                <span className="sr-only">{t("colPlan")}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.planId} className="cursor-pointer hover:bg-panel-2" onClick={() => navigate(`/plan/${r.planId}`)}>
                <td className="py-2 pr-3 text-lg font-bold tabular-nums text-red-800">{r.daysOpen === null ? "—" : t("daysN", { n: r.daysOpen })}</td>
                <td className="py-2 pr-3">{issue(r)}</td>
                <td className="py-2 pr-3">{r.ward}</td>
                <td className="py-2 pr-3 tabular-nums">{date(r.lastCheckAt)}</td>
                <td className="py-2">
                  <a href={`/plan/${r.planId}`} className="font-semibold text-glow underline" onClick={(e) => e.stopPropagation()}>
                    {t("openPlan")}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FitPoints({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length) map.fitBounds(L.latLngBounds(points.map(([lon, lat]) => [lat, lon])), { padding: [20, 20], maxZoom: 16 });
  }, [points, map]);
  return null;
}

export function GapTab({ ward }: { ward?: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [gap, setGap] = useState<Gap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setGap(null);
    setError(null);
    if (!ward) return;
    api
      .gap(ward)
      .then(setGap)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  }, [ward, reload]);

  if (!ward) return <EmptyState>{t("gapPickWard")}</EmptyState>;
  if (error) return <ErrorState message={error} onRetry={() => setReload((n) => n + 1)} />;
  if (!gap) return <Skeleton hero={false} lines={2} />;

  const colour = (status: string) =>
    status === "verified" ? statusColor.verified : status === "needs_attention" ? statusColor.needs_attention : statusColor.applied;
  const allPoints = [...gap.withoutPlanPoints, ...gap.planPoints.map((p) => [p.lon, p.lat] as [number, number])];

  return (
    <section className="space-y-4">
      <p className="card text-xl leading-snug text-ink">
        <Rich text={t("gapLine", { n: formatNum(gap.verified), m: formatNum(gap.required), ward: gap.ward })} />
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-line bg-panel p-4">
          <div className="text-sm text-ink-muted">{t("gapWithPlan")}</div>
          <div className="text-3xl font-bold tabular-nums">{formatNum(gap.withPlan)}</div>
        </div>
        <div className="rounded-2xl border border-line bg-panel p-4">
          <div className="text-sm text-ink-muted">{t("gapWithoutPlan")}</div>
          <div className="text-3xl font-bold tabular-nums">{formatNum(gap.withoutPlan)}</div>
        </div>
      </div>
      <div className="h-80 overflow-hidden rounded-(--radius-card) border border-line">
        <MapContainer center={[28.6139, 77.209]} zoom={12} preferCanvas className="h-full w-full">
          <TileLayer url={BASEMAP} attribution={BASEMAP_ATTRIBUTION} maxNativeZoom={16} />
          <FitPoints points={allPoints} />
          {gap.withoutPlanPoints.map(([lon, lat], i) => (
            <CircleMarker key={i} center={[lat, lon]} radius={3} pathOptions={{ stroke: false, fillColor: ink[400], fillOpacity: 0.8 }} />
          ))}
          {gap.planPoints.map((p) => (
            <CircleMarker
              key={p.planId}
              center={[p.lat, p.lon]}
              radius={7}
              eventHandlers={{ click: () => navigate(`/plan/${p.planId}`) }}
              pathOptions={{ color: ink.white, weight: 2, fillColor: colour(p.status), fillOpacity: 1 }}
            />
          ))}
        </MapContainer>
      </div>
      <ul className="grid grid-cols-1 gap-1 text-sm text-ink-soft sm:grid-cols-2">
        <li className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full" style={{ background: ink[400] }} aria-hidden="true" /> ○ {t("gapLegendNone")}
        </li>
        <li className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full" style={{ background: statusColor.verified }} aria-hidden="true" /> {t("gapLegendVerified")}
        </li>
        <li className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full" style={{ background: statusColor.needs_attention }} aria-hidden="true" /> {t("gapLegendBroken")}
        </li>
        <li className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full" style={{ background: statusColor.applied }} aria-hidden="true" /> {t("gapLegendOther")}
        </li>
      </ul>
    </section>
  );
}
