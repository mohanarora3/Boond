import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Badge from "../components/Badge";
import ChatBox from "../components/ChatBox";
import EditPlanSheet from "../components/EditPlanSheet";
import ImpactCard from "../components/ImpactCard";
import { BillBanner, RoofMiniMap } from "../components/PlanHero";
import { WhatToBuild } from "../components/PlanCard";
import PlanSummary from "../components/PlanSummary";
import { StageStrip } from "../components/PlanStages";
import ReviewCard from "../components/ReviewCard";
import WaterCard from "../components/WaterCard";
import Sheet from "../components/Sheet";
import { ErrorState, Skeleton } from "../components/States";
import { api, ApiError, type ApplicationResult, type Plan as PlanT } from "../lib/api";
import { formatNum } from "../lib/area";
import { useI18n } from "../lib/i18n";
import { suggestionKeys } from "../lib/suggestions";
import { useChat } from "../lib/useChat";
import { useRules } from "../lib/useRules";
import { PLAN_CHANGED, rememberPlan } from "../lib/recentPlans";

const BUILT = ["installed", "verified", "needs_attention"];

function PlanChat({ plan, onStatus }: { plan: PlanT; onStatus: (s: PlanT["status"]) => void }) {
  const { t, lang } = useI18n();
  const chat = useChat(plan.planId, lang, onStatus);
  return (
    <ChatBox {...chat} suggestions={suggestionKeys(plan).map((k) => t(k))} onSend={chat.send} onRetry={chat.retry} />
  );
}

