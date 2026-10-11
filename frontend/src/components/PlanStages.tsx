import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Plan } from "../lib/api";
import { formatNum } from "../lib/area";
import { Rich, useI18n } from "../lib/i18n";
import { destinationLabel } from "../lib/waterLabels";
import { usePlanStages, type Stop, type StopState } from "./stageData";

const DOT: Record<StopState, string> = {
  done: "border-ink bg-ink text-deep",
  current: "border-cta bg-panel text-cta ring-4 ring-cta/15",
  warn: "border-status-attention bg-panel text-status-attention ring-4 ring-status-attention/15",
  todo: "border-line-strong bg-panel text-ink-muted",
};

/**
 * One straight line across the whole page under the header: all five stages, the finished ones filled,
 * the current one ringed in red. The line fills up to the current stage.
 */
export function StageStrip({ plan }: { plan: Plan }) {
  const { t } = useI18n();
  const { stops, current } = usePlanStages(plan);
  const allDone = stops.every((s) => s.state === "done");
  const fill = allDone ? 100 : (current / (stops.length - 1)) * 100;
  return (
    <nav aria-label={t("stagesTitle")} className="-mt-6 w-full border-b border-line bg-panel">
      <div className="px-4 pb-4 pt-5 sm:px-8 lg:px-12">
        <ol className="relative grid grid-cols-5">
          {/* The straight line, centred on the dots, from the first stage to the last. */}
          <span className="absolute left-[10%] right-[10%] top-[13px] h-0.5 bg-line" aria-hidden="true">
            <span className="block h-full bg-ink transition-[width] duration-700" style={{ width: `${fill}%` }} />
          </span>
          {stops.map((s, i) => {
            const here = s.state === "current" || s.state === "warn";
            return (
              <li key={i} className="relative flex flex-col items-center text-center" aria-current={here ? "step" : undefined}>
                <span className={`relative z-10 grid h-7 w-7 place-items-center rounded-full border-2 font-mono text-[11px] font-bold ${DOT[s.state]}`}>
                  {s.state === "done" ? "✓" : s.state === "warn" ? "!" : i + 1}
                </span>
                <span className={`mt-2 text-xs font-semibold sm:text-sm ${here ? (s.state === "warn" ? "text-status-attention" : "text-cta") : s.state === "done" ? "text-ink" : "text-ink-muted"}`}>
                  {s.title}
                </span>
                <span className="mt-0.5 hidden max-w-[16rem] text-xs leading-snug text-ink-muted md:block">{here ? s.sub : s.state === "done" ? s.sub : ""}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right font-medium text-ink">{children}</dd>
    </div>
  );
}

/** Every stage with what Boond has saved for it: dates, the application, the officer's decision, the build and the checks. */
export function StagesList({ plan, onGetApplication, busy }: { plan: Plan; onGetApplication: () => void; busy: boolean }) {
  const { t } = useI18n();
  const { stops, date } = usePlanStages(plan);
  const review = plan.review;
  const applied = plan.status !== "planned";
  const built = plan.status === "installed" || plan.status === "verified" || plan.status === "needs_attention";
  const extra: ReactNode[] = [
    <dl key="plan" className="space-y-1.5">
      <Detail label={t("appsRoof")}>{t("sqmN", { n: formatNum(Math.round(plan.roofAreaM2)) })}</Detail>
      <Detail label={t("appsSystem")}>{t(`structure_${plan.structure.type}`)}</Detail>
      <Detail label={t("appsLitres")}>{t("litresN", { n: formatNum(Math.round(plan.litresPerYear / 100) * 100) })}</Detail>
    </dl>,
    <button key="apply" type="button" className={applied ? "btn-secondary min-h-10 w-full text-sm" : "btn-primary min-h-10 w-full text-sm"} onClick={onGetApplication} disabled={busy}>
      {applied ? t("openPdf") : t("nextGetApplication")}
    </button>,
    review ? (
      <div key="review" className="space-y-2 text-sm">
        <p className="font-semibold text-ink">{t(`reviewTitle_${review.decision}`)}</p>
        {review.destination && (
          <p className="text-ink-soft">
            <Rich text={t("reviewWater", { dest: destinationLabel(t, review.destination) })} />
          </p>
        )}
        {review.note && (
          <p className="rounded-lg bg-panel-2 px-3 py-2 text-ink">
            <span className="mr-1 text-ink-muted">{t("reviewNote")}:</span>
            {review.note}
          </p>
        )}
        <p className="text-ink-muted">{t("reviewDecidedOn", { date: date(review.decidedAt) })}</p>
      </div>
    ) : null,
    built ? null : review?.decision === "approved" ? (
      <Link key="build" to={`/plan/${plan.planId}/maintenance`} className="btn-secondary min-h-10 w-full text-sm">
        {t("nextRegister")}
      </Link>
    ) : (
      <div key="build" className="space-y-2 text-sm">
        <p className="text-ink-muted">{t("buildLockedShort")}</p>
        <Link to={`/plan/${plan.planId}/maintenance?existing=1`} className="font-semibold text-glow underline underline-offset-4">
          {t("alreadyBuiltLink")}
        </Link>
      </div>
    ),
    built ? (
      <Link key="verify" to={`/plan/${plan.planId}/maintenance`} className="btn-secondary min-h-10 w-full text-sm">
        {t("healthCheck")}
      </Link>
    ) : null,
  ];

  return (
  <ol>
    {stops.map((s: Stop, i) => {
      const here = s.state === "current" || s.state === "warn";
      return (
        <li key={i} className="relative flex gap-4 pb-7 last:pb-0">
          {/* Straight connector down to the next stage */}
          {i < stops.length - 1 && (
            <span className={`absolute left-[13px] top-8 bottom-0 w-0.5 ${s.state === "done" ? "bg-ink" : "bg-line"}`} aria-hidden="true" />
          )}
          <span className={`relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 font-mono text-[11px] font-bold ${DOT[s.state]}`}>
            {s.state === "done" ? "✓" : s.state === "warn" ? "!" : i + 1}
          </span>
          <div className={`min-w-0 flex-1 rounded-(--radius-card) border p-4 ${here ? "border-cta/40 bg-panel" : "border-line bg-panel"}`}>
            <div className="flex items-baseline justify-between gap-3">
              <h3 className={`font-semibold ${here ? "text-cta" : "text-ink"}`}>{s.title}</h3>
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">
                {s.state === "done" ? t("stageDone") : here ? t("stageNow") : t("stageLater")}
              </span>
            </div>
            <p className="mt-1 text-sm text-ink-soft">{s.sub}</p>
            {extra[i] && (s.state !== "todo" || i === 0 || i === 3) && <div className="mt-3">{extra[i]}</div>}
          </div>
        </li>
      );
    })}
  </ol>
  );
}
