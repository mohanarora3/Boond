import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import L from "leaflet";
import { GeoJSON as GeoJSONLayer, MapContainer, Polygon, TileLayer } from "react-leaflet";
import BuildingsLayer from "../components/BuildingsLayer";
import SimulatePanel from "../components/SimulatePanel";
import Sheet from "../components/Sheet";
import { ErrorState, Skeleton } from "../components/States";
import { api, ApiError, fetchBuildings, type BuildingFeature, type Simulation, type WardDetail } from "../lib/api";
import { bigLitres, formatNum } from "../lib/area";
import { Rich, useI18n } from "../lib/i18n";
import { ink, litresScale, statusColor, water } from "../lib/tokens";
import { EMPTY_DRAFT, footprintPolygon, saveDraft } from "../lib/usePlanDraft";
import { useRules } from "../lib/useRules";

const BASEMAP = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}";
const BASEMAP_ATTRIBUTION = "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors | Buildings &copy; Overture Maps";

export default function WardMap() {
  const { ward: slug = "" } = useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const rules = useRules();
  const [ward, setWard] = useState<WardDetail | null>(null);
  const [buildings, setBuildings] = useState<BuildingFeature[] | null>(null);
  const [selected, setSelected] = useState<BuildingFeature | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [reload, setReload] = useState(0);
  const [sim, setSim] = useState<Simulation | null>(null);
  const [raining, setRaining] = useState(false);
  const svgRenderer = useMemo(() => L.svg(), []);

  useEffect(() => {
    let alive = true;
    setError(null);
    setBuildings(null);
    api
      .ward(slug)
      .then(async (w) => {
        if (!alive) return;
        setWard(w);
        const features = await fetchBuildings(w.buildingsUrl);
        if (alive) setBuildings(features);
      })
      .catch((err) => alive && setError(err instanceof ApiError ? err.message : String(err)));
    return () => {
      alive = false;
    };
  }, [slug, reload]);

  const buckets = useMemo(() => ward?.colourBuckets ?? [], [ward]);
  const select = useCallback((f: BuildingFeature) => setSelected(f), []);
  const outcomes = useMemo(() => new Map(sim?.plans.map((p) => [p.buildingId, p.outcome]) ?? []), [sim]);
  // During a simulation: built systems fill blue, broken ones red, everything else grey (lost to drains).
  const simFill = useCallback(
    (f: BuildingFeature) => {
      const o = outcomes.get(f.properties.buildingId);
      return o === "captured" ? water[700] : o === "broken" ? statusColor.needs_attention : ink[400];
    },
    [outcomes],
  );
  const broken = useMemo(
    () => (buildings && sim ? buildings.filter((b) => outcomes.get(b.properties.buildingId) === "broken") : []),
    [buildings, sim, outcomes],
  );

  async function planThisBuilding(f: BuildingFeature) {
    if (!ward) return;
    setPlanning(true);
    const [lon, lat] = f.properties.centroid;
    let label = t("buildingFromMap", { ward: ward.ward });
    try {
      const [place] = await api.reverseGeocode(lat, lon);
      if (place && !/^\d/.test(place.label)) label = place.label;
    } catch {
      /* keep the generic label */
    }
    saveDraft({
      ...EMPTY_DRAFT,
      place: { label, lat, lon, ward: ward.ward },
      polygon: footprintPolygon(f.geometry),
      roofArea: String(Math.round(f.properties.areaM2)),
      buildingId: f.properties.buildingId,
    });
    navigate("/start?step=2");
  }

  if (error) return <ErrorState message={error} onRetry={() => setReload((n) => n + 1)} />;
  if (!ward) return <Skeleton lines={1} />;

  const total = bigLitres(ward.totalLitresPerYear);
  const legend = [
    t("bucketBelow", { b: formatNum(buckets[0] ?? 0) }),
    ...buckets.slice(0, -1).map((a: number, i: number) => t("bucketBetween", { a: formatNum(a), b: formatNum(buckets[i + 1]) })),
    t("bucketAbove", { a: formatNum(buckets[buckets.length - 1] ?? 0) }),
  ];
  const [west, south, east, north] = ward.bbox;

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold text-ink">{ward.ward}</h1>
        <p className="text-xl leading-snug text-ink">
          <Rich text={t("wardHero", { ward: ward.ward, litres: t(total.key, { n: total.n }) })} />{" "}
          <Rich text={t("wardHeroRequired", { n: formatNum(ward.requiredCount) })} />
        </p>
        <p className="text-sm text-ink-muted">{t("wardBuildings", { n: formatNum(ward.buildingCount) })}</p>
      </header>

      <div className="relative h-[60vh] min-h-80 overflow-hidden rounded-(--radius-card) border border-line">
        <MapContainer
          bounds={[
            [south, west],
            [north, east],
          ]}
          preferCanvas
          maxZoom={20}
          className="h-full w-full"
        >
          <TileLayer url={BASEMAP} attribution={BASEMAP_ATTRIBUTION} maxNativeZoom={16} maxZoom={20} />
          {ward.boundary && (
            <GeoJSONLayer data={ward.boundary} style={{ color: ink[600], weight: 2, dashArray: "6 4", fill: false }} interactive={false} />
          )}
          {buildings && (
            <BuildingsLayer
              features={buildings}
              buckets={buckets}
              polygonsMinZoom={ward.polygonsMinZoom}
              selectedId={selected?.properties.buildingId}
              onSelect={select}
              fillFor={sim ? simFill : undefined}
            />
          )}
          {broken.map((b) => (
            <Polygon
              key={b.properties.buildingId}
              positions={(b.geometry.type === "Polygon" ? b.geometry.coordinates : b.geometry.coordinates[0]).map((ring) =>
                ring.map(([x, y]) => [y, x] as [number, number]),
              )}
              pathOptions={{ renderer: svgRenderer, className: "boond-pulse", color: statusColor.needs_attention, weight: 6, fill: false }}
              interactive={false}
            />
          ))}
        </MapContainer>
        {raining && <div className="rain-overlay pointer-events-none absolute inset-0 z-[900]" aria-hidden="true" />}
        {!buildings && (
          <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-panel/80" role="status">
            <span className="rounded-full bg-panel px-4 py-2 font-semibold text-ink-soft shadow">{t("wardLoading")}</span>
          </div>
        )}
      </div>

      {buildings && <SimulatePanel slug={ward.slug} wardName={ward.ward} dailyCycles={ward.dailyCycles} onResult={setSim} onPlaying={setRaining} />}

      <section className="card space-y-2" aria-labelledby="legend">
        <h2 id="legend" className="font-bold text-ink">
          {t("legendTitle")}
        </h2>
        <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {legend.map((label, i) => (
            <li key={label} className="flex items-center gap-2 text-sm text-ink-soft">
              <span className="h-4 w-4 rounded-sm" style={{ background: litresScale[i] }} aria-hidden="true" />
              {label} L
            </li>
          ))}
        </ul>
        {rules && <p className="text-sm text-ink-soft">▣ {t("legendRequired", { n: rules.mandatory_min_plot_m2 })}</p>}
        <p className="text-sm text-ink-soft">□ {t("legendMaybe")}</p>
        <p className="text-sm text-ink-muted">{t("legendZoom")}</p>
        <p className="text-xs text-ink-muted">{t("wardDataNote")}</p>
      </section>

      <Sheet open={!!selected} title={t("buildingTitle")} onClose={() => setSelected(null)}>
        {selected && (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-panel p-3 ring-1 ring-line">
                <dt className="text-sm text-ink-muted">{t("buildingArea")}</dt>
                <dd className="text-2xl font-bold tabular-nums">{t("roofBig", { n: formatNum(Math.round(selected.properties.areaM2)) })}</dd>
              </div>
              <div className="rounded-xl bg-panel p-3 ring-1 ring-line">
                <dt className="text-sm text-ink-muted">{t("buildingLitres")}</dt>
                <dd className="text-2xl font-bold tabular-nums">{t("litresShort", { n: formatNum(selected.properties.litresPerYear) })}</dd>
              </div>
            </dl>
            <p className={`rounded-xl px-4 py-3 font-semibold ${selected.properties.mandatory === "required" ? "bg-amber-50 text-amber-900" : "bg-panel-2 text-ink"}`}>
              {selected.properties.mandatory === "required" ? `${t("buildingRequired")}` : `${t("buildingMaybe")}`}
            </p>
            <button type="button" className="btn-primary w-full text-lg" disabled={planning} onClick={() => planThisBuilding(selected)}>
              {planning ? t("loading") : t("makePlanHere")}
            </button>
            <p className="text-xs text-ink-muted">{t("estimateNote")}</p>
          </div>
        )}
      </Sheet>
    </div>
  );
}
