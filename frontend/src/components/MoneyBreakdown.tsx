import { useState } from "react";
import { api, ApiError, type Plan, type Rules } from "../lib/api";
import { formatInr, formatNum } from "../lib/area";
import { useI18n, type StringKey } from "../lib/i18n";
import { pct } from "../lib/useRules";
import HowCalculated from "./HowCalculated";

function Row({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-ink-soft">
      <span>{label}</span>
      <span className={`tabular-nums ${positive ? "text-emerald-800" : ""}`}>{value}</span>
    </div>
  );
}

/** Card 2: cost → assistance → you pay (the biggest number). */
export function WhatItCosts({ plan, rules }: { plan: Plan; rules: Rules | null }) {
  const { t } = useI18n();
  const m = plan.money;
  return (
    <section className="card">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">{t("cardCost")}</h2>
      <div className="mt-2">
        <Row label={t("installCost")} value={formatInr(m.installCostInr)} />
        <Row label={t("subsidy")} value={`− ${formatInr(m.subsidyInr)}`} positive />
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-4 border-t border-line pt-3">
        <span className="text-lg font-semibold text-ink">{t("youPay")}</span>
        <span className="text-4xl font-bold tabular-nums text-ink">{formatInr(m.netCostInr)}</span>
      </div>
      {rules && (
        <HowCalculated>
          <p>
            {t("calcCost", {
              structure: t(`structure_${plan.structure.type}`),
              filter: formatInr(rules.filterCostInr),
              pct: pct(rules.assistance_fraction),
              max: formatInr(rules.max_assistance_inr),
            })}
          </p>
        </HowCalculated>
      )}
    </section>
  );
}

/** Card 3: yearly benefit and payback, or an inline prompt for the water bill. */
export function WhatYouGetBack({ plan, rules, onPlanChange }: { plan: Plan; rules: Rules | null; onPlanChange: (p: Plan) => void }) {
  const { t } = useI18n();
  const m = plan.money;
  const [editing, setEditing] = useState(false);
  const [bill, setBill] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const yearly: [StringKey, number][] = [
    ["rebate", m.annualRebateInr],
    ["penaltyAvoided", m.penaltyAvoidedInr],
    ["tankerSavings", m.tankerSavingsInr],
  ];

  async function saveBill() {
    const value = Number(bill);
    if (!(value > 0)) return;
    setSaving(true);
    setMessage(null);
    try {
      onPlanChange(await api.updatePlan(plan.planId, { monthlyWaterBill: value }));
      setEditing(false);
      setMessage(t("billSaved"));
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">{t("cardBack")}</h2>
      {m.paybackYears !== null ? (
        <>
          <div className="mt-2">
            {yearly
              .filter(([, v]) => v > 0)
              .map(([k, v]) => (
                <Row key={k} label={t(k)} value={`+ ${formatInr(v)}`} positive />
              ))}
          </div>
          <div className="mt-3 flex items-baseline justify-between gap-4 border-t border-line pt-3">
            <span className="font-semibold text-ink">{t("annualBenefit")}</span>
            <span className="text-2xl font-bold tabular-nums text-ink">{formatInr(m.annualBenefitInr)}</span>
          </div>
          <p className="mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-emerald-900">
            {t("payback")} <strong className="text-xl">{t("years", { n: formatNum(m.paybackYears) })}</strong>
          </p>
        </>
      ) : editing ? (
        <div className="mt-3 space-y-3">
          <label className="block">
            <span className="label">{t("monthlyBill")}</span>
            <input className="field" inputMode="decimal" value={bill} onChange={(e) => setBill(e.target.value)} autoFocus />
          </label>
          <button type="button" className="btn-primary w-full" onClick={saveBill} disabled={saving || !(Number(bill) > 0)}>
            {saving ? t("saving") : t("save")}
          </button>
        </div>
      ) : (
        <button type="button" className="btn-secondary mt-3 w-full" onClick={() => setEditing(true)}>
          + {t("addBillCta")}
        </button>
      )}
      {message && (
        <p className="mt-3 text-sm text-ink-soft" role="status">
          {message}
        </p>
      )}
      {rules && (
        <HowCalculated>
          <p>
            {t("calcBack", {
              rebate: pct(rules.rebate_fraction),
              penalty: pct(rules.penalty_fraction),
              tanker: formatInr(rules.tanker_price_inr),
            })}
          </p>
        </HowCalculated>
      )}
    </section>
  );
}
