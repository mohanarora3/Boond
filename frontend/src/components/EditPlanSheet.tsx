import { useState, type FormEvent } from "react";
import { api, ApiError, type Plan, type RoofType } from "../lib/api";
import { useI18n } from "../lib/i18n";
import Sheet from "./Sheet";

interface Props {
  plan: Plan;
  open: boolean;
  onClose: () => void;
  onSaved: (plan: Plan) => void;
}

export default function EditPlanSheet({ plan, open, onClose, onSaved }: Props) {
  const { t } = useI18n();
  const [form, setForm] = useState({
    roofAreaM2: String(plan.roofAreaM2),
    plotAreaM2: String(plan.plotAreaM2),
    residents: String(plan.residents),
    openSpace: plan.openSpace,
    monthlyWaterBill: plan.monthlyWaterBill ? String(plan.monthlyWaterBill) : "",
    tankersPerYear: plan.tankersPerYear ? String(plan.tankersPerYear) : "",
    roofType: plan.roofType,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const num = (s: string) => (s.trim() === "" ? 0 : Number(s));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updatePlan(plan.planId, {
        roofAreaM2: num(form.roofAreaM2),
        plotAreaM2: num(form.plotAreaM2),
        residents: Math.round(num(form.residents)),
        openSpace: form.openSpace,
        monthlyWaterBill: num(form.monthlyWaterBill),
        tankersPerYear: num(form.tankersPerYear),
        roofType: form.roofType,
      });
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const field = (key: "roofAreaM2" | "plotAreaM2" | "residents" | "monthlyWaterBill" | "tankersPerYear", label: string) => (
    <label className="block">
      <span className="label">{label}</span>
      <input className="field" inputMode="decimal" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
    </label>
  );

  return (
    <Sheet open={open} title={t("editInputs")} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {field("roofAreaM2", t("roofArea"))}
        {field("plotAreaM2", t("plotArea"))}
        {field("residents", t("residents"))}
        <fieldset>
          <legend className="label">{t("openSpaceQ")}</legend>
          <div className="mt-2 grid grid-cols-2 gap-3">
            {[true, false].map((v) => (
              <button
                key={String(v)}
                type="button"
                aria-pressed={form.openSpace === v}
                className={`choice ${form.openSpace === v ? "choice-on" : ""}`}
                onClick={() => setForm({ ...form, openSpace: v })}
              >
                {v ? t("yes") : t("no")}
              </button>
            ))}
          </div>
        </fieldset>
        {field("monthlyWaterBill", t("monthlyBill"))}
        {field("tankersPerYear", t("tankersPerYear"))}
        <label className="block">
          <span className="label">{t("roofType")}</span>
          <select className="field" value={form.roofType} onChange={(e) => setForm({ ...form, roofType: e.target.value as RoofType })}>
            <option value="rcc">{t("roofRcc")}</option>
            <option value="tin">{t("roofTin")}</option>
            <option value="tiles">{t("roofTiles")}</option>
          </select>
        </label>
        {error && (
          <p className="rounded-xl bg-red-50 px-4 py-3 text-red-800" role="alert">
            {error}
          </p>
        )}
        <button className="btn-primary w-full text-lg" disabled={saving}>
          {saving ? t("saving") : t("save")}
        </button>
      </form>
    </Sheet>
  );
}
