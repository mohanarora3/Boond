import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import FilterIllustration from "../components/FilterIllustration";
import { ErrorState, Skeleton } from "../components/States";
import Badge from "../components/Badge";
import PhotoUpload from "../components/PhotoUpload";
import { api, ApiError, type CaptureInfo, type Check, type CheckResult, type Plan, type Verdict } from "../lib/api";
import { useI18n } from "../lib/i18n";

const VERDICT_STYLE: Record<Verdict, string> = {
  healthy: "border-emerald-300 bg-emerald-50 text-emerald-900",
  needs_cleaning: "border-amber-300 bg-amber-50 text-amber-900",
  broken: "border-red-300 bg-red-50 text-red-800",
  unclear: "border-line-strong bg-panel-2 text-ink",
};
const VERDICT_ICON: Record<Verdict, string> = { healthy: "✓", needs_cleaning: "·", broken: "!", unclear: "?" };
const CHECKABLE = ["installed", "verified", "needs_attention"];

function VerdictCard({ result, onRetake, onDone }: { result: CheckResult; onRetake: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const { check, tip, retake } = result;
  return (
    <section className={`rounded-3xl border-2 p-5 ${VERDICT_STYLE[check.verdict]}`} aria-live="polite">
      <div className="text-sm font-medium uppercase tracking-wide opacity-75">{t(`component_${check.component}`)}</div>
      <h3 className="mt-1 text-2xl font-bold">
        {VERDICT_ICON[check.verdict]} {t(`verdict_${check.verdict}`)}
      </h3>
      <p className="mt-2 text-base">{check.reason}</p>
      <p className="mt-1 text-xs opacity-70">
        {Math.round(check.confidence * 100)}% {t("confidence")}
      </p>
      {retake && <p className="mt-3 font-semibold">{t("retakeHint")}</p>}
      <p className="mt-2 text-sm">
        
        {check.locationVerified
          ? t("locationOk", { m: check.distanceM ?? 0 })
          : check.distanceM != null
            ? t("locationFar", { m: check.distanceM })
            : t("locationNone")}
      </p>
      {result.locationWarning && (
        <p className="mt-3 rounded-xl bg-panel/80 px-4 py-3 font-semibold" role="alert">
          {t("locationWarning")}
        </p>
      )}
      {tip && (
        <div className="mt-3 rounded-2xl bg-panel/80 px-4 py-3">
          <div className="font-semibold">{t("fixTip")}</div>
          <p className="mt-1">{tip}</p>
          <p className="mt-2 text-sm opacity-80">{t("checkAgain")}</p>
        </div>
      )}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button type="button" className="btn-secondary" onClick={onRetake}>
          {t("retake")}
        </button>
        <button type="button" className="btn-primary" onClick={onDone}>
          {t("done")}
        </button>
      </div>
    </section>
  );
}

export default function Maintenance() {
  const { id = "" } = useParams();
  const { t } = useI18n();
  const [params] = useSearchParams();
  const [existing, setExisting] = useState(params.get("existing") === "1");
  const navigate = useNavigate();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [tips, setTips] = useState<string[]>([]);
  const [checks, setChecks] = useState<Check[]>([]);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [justInstalled, setJustInstalled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([api.getPlan(id), api.listChecks(id)])
      .then(([p, c]) => {
        setPlan(p);
        setTips(c.tips);
        setChecks(c.checks);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  }, [id]);
  useEffect(load, [load]);

  async function install(key: string, capture: CaptureInfo) {
    setPlan(await api.registerInstallation(id, key, capture, existing && plan?.review?.decision !== "approved"));
    setJustInstalled(true);
  }

  async function check(key: string, capture: CaptureInfo) {
    const r = await api.runCheck(id, key, capture);
    setResult(r);
    setPlan(r.plan);
    setChecks((c) => [r.check, ...c]);
  }

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!plan) return <Skeleton lines={2} />;

  const retake = () => {
    setResult(null);
    document.querySelector<HTMLButtonElement>("[data-photo-button]")?.click();
  };

  const installed = CHECKABLE.includes(plan.status);
  const approved = plan.review?.decision === "approved";
  return (
    <div className="space-y-5">
      <Link to={`/plan/${id}`} className="inline-flex min-h-11 items-center font-medium text-glow">
        ← {t("back")}
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-ink">{t("maintenanceTitle")}</h1>
        <Badge status={plan.status} />
      </div>

      {plan.status === "verified" && (
        <div className="flex items-center gap-3 rounded-3xl bg-emerald-600 px-5 py-4 text-lg font-semibold text-white shadow">
          {t("verifiedBanner")}
        </div>
      )}

      {!installed && !approved && !existing ? (
        /* Building a new system waits for the ward officer; an existing one can be registered now. */
        <section className="card space-y-3" aria-live="polite">
          <h2 className="text-xl font-bold text-ink">{t("buildLockedTitle")}</h2>
          <p className="text-ink-soft">
            {plan.status === "planned"
              ? t("buildLockedNotApplied")
              : t(plan.review?.decision === "site_visit" ? "buildLockedVisit" : plan.review?.decision === "rejected" ? "buildLockedRejected" : "buildLockedWaiting")}
          </p>
          {plan.review?.note && (
            <p className="rounded-lg bg-panel-2 px-4 py-3 text-sm text-ink">
              <span className="text-ink-muted">{t("reviewNote")}: </span>
              {plan.review.note}
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <Link to={`/plan/${id}`} className="btn-primary">
              {t("backToPlan")}
            </Link>
            <button type="button" className="btn-secondary" onClick={() => setExisting(true)}>
              {t("alreadyBuiltLink")}
            </button>
          </div>
        </section>
      ) : !installed ? (
        <section className="card space-y-3">
          <h2 className="text-xl font-bold text-ink">{existing && !approved ? t("existingTitle") : t("installTitle")}</h2>
          <p className="text-ink-muted">{existing && !approved ? t("existingIntro") : t("installIntro")}</p>
          <PhotoUpload planId={id} purpose="installation" onUploaded={install} />
        </section>
      ) : (
        <section className="card space-y-3">
          {justInstalled && <p className="rounded-xl bg-water-50 px-4 py-3 font-semibold text-glow">{t("installed")}</p>}
          <h2 className="text-xl font-bold text-ink">{t("checkTitle")}</h2>
          <p className="text-ink-muted">{t("checkIntro")}</p>
          <div className="rounded-xl bg-water-50 p-4">
            <h3 className="font-bold text-glow">{t("guideTitle")}</h3>
            <p className="mt-1 text-sm text-ink-soft">{t("guideBody")}</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <FilterIllustration variant="good" label={t("goodExample")} />
              <FilterIllustration variant="bad" label={t("badExample")} />
            </div>
          </div>
          <PhotoUpload planId={id} purpose="check" busyLabel={t("analysing")} onUploaded={check} />
        </section>
      )}

      {result && <VerdictCard result={result} onRetake={retake} onDone={() => navigate(`/plan/${id}`)} />}

      {tips.length > 0 && (
        <section className="card">
          <h2 className="text-lg font-bold text-ink">{t("checklist")}</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-soft">
            {tips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </section>
      )}

      {checks.length > 0 && (
        <section className="card">
          <h2 className="text-lg font-bold text-ink">{t("history")}</h2>
          <ul className="mt-2 divide-y divide-line">
            {checks.map((c) => (
              <li key={c.at} className="flex items-center justify-between gap-3 py-2">
                <span>
                  {VERDICT_ICON[c.verdict]} {t(`verdict_${c.verdict}`)}
                </span>
                <time className="text-sm text-ink-muted">{new Date(c.at).toLocaleDateString()}</time>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
