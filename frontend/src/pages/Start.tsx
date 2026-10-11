import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Stepper from "../components/Stepper";
import FindStep from "../components/steps/FindStep";
import DetailsPanel from "../components/steps/DetailsPanel";
import RoofStep from "../components/steps/RoofStep";
import { api, ApiError, type GeocodeResult } from "../lib/api";
import { DEMO_DRAFT } from "../lib/demo";
import { useI18n } from "../lib/i18n";
import { SAFETY_FIELDS, toNumber, usePlanDraft } from "../lib/usePlanDraft";

/** The planning flow: 1 Find building → 2 Roof (map, left) and every question (right) → plan. Step lives in ?step= so Back works. */
export default function Start() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { draft, update, replace } = usePlanDraft();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ?demo=1 loads the Lodhi Road example and jumps to the roof step.
  useEffect(() => {
    if (params.get("demo") === "1") {
      replace(DEMO_DRAFT);
      setParams({ step: "2" }, { replace: true });
    }
  }, [params, replace, setParams]);

  const requested = Number(params.get("step") ?? "1");
  // Without an address only the search makes sense; any later step (old ?step=3 links too) is the combined screen.
  const step = !draft.place || requested <= 1 ? 1 : 2;
  const goTo = useCallback((s: number) => setParams({ step: String(s) }), [setParams]);

  function choosePlace(place: GeocodeResult) {
    const same = draft.place && draft.place.lat === place.lat && draft.place.lon === place.lon;
    update(same ? { place } : { place, polygon: null, roofArea: "", buildingId: null, demo: false });
    goTo(2);
  }

  async function submit() {
    if (!draft.place || draft.openSpace === null) return;
    setSubmitting(true);
    setError(null);
    const num = (s: string) => (Number.isFinite(toNumber(s)) ? toNumber(s) : 0);
    try {
      const plan = await api.createPlan({
        address: draft.place.label,
        lat: draft.place.lat,
        lon: draft.place.lon,
        ward: draft.place.ward,
        roofPolygon: draft.polygon,
        roofAreaM2: toNumber(draft.roofArea),
        plotAreaM2: toNumber(draft.plotArea),
        residents: Math.round(toNumber(draft.residents)),
        openSpace: draft.openSpace,
        roofType: draft.roofType,
        monthlyWaterBill: num(draft.monthlyBill),
        tankersPerYear: num(draft.tankersPerYear),
        ...(draft.buildingId ? { buildingId: draft.buildingId } : {}),
        ...(draft.openSpace
          ? Object.fromEntries(SAFETY_FIELDS.filter((f) => draft[f]).map((f) => [f, draft[f]]))
          : {}),
      });
      navigate(`/plan/${plan.planId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setSubmitting(false);
    }
  }

  // Step 1 is the full-screen map search, the same as the front page.
  if (step === 1) return <FindStep initialQuery={draft.place?.label.split(",").slice(0, 2).join(",") ?? ""} onChoose={choosePlace} />;

  return (
    <div className="w-screen [margin-inline:calc(50%-50vw)]">
      <div className="mx-auto max-w-6xl space-y-6 px-4 sm:px-8">
        <div className="flex items-center justify-between gap-3">
          <div className="max-w-xl flex-1">
            <Stepper current={2} />
          </div>
          {draft.demo && <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-900">{t("demoBadge")}</span>}
        </div>
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:gap-8">
          {/* Left: the roof on the map (stays in view while answering on wide screens). */}
          <div className="space-y-3 lg:sticky lg:top-20">
            <RoofStep draft={draft} update={update} />
            <button type="button" className="btn-ghost -ml-4" onClick={() => goTo(1)}>
              ← {t("backStep")}
            </button>
          </div>
          {/* Right: every question in one place. */}
          <DetailsPanel draft={draft} update={update} onSubmit={submit} submitting={submitting} error={error} />
        </div>
      </div>
    </div>
  );
}
