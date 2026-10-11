import type { ReactNode } from "react";
import type { Plan, Structure } from "../lib/api";
import { formatInr, formatNum } from "../lib/area";
import { useI18n } from "../lib/i18n";

function Row({ label, value, strong, tone }: { label: string; value: ReactNode; strong?: boolean; tone?: "good" | "muted" }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className={strong ? "font-semibold text-ink" : "text-ink-soft"}>{label}</dt>
      <dd
        className={`text-right tabular-nums ${strong ? "text-lg font-bold text-ink" : "font-medium"} ${
          tone === "good" ? "text-status-verified" : tone === "muted" ? "text-ink-muted" : strong ? "" : "text-ink"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-t border-line px-6 py-4">
      <h3 className="eyebrow text-ink-muted">{title}</h3>
      <dl className="mt-2 text-sm">{children}</dl>
    </div>
  );
}

export function sizeLabel(s: Structure): string {
  const d = s.dimensions;
  const n = s.count > 1 ? `${s.count} × ` : "";
  if (s.type === "storage_tank") return `${n}${formatNum(d.litresEach ?? s.capacityLitres)} L`;
  return `${n}${formatNum(d.lengthM ?? 0)} × ${formatNum(d.widthM ?? 0)} × ${formatNum(d.depthM ?? 0)} m`;
}

/**
 * Everything the homeowner needs, in one column on the right: the next step, the system,
 * the water it saves, what it costs and what comes back each year.
 */
export default function PlanSummary({
  plan,
  next,
  busy,
  onAddBill,
  actions,
}: {
  plan: Plan;
  next: { label: string; onClick: () => void; disabled?: boolean };
  busy: boolean;
  onAddBill: () => void;
  actions: ReactNode;
}) {
  const { t } = useI18n();
  const m = plan.money;
  const w = plan.water;
  const yearsText = (n: number) => t(n === 1 ? "yearOne" : "years", { n: formatNum(n) });
  const yearly: [string, number][] = [
    [t("rebate"), m.annualRebateInr],
    [t("penaltyAvoided"), m.penaltyAvoidedInr],
    [t("sumTankWater"), m.tankWaterValueInr ?? 0],
    [t("tankerSavings"), m.tankerSavingsInr],
  ];
  const shown = yearly.filter(([, v]) => v > 0);

  return (
    <aside className="overflow-hidden rounded-(--radius-card) border border-line bg-panel shadow-[0_1px_2px_rgb(49_31_24_/_0.03),0_18px_40px_-28px_rgb(49_31_24_/_0.3)]" aria-label={t("sumTitle")}>
      <div className="px-6 pb-5 pt-6">
        <p className="eyebrow text-glow">{t("sumTitle")}</p>
        <p className="mt-2 text-sm text-ink-soft">
          {plan.status === "applied" && plan.review?.decision !== "approved"
            ? t(plan.review?.decision === "site_visit" ? "buildLockedVisit" : plan.review?.decision === "rejected" ? "buildLockedRejected" : "buildLockedWaiting")
            : t(`sumStatus_${plan.status}`)}
        </p>
        <button type="button" className="btn-primary mt-4 w-full" onClick={next.onClick} disabled={busy || next.disabled}>
          {busy ? t("applying") : next.label}
        </button>
      </div>

      <Group title={t("sumSystem")}>
        <Row label={t("sumType")} value={t(`structure_${plan.structure.type}`)} />
        <Row label={t("sumSize")} value={sizeLabel(plan.structure)} />
        <Row label={t("sumLaw")} value={plan.mandatory ? t("sumRequired") : t("sumOptional")} />
      </Group>

      <Group title={t("sumWater")}>
        {w ? (
          <>
            <Row label={t(w.kind === "recharge" ? "wbSaved_recharge" : "wbSaved_use")} value={t("litresShort", { n: formatNum(Math.round(w.savedLitres / 100) * 100) })} strong />
            <Row label={t("sumRoofYear")} value={t("litresShort", { n: formatNum(Math.round(w.rainOnRoofLitres / 100) * 100) })} tone="muted" />
          </>
        ) : (
          <Row label={t("sumRoofYear")} value={t("litresShort", { n: formatNum(Math.round(plan.litresPerYear / 100) * 100) })} strong />
        )}
        <Row label={t("sumRainfall")} value={t("mmYear", { n: formatNum(Math.round(plan.rainfallMm)) })} tone="muted" />
      </Group>

      <Group title={t("cardCost")}>
        <Row label={t("installCost")} value={formatInr(m.installCostInr)} />
        <Row label={t("subsidy")} value={`− ${formatInr(m.subsidyInr)}`} tone="good" />
        <Row label={t("youPay")} value={formatInr(m.netCostInr)} strong />
      </Group>

      <Group title={t("sumEveryYear")}>
        {shown.length > 0 ? (
          <>
            {shown.map(([label, v]) => (
              <Row key={label} label={label} value={`+ ${formatInr(v)}`} tone="good" />
            ))}
            <Row label={t("annualBenefit")} value={formatInr(m.annualBenefitInr)} strong />
            {m.paybackYears !== null && <Row label={t("statPayback")} value={yearsText(m.paybackYears)} strong />}
          </>
        ) : (
          <p className="text-ink-soft">{t("sumNoBill")}</p>
        )}
        {!(plan.monthlyWaterBill > 0) && (
          <button type="button" onClick={onAddBill} className="mt-2 text-sm font-semibold text-glow underline underline-offset-4">
            {t("addBillShort")}
          </button>
        )}
      </Group>

      <div className="space-y-2 border-t border-line px-6 py-5">{actions}</div>
      <p className="border-t border-line bg-panel-2 px-6 py-3 text-xs text-ink-muted">{t("estimateNote")}</p>
    </aside>
  );
}
