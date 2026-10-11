import { useCallback, useEffect, useState } from "react";
import BuildingsLayer from "../BuildingsLayer";
import MapRoofDrawer from "../MapRoofDrawer";
import type { BuildingFeature } from "../../lib/api";
import { formatNum, polygonAreaM2 } from "../../lib/area";
import { findBuilding } from "../../lib/geo";
import { useI18n } from "../../lib/i18n";
import { footprintPolygon, toNumber, type PlanDraft } from "../../lib/usePlanDraft";
import { useWardBuildings } from "../../lib/useWardBuildings";

interface Props {
  draft: PlanDraft;
  update: (patch: Partial<PlanDraft>) => void;
  /** Optional: the combined roof + questions screen has its own submit button. */
  onConfirm?: () => void;
}

export default function RoofStep({ draft, update, onConfirm }: Props) {
  const { t } = useI18n();
  const place = draft.place!;
  const [editing, setEditing] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [drawRequest, setDrawRequest] = useState(0);
  const [candidate, setCandidate] = useState<BuildingFeature | null>(null);
  const [picking, setPicking] = useState(false);
  const { ward, buildings } = useWardBuildings(place.lon, place.lat);
  const area = toNumber(draft.roofArea);

  // Pre-select the footprint under (or within ~30 m of) the address, unless a roof is already chosen.
  useEffect(() => {
    if (!ward || !buildings || draft.polygon) return;
    setCandidate(findBuilding(place.lon, place.lat, buildings, ward.nearestBuildingMaxM));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ward, buildings]);

  const onPolygonChange = useCallback(
    (p: GeoJSON.Polygon | null) =>
      // A fresh drawing is no longer a known footprint; adjusting a footprint keeps its id.
      update(p ? { polygon: p, roofArea: String(Math.round(polygonAreaM2(p))) } : { polygon: null, roofArea: "", buildingId: null }),
    [update],
  );
  const onDrawingChange = useCallback((d: boolean) => setDrawing(d), []);
  const onPick = useCallback(
    (f: BuildingFeature) => {
      if (drawing || editing) return;
      setCandidate(f);
      setPicking(false);
    },
    [drawing, editing],
  );

  function acceptCandidate() {
    if (!candidate || !ward) return;
    update({
      polygon: footprintPolygon(candidate.geometry),
      roofArea: String(Math.round(candidate.properties.areaM2)),
      buildingId: candidate.properties.buildingId,
      place: { ...place, ward: ward.ward },
    });
    setCandidate(null);
  }

  const confirming = !!candidate && !draft.polygon;

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-ink">{confirming ? t("isThisYours") : t("step2")}</h1>
        <p className="mt-1 text-ink-muted">{place.label}</p>
      </div>

      <MapRoofDrawer
        center={[place.lat, place.lon]}
        polygon={draft.polygon}
        onPolygonChange={onPolygonChange}
        editing={editing}
        drawRequest={drawRequest}
        drawing={drawing}
        onDrawingChange={onDrawingChange}
      >
        {buildings && ward && !draft.polygon && !drawing && (
          <BuildingsLayer
            features={buildings}
            buckets={ward.colourBuckets}
            polygonsMinZoom={0}
            selectedId={candidate?.properties.buildingId}
            onSelect={onPick}
          />
        )}
      </MapRoofDrawer>

      {confirming ? (
        <div className="space-y-3" aria-live="polite">
          <div className="text-center">
            <div className="text-4xl font-bold tabular-nums text-ink">{t("roofBig", { n: formatNum(Math.round(candidate.properties.areaM2)) })}</div>
            <p className="mt-1 text-ink-muted">{t("isThisYoursHint")}</p>
          </div>
          <button type="button" className="btn-primary w-full text-lg" onClick={acceptCandidate}>
            {t("yesThisOne")}
          </button>
          <button
            type="button"
            className="btn-secondary w-full"
            onClick={() => {
              setCandidate(null);
              setPicking(true);
            }}
          >
            {t("pickAnother")}
          </button>
        </div>
      ) : (
        <>
          {area > 0 ? (
            <div className="text-center" aria-live="polite">
              <div className="text-4xl font-bold tabular-nums text-ink">{t("roofBig", { n: formatNum(area) })}</div>
              <p className="mt-1 text-ink-muted">{t("roofCheck")}</p>
            </div>
          ) : (
            <p className="text-center text-ink-muted">{drawing ? t("drawHint") : picking && buildings ? t("tapYourRoof") : t("roofAreaNeeded")}</p>
          )}

          <div className="grid gap-3">
            {onConfirm && (draft.polygon || area > 0) && (
              <button type="button" className="btn-primary text-lg" onClick={onConfirm} disabled={!(area > 0) || drawing}>
                {t("confirmRoof")}
              </button>
            )}
            {draft.polygon ? (
              <div className="grid grid-cols-2 gap-3">
                <button type="button" className="btn-secondary" aria-pressed={editing} onClick={() => setEditing((e) => !e)}>
                  {editing ? t("done") : t("adjustOutline")}
                </button>
                <button type="button" className="btn-secondary" onClick={() => (drawing ? setDrawing(false) : setDrawRequest((n) => n + 1))}>
                  {drawing ? t("cancel") : t("redraw")}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className={area > 0 ? "btn-secondary" : "btn-primary text-lg"}
                onClick={() => (drawing ? setDrawing(false) : setDrawRequest((n) => n + 1))}
              >
                {drawing ? t("cancel") : t("drawYourRoof")}
              </button>
            )}
          </div>
        </>
      )}

    </section>
  );
}
