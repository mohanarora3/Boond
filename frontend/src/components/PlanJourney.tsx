import type { Plan } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { destinationLabel } from "../lib/waterLabels";
import JourneyWave, { type Stop } from "./JourneyWave";

/** The homeowner's own place on the five-step wave, with real dates for the steps already done. */
export default function PlanJourney({ plan }: { plan: Plan }) {
  const { t, lang } = useI18n();
  const date = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleDateString(lang === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short" }) : "";
  const done = (iso?: string | null) => (iso ? t("jDoneOn", { date: date(iso) }) : t("tlDone"));
  const review = plan.review;
  const built = plan.status === "installed" || plan.status === "verified" || plan.status === "needs_attention";
  const applied = plan.status !== "planned";

  // Which step the marker sits on.
  const current = !applied ? 1 : built ? 4 : review?.decision === "approved" ? 3 : 2;

  const stops: Stop[] = [
    { title: t("jPlan"), sub: done(plan.createdAt), state: "done" },
    applied
      ? { title: t("jApply"), sub: done(plan.appliedAt), state: "done" }
      : { title: t("jApply"), sub: t("jNextGet"), state: "current" },
    !applied
      ? { title: t("jReview"), sub: t("jReviewSub"), state: "todo" }
      : review?.decision === "approved"
        ? {
            title: t("jReview"),
            sub: review.destination ? t("jApprovedTo", { dest: destinationLabel(t, review.destination) }) : done(review.decidedAt),
            state: "done",
          }
        : built
          ? { title: t("jReview"), sub: t("tlDone"), state: "done" }
          : review?.decision === "site_visit"
            ? { title: t("jReview"), sub: t("jSiteVisit"), state: "warn" }
            : review?.decision === "rejected"
              ? { title: t("jReview"), sub: t("jNotApproved"), state: "warn" }
              : { title: t("jReview"), sub: t("jWithOfficer"), state: "current" },
    built
      ? { title: t("jBuild"), sub: done(plan.installedAt), state: "done" }
      : review?.decision === "approved"
        ? { title: t("jBuild"), sub: t("jBuildNow"), state: "current" }
        : { title: t("jBuild"), sub: t("jBuildSub"), state: "todo" },
    plan.status === "verified"
      ? { title: t("jVerify"), sub: plan.verifiedAt ? t("jVerifiedOn", { date: date(plan.verifiedAt) }) : t("tlDone"), state: "done" }
      : plan.status === "needs_attention"
        ? { title: t("jVerify"), sub: t("jNeedsFix"), state: "warn" }
        : built
          ? { title: t("jVerify"), sub: t("jCheckNow"), state: "current" }
          : { title: t("jVerify"), sub: t("jVerifySub"), state: "todo" },
  ];

  return (
    <section aria-labelledby="journey-title" className="rounded-(--radius-card) border border-line bg-panel px-5 pt-6 sm:px-8 md:pb-0">
      <h2 id="journey-title" className="mono-label text-glow">
        {t("jYourJourney")}
      </h2>
      <div className="pb-6 md:pb-0">
        <JourneyWave stops={stops} mode="progress" current={current} title={t("jYourJourney")} />
      </div>
    </section>
  );
}
