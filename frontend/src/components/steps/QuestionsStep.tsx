import { useState, type ReactNode } from "react";
import type { RoofType, SafetyAnswer } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { SAFETY_FIELDS, toNumber, type PlanDraft } from "../../lib/usePlanDraft";

interface Props {
  draft: PlanDraft;
  update: (patch: Partial<PlanDraft>) => void;
  onBackToRoof: () => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
}

type Question = { id: string; valid: boolean; render: (next: () => void) => ReactNode };

function Card({ title, helper, children }: { title: string; helper?: string; children: ReactNode }) {
  return (
    <div className="card space-y-4">
      <h2 className="text-2xl font-bold text-ink">{title}</h2>
      {helper && <p className="text-ink-muted">{helper}</p>}
      {children}
    </div>
  );
}

export default function QuestionsStep({ draft, update, onBackToRoof, onSubmit, submitting, error }: Props) {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const residents = toNumber(draft.residents);

  const questions: Question[] = [
    {
      id: "plot",
      valid: toNumber(draft.plotArea) > 0,
      render: () => (
        <Card title={t("plotQ")} helper={t("plotHelper")}>
          <label className="block">
            <span className="label">{t("plotArea")}</span>
            <input className="field text-2xl" inputMode="decimal" value={draft.plotArea} onChange={(e) => update({ plotArea: e.target.value })} />
          </label>
        </Card>
      ),
    },
    {
      id: "residents",
      valid: residents >= 1,
      render: () => (
        <Card title={t("residentsQ")} helper={t("residentsHelper")}>
          <div className="flex items-center justify-center gap-4">
            <button
              type="button"
              className="choice h-16 w-16 text-3xl"
              aria-label="−"
              onClick={() => update({ residents: String(Math.max(1, (residents || 1) - 1)) })}
            >
              −
            </button>
            <label className="text-center">
              <span className="sr-only">{t("residents")}</span>
              <input
                className="field w-24 text-center text-3xl font-bold"
                inputMode="numeric"
                value={draft.residents}
                onChange={(e) => update({ residents: e.target.value })}
              />
              <span className="mt-1 block text-ink-muted">{t("people")}</span>
            </label>
            <button type="button" className="choice h-16 w-16 text-3xl" aria-label="+" onClick={() => update({ residents: String((residents || 0) + 1) })}>
              +
            </button>
          </div>
        </Card>
      ),
    },
    {
      id: "openSpace",
      valid: draft.openSpace !== null,
      render: (next) => (
        <Card title={t("openSpaceQ")} helper={t("openSpaceHelper")}>
          <div className="grid grid-cols-2 gap-3">
            {[true, false].map((v) => (
              <button
                key={String(v)}
                type="button"
                aria-pressed={draft.openSpace === v}
                className={`choice ${draft.openSpace === v ? "choice-on" : ""}`}
                onClick={() => {
                  update({ openSpace: v });
                  next();
                }}
              >
                {v ? `✓ ${t("yes")}` : `✕ ${t("no")}`}
              </button>
            ))}
          </div>
        </Card>
      ),
    },
    // Safety questions only matter when a recharge pit is possible.
    ...(draft.openSpace
      ? SAFETY_FIELDS.map<Question>((field) => ({
          id: field,
          valid: draft[field] !== null,
          render: (next) => (
            <Card title={t(`safetyQ_${field}`)} helper={t(`safetyHelp_${field}`)}>
              <div className="grid gap-3">
                {(["yes", "no", "not_sure"] as SafetyAnswer[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={draft[field] === v}
                    className={`choice ${draft[field] === v ? "choice-on" : ""}`}
                    onClick={() => {
                      update({ [field]: v } as Partial<PlanDraft>);
                      next();
                    }}
                  >
                    {v === "yes" ? `✓ ${t("yes")}` : v === "no" ? `✕ ${t("no")}` : `? ${t("notSure")}`}
                  </button>
                ))}
              </div>
            </Card>
          ),
        }))
      : []),
  ];

  const last = index >= questions.length;
  const q = questions[index];
  const allValid = questions.every((x) => x.valid);
  const next = () => setIndex((i) => Math.min(i + 1, questions.length));
  const back = () => (index === 0 ? onBackToRoof() : setIndex((i) => i - 1));

  return (
    <section className="space-y-4">
      <p className="font-medium text-ink-muted" aria-live="polite">
        {last ? t("improveEstimate") : t("questionOf", { i: index + 1, n: questions.length })}
      </p>

      {!last && q.render(next)}

      {last && (
        <div className="card space-y-4">
          <h2 className="text-2xl font-bold text-ink">{t("improveEstimate")}</h2>
          <p className="text-ink-muted">{t("improveHint")}</p>
          <label className="block">
            <span className="label">{t("monthlyBill")}</span>
            <input className="field" inputMode="decimal" value={draft.monthlyBill} onChange={(e) => update({ monthlyBill: e.target.value })} />
          </label>
          <label className="block">
            <span className="label">{t("tankersPerYear")}</span>
            <input className="field" inputMode="numeric" value={draft.tankersPerYear} onChange={(e) => update({ tankersPerYear: e.target.value })} />
          </label>
          <label className="block">
            <span className="label">{t("roofType")}</span>
            <select className="field" value={draft.roofType} onChange={(e) => update({ roofType: e.target.value as RoofType })}>
              <option value="rcc">{t("roofRcc")}</option>
              <option value="tin">{t("roofTin")}</option>
              <option value="tiles">{t("roofTiles")}</option>
            </select>
          </label>
        </div>
      )}

      {error && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-red-800" role="alert">
          {error}
        </p>
      )}

      <div className="sticky bottom-0 -mx-4 grid grid-cols-[auto_1fr] gap-3 border-t border-line bg-panel/95 px-4 py-3 backdrop-blur">
        <button type="button" className="btn-ghost" onClick={back}>
          ← {t("backStep")}
        </button>
        {last ? (
          <button type="button" className="btn-primary text-lg" onClick={onSubmit} disabled={!allValid || submitting}>
            {submitting ? t("calculating") : t("seeMyPlan")}
          </button>
        ) : (
          <button type="button" className="btn-primary text-lg" onClick={next} disabled={!q.valid}>
            {t("next")} →
          </button>
        )}
      </div>
    </section>
  );
}
