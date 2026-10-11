import { useId, type ReactNode } from "react";
import type { RoofType, SafetyAnswer } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { SAFETY_FIELDS, toNumber, type PlanDraft } from "../../lib/usePlanDraft";

interface Props {
  draft: PlanDraft;
  update: (patch: Partial<PlanDraft>) => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
}

/** One form row: label and helper on top, the control below, a hairline between rows. */
function Row({ label, helper, htmlFor, children }: { label: string; helper?: string; htmlFor?: string; children: ReactNode }) {
  const helpId = useId();
  return (
    <div className="space-y-2.5 border-t border-line py-5">
      <div>
        {htmlFor ? (
          <label htmlFor={htmlFor} className="block text-[0.95rem] font-semibold text-ink">
            {label}
          </label>
        ) : (
          <p className="text-[0.95rem] font-semibold text-ink">{label}</p>
        )}
        {helper && (
          <p id={helpId} className="mt-0.5 text-sm text-ink-muted">
            {helper}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

/** Joined option buttons (a standard segmented control), keyboard- and screen-reader-friendly as a radio group. */
function Segmented<T extends string | boolean>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex w-full rounded-lg border border-line-strong bg-panel p-1 sm:w-auto">
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`min-h-10 flex-1 rounded-md px-5 text-sm font-medium transition sm:flex-none ${
              on ? "bg-cta text-cta-ink shadow-sm" : "text-ink-soft hover:bg-panel-2 hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Text input with a unit shown inside on the right. */
function UnitInput({ id, value, onChange, unit, inputMode = "decimal", className = "" }: { id: string; value: string; onChange: (v: string) => void; unit: string; inputMode?: "decimal" | "numeric"; className?: string }) {
  return (
    <div className={`flex h-11 items-center rounded-lg border border-line-strong bg-panel focus-within:border-cta focus-within:ring-2 focus-within:ring-cta/20 ${className}`}>
      <input id={id} className="h-full w-full min-w-0 bg-transparent px-3 text-base text-ink outline-none" inputMode={inputMode} value={value} onChange={(e) => onChange(e.target.value)} />
      <span className="shrink-0 pr-3 text-sm text-ink-muted">{unit}</span>
    </div>
  );
}

/** Every question in one plain form beside the roof map; "See my plan" unlocks once the roof and the required answers are in. */
export default function DetailsPanel({ draft, update, onSubmit, submitting, error }: Props) {
  const { t } = useI18n();
  const ids = { plot: useId(), residents: useId(), bill: useId() };
  const residents = toNumber(draft.residents);
  const roofOk = toNumber(draft.roofArea) > 0;
  const required = [
    roofOk,
    toNumber(draft.plotArea) > 0,
    residents >= 1,
    draft.openSpace !== null,
    ...(draft.openSpace ? SAFETY_FIELDS.map((f) => draft[f] !== null) : []),
  ];
  const done = required.filter(Boolean).length;
  const ready = done === required.length;
  const yesNo = [
    { value: true, label: t("yes") },
    { value: false, label: t("no") },
  ];
  const yesNoUnsure: { value: SafetyAnswer; label: string }[] = [
    { value: "yes", label: t("yes") },
    { value: "no", label: t("no") },
    { value: "not_sure", label: t("notSure") },
  ];

  return (
    <section aria-labelledby="details-title" className="lg:pt-1">
      <div className="mb-1 flex items-end justify-between gap-4 pb-4">
        <h2 id="details-title" className="text-xl font-bold text-ink">
          {t("detailsTitle")}
        </h2>
        <p className="shrink-0 text-sm tabular-nums text-ink-muted" aria-live="polite">
          {t("detailsProgress", { n: done, m: required.length })}
        </p>
      </div>

      <Row label={t("plotQ")} helper={t("plotHelper")} htmlFor={ids.plot}>
        <UnitInput id={ids.plot} value={draft.plotArea} onChange={(v) => update({ plotArea: v })} unit={t("sqm")} className="max-w-56" />
      </Row>

      <Row label={t("residentsQ")} helper={t("residentsHelper")} htmlFor={ids.residents}>
        <UnitInput
          id={ids.residents}
          value={draft.residents}
          onChange={(v) => update({ residents: v })}
          unit={t("people")}
          inputMode="numeric"
          className="max-w-40"
        />
      </Row>

      <Row label={t("openSpaceQ")} helper={t("openSpaceHelper")}>
        <Segmented label={t("openSpaceQ")} value={draft.openSpace} options={yesNo} onChange={(v) => update({ openSpace: v })} />
      </Row>

      {/* Safety questions only matter when a recharge pit is possible. */}
      {draft.openSpace &&
        SAFETY_FIELDS.map((field) => (
          <Row key={field} label={t(`safetyQ_${field}`)} helper={t(`safetyHelp_${field}`)}>
            <Segmented
              label={t(`safetyQ_${field}`)}
              value={draft[field]}
              options={yesNoUnsure}
              onChange={(v) => update({ [field]: v } as Partial<PlanDraft>)}
            />
          </Row>
        ))}

      <Row label={t("billQ")} helper={t("billHelper")} htmlFor={ids.bill}>
        <UnitInput id={ids.bill} value={draft.monthlyBill} onChange={(v) => update({ monthlyBill: v })} unit={`₹ ${t("perMonth")}`} className="max-w-56" />
      </Row>

      <Row label={t("roofType")} helper={t("roofTypeHelper")}>
        <Segmented
          label={t("roofType")}
          value={draft.roofType}
          options={[
            { value: "rcc" as RoofType, label: t("roofRcc") },
            { value: "tin" as RoofType, label: t("roofTin") },
            { value: "tiles" as RoofType, label: t("roofTiles") },
          ]}
          onChange={(v) => update({ roofType: v })}
        />
      </Row>

      {error && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {error}
        </p>
      )}

      <div className="border-t border-line-strong pt-5">
        <button type="button" className="btn-primary h-12 w-full text-base" onClick={onSubmit} disabled={!ready || submitting}>
          {submitting ? t("calculating") : t("seeMyPlan")}
        </button>
        {!roofOk && <p className="mt-2 text-center text-sm text-ink-muted">{t("roofAreaNeeded")}</p>}
      </div>
    </section>
  );
}
