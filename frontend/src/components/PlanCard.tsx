import type { Plan, Rules } from "../lib/api";
import { formatNum } from "../lib/area";
import { Rich, useI18n } from "../lib/i18n";
import { pct } from "../lib/useRules";
import HowCalculated from "./HowCalculated";
import StructureIllustration from "./StructureIllustration";

/** The one-sentence answer shown before any numbers. */
export function PlanAnswer({ plan }: { plan: Plan }) {
  const { t } = useI18n();
  const s = plan.structure;
  const d = s.dimensions;
  const many = s.count > 1;
  const structure =
    s.type === "storage_tank"
      ? t(many ? "structSentence_storage_tank_many" : "structSentence_storage_tank", { count: s.count, litres: formatNum(d.litresEach ?? 0) })
      : s.type === "recharge_trench"
        ? t("structSentence_recharge_trench", { l: d.lengthM ?? 0 })
        : t(many ? "structSentence_recharge_pit_many" : "structSentence_recharge_pit", { count: s.count, l: d.lengthM ?? 0, w: d.widthM ?? 0, d: d.depthM ?? 0 });
  return (
    <section className="rounded-(--radius-card) bg-water-50 p-5 text-lg leading-relaxed text-ink ring-1 ring-water-200">
      <p>
        <Rich text={t("answerSave", { litres: formatNum(Math.round(plan.litresPerYear / 1000) * 1000), tankers: formatNum(Math.round(plan.tankersEquivalent)) })} />{" "}
        {plan.mandatory ? <Rich text={t("answerRequired")} /> : t("answerOptional")} <Rich text={t("answerRecommend", { structure })} />
      </p>
    </section>
  );
}

/** Card 1: what to build, with a labelled drawing. */
export function WhatToBuild({ plan, rules }: { plan: Plan; rules: Rules | null }) {
  const { t } = useI18n();
  const s = plan.structure;
  return (
    <section className="card">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">{t("cardBuild")}</h2>
      {s.rechargeRuledOut && plan.feasibility && plan.feasibility.reasons.length > 0 && (
        <div className="mt-3 rounded-xl border-2 border-amber-300 bg-amber-50 p-4 text-amber-950" role="note">
          <p className="font-bold">{t("safetyTitle")}</p>
          <p className="mt-1">
            {t(`reason_${plan.feasibility.reasons[0]}`)} {t("safetyTank")}
          </p>
          <details className="mt-2">
            <summary className="min-h-10 cursor-pointer py-2 font-semibold">{t("safetyWhy")}</summary>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {plan.feasibility.reasons.map((r) => (
                <li key={r}>{t(`reasonLong_${r}`)}</li>
              ))}
            </ul>
          </details>
        </div>
      )}
      <h3 className="mt-1 text-2xl font-bold text-ink">{t(`structure_${s.type}`)}</h3>
      <p className="mt-1 text-ink-soft">{t(`structureWhy_${s.type}`)}</p>
      <div className="mx-auto mt-4 max-w-sm rounded-2xl bg-water-50 p-3 ring-1 ring-line">
        <StructureIllustration structure={s} />
      </div>
      <p className="mt-2 text-center text-ink-soft">{t("holds", { n: formatNum(s.capacityLitres) })}</p>
      {plan.feasibility && plan.feasibility.warnings.length > 0 && (
        <div className="mt-3 rounded-xl bg-amber-50 p-4 text-amber-950">
          <p className="font-bold">{t("warningsTitle")}</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {plan.feasibility.warnings.map((w) => (
              <li key={w}>{t(`warning_${w}`)}</li>
            ))}
          </ul>
        </div>
      )}
      {s.optionalTank && (
        <p className="mt-3 rounded-xl bg-water-50 px-3 py-2 text-sm text-glow">{t("optionalTank", { n: formatNum(s.optionalTank.capacityLitres) })}</p>
      )}
      <HowCalculated>
        <p>
          {t("calcLitres", {
            roof: formatNum(plan.roofAreaM2),
            mm: formatNum(plan.rainfallMm),
            raw: formatNum(Math.round(plan.roofAreaM2 * plan.rainfallMm)),
            pct: pct(plan.runoffCoefficient),
          })}
        </p>
        <p>{t(plan.rainfallSource === "default" ? "calcRainSource_default" : "calcRainSource_open")}</p>
        {rules && (
          <>
            <p>
              {t("calcSize", {
                mmh: rules.designStorm.mmPerHour,
                min: rules.designStorm.minutes,
                litres: formatNum(s.designStormLitres),
                capacity: formatNum(s.capacityLitres),
              })}
            </p>
            <p>{t("calcMandatory", { n: rules.mandatory_min_plot_m2, plot: formatNum(plan.plotAreaM2) })}</p>
          </>
        )}
      </HowCalculated>
    </section>
  );
}
