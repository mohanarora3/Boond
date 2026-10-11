import type { Plan, ReviewDecision } from "../lib/api";
import { Rich, useI18n } from "../lib/i18n";
import { statusColor } from "../lib/tokens";
import { destinationLabel } from "../lib/waterLabels";

const TONE: Record<ReviewDecision, string> = {
  approved: statusColor.verified,
  site_visit: statusColor.installed,
  rejected: statusColor.needs_attention,
};

/** The ward officer's decision on a filed application — or, until there is one, that it is with them. */
export default function ReviewCard({ plan }: { plan: Plan }) {
  const { t, lang } = useI18n();
  const date = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleDateString(lang === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "long", year: "numeric" }) : "";
  const review = plan.review;

  if (!review) {
    if (plan.status !== "applied") return null;
    return (
      <section className="flex gap-4 rounded-(--radius-card) border border-line bg-panel p-5 sm:p-6" aria-live="polite">
        <span className="mt-1.5 h-3 w-3 shrink-0 animate-pulse rounded-full" style={{ background: statusColor.applied }} aria-hidden="true" />
        <div>
          <h2 className="text-lg font-bold text-ink">{t("reviewWaitingTitle")}</h2>
          <p className="mt-1 text-ink-soft">{t("reviewWaitingBody", { date: date(plan.appliedAt ?? plan.updatedAt) })}</p>
        </div>
      </section>
    );
  }

  const tone = TONE[review.decision];
  return (
    <section className="overflow-hidden rounded-(--radius-card) border border-line bg-panel" style={{ borderLeft: `6px solid ${tone}` }} aria-live="polite">
      <div className="space-y-3 p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold text-ink">{t(`reviewTitle_${review.decision}`)}</h2>
          <span className="text-sm text-ink-muted">{t("reviewDecidedOn", { date: date(review.decidedAt) })}</span>
        </div>
        {review.destination && (
          <p className="text-lg text-ink-soft">
            <Rich text={t("reviewWater", { dest: destinationLabel(t, review.destination) })} />
          </p>
        )}
        {review.note && (
          <figure className="rounded-lg bg-panel-2 px-4 py-3">
            <figcaption className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{t("reviewNote")}</figcaption>
            <blockquote className="mt-1 whitespace-pre-line text-ink">{review.note}</blockquote>
          </figure>
        )}
        {review.decision === "approved" && plan.status === "applied" && <p className="text-sm text-ink-muted">{t("reviewNextApproved")}</p>}
      </div>
    </section>
  );
}
