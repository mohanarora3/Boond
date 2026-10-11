import type { Plan, WaterBalance } from "../lib/api";
import { formatInr, formatNum } from "../lib/area";
import { useI18n } from "../lib/i18n";
import { water as blue } from "../lib/tokens";
import { useCountUp } from "./PlanHero";
import HowCalculated from "./HowCalculated";

const round100 = (n: number) => Math.round(n / 100) * 100;

/** Twelve stacked bars: what the system keeps (blue) and what overflows (grey), averaged per calendar month. */
function MonthlyChart({ w }: { w: WaterBalance }) {
  const { t, lang } = useI18n();
  const H = 140;
  const max = Math.max(1, ...w.monthly.map((m) => m.savedLitres + m.lostLitres));
  const month = (m: number) => new Date(2024, m - 1, 1).toLocaleDateString(lang === "hi" ? "hi-IN" : "en-IN", { month: "short" });
  const peak = w.monthly.reduce((a, b) => (b.savedLitres + b.lostLitres > a.savedLitres + a.lostLitres ? b : a));
  return (
    <figure>
      <div className="flex items-end gap-1.5" style={{ height: H }} role="img" aria-label={t("wbChartAlt", { month: month(peak.month), saved: formatNum(round100(peak.savedLitres)), lost: formatNum(round100(peak.lostLitres)) })}>
        {w.monthly.map((m) => {
          const savedH = (m.savedLitres / max) * H;
          const lostH = (m.lostLitres / max) * H;
          return (
            <div key={m.month} className="group relative flex h-full flex-1 flex-col justify-end" title={`${month(m.month)}: ${formatNum(round100(m.savedLitres))} / ${formatNum(round100(m.lostLitres))}`}>
              {lostH > 0 && <span className="block w-full rounded-t-[3px] bg-line-strong" style={{ height: lostH }} />}
              {savedH > 0 && <span className={`block w-full ${lostH > 0 ? "" : "rounded-t-[3px]"}`} style={{ height: savedH, background: blue[500] }} />}
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-1.5 border-t border-line pt-1.5">
        {w.monthly.map((m) => (
          <span key={m.month} className="flex-1 text-center font-mono text-[10px] text-ink-muted">
            {month(m.month)}
          </span>
        ))}
      </div>
      <figcaption className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-soft">
        <span className="flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-sm" style={{ background: blue[500] }} aria-hidden="true" />
          {t(w.kind === "recharge" ? "wbSaved_recharge" : "wbSaved_use")}
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-sm bg-line-strong" aria-hidden="true" />
          {t("wbLost")}
        </span>
        <span className="text-ink-muted">{t("wbMonthlyNote", { from: w.firstYear, to: w.lastYear })}</span>
      </figcaption>
    </figure>
  );
}

/** The honest headline: water the recommended system actually saves, not all the rain on the roof. */
export default function WaterCard({ plan }: { plan: Plan }) {
  const { t } = useI18n();
  const w = plan.water;
  const shown = useCountUp(round100(w ? w.savedLitres : plan.litresPerYear));

  if (!w) {
    return (
      <section className="card p-6 sm:p-7" aria-labelledby="water-title">
        <p id="water-title" className="eyebrow text-glow">{t("wbRoofTitle")}</p>
        <p className="mt-3 font-display text-[clamp(2.6rem,6vw,4rem)] font-extrabold leading-none tracking-tight text-ink tabular-nums">{formatNum(Math.round(shown))}</p>
        <p className="mt-2 text-ink-soft">{t("wbLitresYear")}</p>
        <p className="mt-4 rounded-lg bg-panel-2 px-4 py-3 text-sm text-ink-soft">{t("wbNoDaily")}</p>
      </section>
    );
  }

  const share = Math.round(w.savedShare * 100);
  const capacity = formatNum(plan.structure.capacityLitres);
  return (
    <section className="card p-6 sm:p-7" aria-labelledby="water-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p id="water-title" className="eyebrow text-glow">{t(w.kind === "recharge" ? "wbTitle_recharge" : "wbTitle_use")}</p>
          <p className="mt-3 font-display text-[clamp(2.6rem,6vw,4rem)] font-extrabold leading-none tracking-tight text-ink tabular-nums">{formatNum(Math.round(shown))}</p>
          <p className="mt-2 text-ink-soft">{t("wbLitresYear")}</p>
        </div>
        <div className="min-w-[12rem] text-right">
          <p className="font-display text-2xl font-extrabold tabular-nums" style={{ color: blue[600] }}>
            {share}%
          </p>
          <p className="text-sm text-ink-muted">{t("wbOfRoof", { n: formatNum(round100(w.rainOnRoofLitres)) })}</p>
        </div>
      </div>

      {/* Share of the roof's water that is kept */}
      <div className="mt-5 flex h-2.5 overflow-hidden rounded-full bg-line-strong" aria-hidden="true">
        <span className="h-full" style={{ width: `${share}%`, background: blue[500] }} />
      </div>

      <p className="mt-5 text-ink-soft">
        {w.kind === "recharge" ? t("wbWhere_recharge") : t("wbWhere_use", { use: formatNum(w.dailyUseLitres ?? 0) })}
      </p>

      <div className="mt-6">
        <MonthlyChart w={w} />
      </div>

      <dl className="mt-6 grid grid-cols-3 divide-x divide-line rounded-lg border border-line">
        {[
          [t("wbDry", { year: w.dryYear.year }), w.dryYear.savedLitres, `${formatNum(w.dryYear.rainMm)} mm`],
          [t("wbTypical"), w.savedLitres, `${formatNum(Math.round(plan.rainfallMm))} mm`],
          [t("wbWet", { year: w.wetYear.year }), w.wetYear.savedLitres, `${formatNum(w.wetYear.rainMm)} mm`],
        ].map(([label, litres, rain]) => (
          <div key={String(label)} className="px-4 py-3">
            <dt className="text-xs text-ink-muted">{label}</dt>
            <dd className="mt-1 font-semibold tabular-nums text-ink">{t("litresShort", { n: formatNum(round100(Number(litres))) })}</dd>
            <dd className="text-xs tabular-nums text-ink-muted">{rain}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-4 text-sm text-ink-soft">{t("wbPeriod", { n: w.yearsSimulated, litres: formatNum(round100(w.periodSavedLitres)) })}</p>

      {w.upgrade && (
        <p className="mt-4 rounded-lg border border-line bg-panel-2 px-4 py-3 text-sm text-ink">
          {t("wbUpgrade", {
            size: formatNum(w.upgrade.litresEach),
            extra: formatNum(round100(w.upgrade.extraSavedLitres)),
            cost: formatInr(w.upgrade.extraCostInr),
          })}
        </p>
      )}

      <HowCalculated>
        <p>
          {w.kind === "recharge"
            ? t("wbHow_recharge", { from: w.firstYear, to: w.lastYear, cap: capacity })
            : t("wbHow_use", { from: w.firstYear, to: w.lastYear, cap: capacity, use: formatNum(w.dailyUseLitres ?? 0) })}
        </p>
      </HowCalculated>
    </section>
  );
}