export default function Plan() {
  const { id = "" } = useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const rules = useRules();
  const [plan, setPlan] = useState<PlanT | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [application, setApplication] = useState<ApplicationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [billFocus, setBillFocus] = useState(0);

  const load = useCallback(() => {
    setError(null);
    api
      .getPlan(id)
      .then(setPlan)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  }, [id]);
  useEffect(load, [load]);

  // Remember this plan for the site menu, and reload if the menu changed it.
  useEffect(() => {
    if (plan) rememberPlan(plan.planId, plan.address);
  }, [plan?.planId, plan?.address]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onChanged = () => load();
    window.addEventListener(PLAN_CHANGED, onChanged);
    return () => window.removeEventListener(PLAN_CHANGED, onChanged);
  }, [load]);

  const onStatus = useCallback((status: PlanT["status"]) => setPlan((p) => (p && p.status !== status ? { ...p, status } : p)), []);
  const closeChat = useCallback(() => {
    setChatOpen(false);
    load(); // the agent may have saved changes
  }, [load]);
  const closeEdit = useCallback(() => setEditOpen(false), []);

  async function getApplication() {
    setBusy(true);
    setActionError(null);
    try {
      const r = await api.generateApplication(id);
      setApplication(r);
      setPlan((p) => (p ? { ...p, status: r.status, appliedAt: p.appliedAt ?? new Date().toISOString() } : p));
      window.open(r.url, "_blank", "noopener");
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function getCertificate() {
    setBusy(true);
    setActionError(null);
    try {
      const r = await api.certificate(id);
      window.open(r.url, "_blank", "noopener");
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("certificateError"));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!plan) return <Skeleton lines={3} />;

  const next: { label: string; onClick: () => void; disabled?: boolean } =
    plan.status === "planned"
      ? { label: t("nextGetApplication"), onClick: getApplication }
      : plan.status === "applied"
        ? plan.review?.decision === "approved"
          ? { label: t("nextRegister"), onClick: () => navigate(`/plan/${id}/maintenance`) }
          : { label: t("nextWaitApproval"), onClick: () => undefined, disabled: true }
        : plan.status === "verified"
          ? { label: t("nextCertificate"), onClick: getCertificate }
          : { label: t("nextCheck"), onClick: () => navigate(`/plan/${id}/maintenance`) };

  const shareUrl = `${window.location.origin}/plan/${id}`;
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(
    t("whatsappText", { litres: formatNum(Math.round(plan.litresPerYear / 1000) * 1000), url: shareUrl }),
  )}`;

  const needsBill = !(plan.monthlyWaterBill > 0);
  const addBill = () => {
    document.getElementById("bill-banner")?.scrollIntoView({ behavior: "smooth", block: "center" });
    setBillFocus((n) => n + 1);
  };

  const actions = (
    <>
      <button type="button" className="btn-secondary w-full" onClick={() => setChatOpen(true)}>
        {t("askBoond")}
      </button>
      <div className="grid grid-cols-2 gap-2">
        <a className="btn-secondary px-3 text-sm" href={whatsapp} target="_blank" rel="noreferrer">
          {t("shareWhatsApp")}
        </a>
        <button type="button" className="btn-secondary px-3 text-sm" onClick={() => setEditOpen(true)}>
          {t("editInputs")}
        </button>
      </div>
      {BUILT.includes(plan.status) ? (
        <Link to={`/plan/${id}/maintenance`} className="btn-ghost w-full">
          {t("healthCheck")}
        </Link>
      ) : (
        plan.review?.decision !== "approved" && (
          <Link to={`/plan/${id}/maintenance?existing=1`} className="btn-ghost w-full text-sm">
            {t("alreadyBuiltLink")}
          </Link>
        )
      )}
    </>
  );

  return (
    <div className="w-screen pb-24 [margin-inline:calc(50%-50vw)] lg:pb-12">
      <StageStrip plan={plan} />
      <div className="mx-auto mt-8 max-w-6xl space-y-6 px-4 sm:px-8">
        {/* Title row (the stages and what is saved for each are in the site menu, top left). */}
        <header className="flex items-start gap-4">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-bold text-ink">{t("yourPlan")}</h1>
              <Badge status={plan.status} />
            </div>
            <p className="text-ink-muted">{plan.address}</p>
          </div>
        </header>

        <ReviewCard plan={plan} />

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_23rem]">
          {/* Left: the roof, the water it saves, what to build */}
          <div className="min-w-0 space-y-6">
            <section className="overflow-hidden rounded-(--radius-card) border border-line bg-panel" aria-label={t("yourRoofArea", { n: formatNum(Math.round(plan.roofAreaM2)) })}>
              <div className="relative h-72 sm:h-80">
                <RoofMiniMap plan={plan} />
              </div>
              <dl className="grid grid-cols-3 divide-x divide-line border-t border-line text-sm">
                {[
                  [t("appsRoof"), t("sqmN", { n: formatNum(Math.round(plan.roofAreaM2)) })],
                  [t("roofType"), t(plan.roofType === "tin" ? "roofTin" : plan.roofType === "tiles" ? "roofTiles" : "roofRcc")],
                  [t("statRain"), t("mmYear", { n: formatNum(Math.round(plan.rainfallMm)) })],
                ].map(([label, value]) => (
                  <div key={label} className="px-4 py-3">
                    <dt className="text-xs text-ink-muted">{label}</dt>
                    <dd className="mt-0.5 font-semibold text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <WaterCard plan={plan} />

            {needsBill && (
              <div id="bill-banner">
                <BillBanner plan={plan} onPlanChange={setPlan} focusSignal={billFocus} />
              </div>
            )}

            {BUILT.includes(plan.status) && <ImpactCard planId={plan.planId} />}
            <WhatToBuild plan={plan} rules={rules} />
          </div>

          {/* Right: everything to decide on, in one place */}
          <div className="space-y-4 lg:sticky lg:top-20">
            {application && (
              <section className="rounded-(--radius-card) border border-status-verified/30 bg-ok-wash p-5" aria-live="polite">
                <h2 className="font-bold text-ink">{t("applyTitle")}</h2>
                <p className="mt-1 text-sm text-ink-soft">{t("applyNote")}</p>
                <a href={application.url} target="_blank" rel="noreferrer" className="btn-primary mt-3 w-full">
                  {t("openPdf")}
                </a>
              </section>
            )}
            {actionError && <ErrorState message={actionError} onRetry={next.onClick} />}
            <PlanSummary plan={plan} next={next} busy={busy} onAddBill={addBill} actions={actions} />
          </div>
        </div>
      </div>

      {/* Phones: the next step stays in reach at the bottom. */}
      <div className="fixed inset-x-0 bottom-0 z-[1400] border-t border-line bg-panel/95 px-4 py-3 backdrop-blur lg:hidden">
        <button type="button" className="btn-primary w-full" onClick={next.onClick} disabled={busy || next.disabled}>
          {busy ? t("applying") : next.label}
        </button>
      </div>

      <Sheet open={chatOpen} title={t("chatTitle")} onClose={closeChat}>
        <PlanChat plan={plan} onStatus={onStatus} />
      </Sheet>
      {editOpen && <EditPlanSheet plan={plan} open={editOpen} onClose={closeEdit} onSaved={setPlan} />}
    </div>
  );
}
