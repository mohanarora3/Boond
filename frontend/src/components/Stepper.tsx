import { useI18n, type StringKey } from "../lib/i18n";

const STEPS: StringKey[] = ["stepFind", "stepDetails", "stepPlan"];

/** Progress bar for the planning flow: 1 Find building · 2 Roof and details · 3 Your plan. */
export default function Stepper({ current }: { current: 1 | 2 | 3 }) {
  const { t } = useI18n();
  return (
    <nav aria-label={t("stepOf", { i: current, n: STEPS.length })} className="space-y-2">
      <div className="flex gap-1.5" aria-hidden="true">
        {STEPS.map((_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors ${i + 1 === current ? "bg-cta" : i + 1 < current ? "bg-water-400" : "bg-line"}`}
          />
        ))}
      </div>
      <ol className="flex justify-between gap-2 text-xs sm:text-sm">
        {STEPS.map((key, i) => (
          <li
            key={key}
            aria-current={i + 1 === current ? "step" : undefined}
            className={i + 1 === current ? "font-bold text-cta" : i + 1 < current ? "text-glow" : "text-ink-muted"}
          >
            <span className="mr-1">{i + 1}</span>
            <span className={i + 1 === current ? "" : "hidden sm:inline"}>{t(key)}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
