import type { PlanStatus } from "../lib/api";
import { useI18n, type StringKey } from "../lib/i18n";

const STEPS: StringKey[] = ["tl_plan", "tl_apply", "tl_build", "tl_verify"];
const STEP_INDEX: Record<PlanStatus, number> = { planned: 0, applied: 1, installed: 2, needs_attention: 3, verified: 3 };

/** Plan → Apply → Build → Verify, with the plan's current step highlighted. */
export default function StatusTimeline({ status }: { status: PlanStatus }) {
  const { t } = useI18n();
  const current = STEP_INDEX[status];
  const finished = status === "verified";
  return (
    <ol className="grid grid-cols-4 gap-1" aria-label={t("howItWorks")}>
      {STEPS.map((key, i) => {
        const done = i < current || (finished && i === current);
        const isCurrent = i === current && !finished;
        const attention = isCurrent && status === "needs_attention";
        return (
          <li key={key} className="flex flex-col items-center gap-1 text-center" aria-current={isCurrent ? "step" : undefined}>
            <span
              className={`flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-bold ${
                done
                  ? "border-water-400 bg-water-700 text-white"
                  : attention
                    ? "border-status-attention bg-panel text-ink"
                    : isCurrent
                      ? "border-cta bg-cta/10 text-cta"
                      : "border-line-strong bg-panel text-ink-muted"
              }`}
            >
              {done ? "✓" : attention ? "!" : i + 1}
            </span>
            <span className={`text-xs sm:text-sm ${isCurrent ? "font-bold text-cta" : "text-ink-muted"}`}>
              {t(key)}
              <span className="sr-only"> — {done ? t("tlDone") : isCurrent ? t("tlCurrent") : ""}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
