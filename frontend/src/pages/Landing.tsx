import { useCallback, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import JourneyWave from "../components/JourneyWave";
import Reveal from "../components/Reveal";
import FindStep from "../components/steps/FindStep";
import type { GeocodeResult, RuleSource } from "../lib/api";
import { useI18n, type StringKey } from "../lib/i18n";
import { EMPTY_DRAFT, saveDraft } from "../lib/usePlanDraft";
import { pct, useRules } from "../lib/useRules";

const STORY: [StringKey, StringKey][] = [
  ["jPlan", "jPlanSub"],
  ["jApply", "jApplySub"],
  ["jReview", "jReviewSub"],
  ["jBuild", "jBuildSub"],
  ["jVerify", "jVerifySub"],
];

const PHASES: { key: StringKey; tone: string }[] = [
  { key: "jbPhase1", tone: "bg-panel-2 text-ink ring-line" },
  { key: "jbPhase2", tone: "bg-warn-wash text-status-installed ring-status-installed/30" },
  { key: "jbPhase3", tone: "bg-ok-wash text-status-verified ring-status-verified/25" },
  { key: "jbPhase4", tone: "bg-warn-wash text-status-installed ring-status-installed/30" },
  { key: "jbPhase5", tone: "bg-ok-wash text-status-verified ring-status-verified/25" },
];

const LAYERS: [StringKey, StringKey, StringKey][] = [
  ["jbL1", "jbL1d", "jbL1r"],
  ["jbL2", "jbL2d", "jbL2r"],
  ["jbL3", "jbL3d", "jbL3r"],
  ["jbL4", "jbL4d", "jbL4r"],
  ["jbL5", "jbL5d", "jbL5r"],
];

const PAD = "px-[clamp(20px,5vw,64px)]";

function Arrow() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
    </svg>
  );
}

/** Big centred editorial statement; the last line fades back. */
function Statement({ eyebrow, lines, children }: { eyebrow: string; lines: string[]; children?: ReactNode }) {
  return (
    <section className={`relative ${PAD} py-[clamp(88px,16vh,150px)]`}>
      <Reveal className="mx-auto max-w-[52rem] text-center">
        <span className="eyebrow mb-7 block text-glow">{eyebrow}</span>
        <p className="display m-0 text-[clamp(2.1rem,5.2vw,3.9rem)] text-ink">
          {lines.map((line, i) => (
            <span key={line} className={`block ${i === lines.length - 1 ? "text-ink-muted/70" : ""}`}>
              {line}
            </span>
          ))}
        </p>
        {children}
      </Reveal>
    </section>
  );
}

/** Homeowner front page: hero search, the problem, the five steps, the officer side, why it matters, and a closing call. */
export default function Landing() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const rules = useRules();
  const sources: RuleSource[] = rules
    ? [...new Map(Object.values(rules.sources).flat().map((s) => [s.url, s] as const)).values()]
    : [];

  // A new address starts a fresh plan and goes straight to the roof step.
  const start = useCallback(
    (place: GeocodeResult) => {
      saveDraft({ ...EMPTY_DRAFT, place });
      navigate("/start?step=2");
    },
    [navigate],
  );

  const stats = rules
    ? [
        { value: "2001", label: t("heroStatLaw") },
        { value: t("heroStatPlotN", { n: rules.mandatory_min_plot_m2 }), label: t("heroStatPlot") },
        { value: t("heroStatRebateN", { n: pct(rules.rebate_fraction) }), label: t("heroStatRebate") },
      ]
    : undefined;

  const toTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    window.setTimeout(() => document.querySelector<HTMLInputElement>('form[role="search"] input')?.focus(), 500);
  };

  return (
    <div className="[&>*]:w-screen [&>*]:[margin-inline:calc(50%-50vw)]">
      <FindStep initialQuery="" onChoose={start} variant="home" stats={stats} />

      {/* The problem */}
      <Statement eyebrow={t("gapEyebrow")} lines={[t("gap1"), t("gap2"), t("gap3")]}>
        <p className="mx-auto mt-9 max-w-[46ch] text-[1.05rem] leading-[1.65] text-ink-soft">{t("gapNote")}</p>
      </Statement>

      {/* How it works: the five-step wave */}
      <section aria-labelledby="how" className={`border-t border-line bg-panel-2 ${PAD} pt-[clamp(64px,10vh,112px)] pb-12 md:pb-4`}>
        <div className="mx-auto max-w-[1180px]">
          <Reveal>
            <p className="eyebrow text-ink-muted">{t("howEyebrow")}</p>
            <h2 id="how" className="display mt-3 max-w-[22ch] text-[clamp(1.8rem,3.2vw,2.6rem)] text-ink">
              {t("howTitle")}
            </h2>
          </Reveal>
          <div className="pt-10 md:pt-0">
            <JourneyWave stops={STORY.map(([title, sub]) => ({ title: t(title), sub: t(sub), state: "todo" }))} mode="story" />
          </div>
        </div>
      </section>

      {/* The officer side */}
      <section aria-labelledby="jb" className={`border-t border-line ${PAD} py-[clamp(80px,14vh,128px)]`}>
        <div className="mx-auto grid max-w-[1180px] gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
          <div>
            <Reveal>
              <span className="eyebrow text-glow">{t("jbEyebrow")}</span>
              <h2 id="jb" className="display mt-5 text-[clamp(1.85rem,3.8vw,2.85rem)] text-ink">
                {t("jbTitle")}
              </h2>
              <p className="mt-6 max-w-[44ch] text-base leading-[1.65] text-ink-soft">{t("jbBody")}</p>
            </Reveal>
            <Reveal delay={0.12}>
              <ol className="mt-9 flex flex-wrap items-center gap-2">
                {PHASES.map((p, i) => (
                  <li key={p.key} className="flex items-center gap-2">
                    <span className={`rounded-full px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] ring-1 ${p.tone}`}>{t(p.key)}</span>
                    {i < PHASES.length - 1 && (
                      <span className="text-line-strong" aria-hidden="true">
                        →
                      </span>
                    )}
                  </li>
                ))}
              </ol>
              <Link to="/dashboard" className="btn-primary mt-10">
                {t("jbCta")}
                <Arrow />
              </Link>
            </Reveal>
          </div>

          <Reveal delay={0.08}>
            <ul className="grid gap-px overflow-hidden rounded-[20px] border border-line bg-line">
              {LAYERS.map(([name, detail, role], i) => (
                <li key={name} className="grid grid-cols-[2.5rem_1fr] gap-x-4 bg-panel px-6 py-5 sm:grid-cols-[2.5rem_1fr_auto] sm:items-center">
                  <span className="font-mono text-xs font-bold text-ink-muted">{String(i + 1).padStart(2, "0")}</span>
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">{t(name)}</p>
                    <p className="mt-0.5 text-sm text-ink-soft">{t(detail)}</p>
                  </div>
                  <span className="col-start-2 mt-2 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-glow sm:col-start-3 sm:mt-0 sm:text-right">
                    {t(role)}
                  </span>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </section>

      {/* Why it matters */}
      <div className="border-t border-line bg-panel-2">
        <Statement eyebrow={t("whyEyebrow")} lines={[t("why1"), t("why2"), t("why3")]}>
          <div className="mx-auto mt-9 max-w-[46ch] space-y-3 text-[1.05rem] leading-[1.65] text-ink-soft">
            {rules && <p>{t("evidenceMandate", { n: rules.mandatory_min_plot_m2 })}</p>}
            {rules && <p>{t("evidenceMoney", { rebate: pct(rules.rebate_fraction), penalty: pct(rules.penalty_fraction) })}</p>}
          </div>
          {sources.length > 0 && (
            <details className="mx-auto mt-6 max-w-xl text-left text-sm text-ink-muted">
              <summary className="cursor-pointer text-center font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-glow">{t("sourcesLabel")}</summary>
              <ul className="mt-3 list-disc space-y-1 pl-5">
                {sources.map((s) => (
                  <li key={s.url}>
                    <a href={s.url} target="_blank" rel="noreferrer" className="underline">
                      {s.title}
                    </a>{" "}
                    ({s.date})
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Statement>
      </div>

      {/* Closing call */}
      <footer className={`relative overflow-hidden border-t border-line ${PAD} pt-24 pb-10`}>
        <div className="mx-auto max-w-[1180px]">
          <Reveal className="text-center">
            <span className="eyebrow text-glow">{t("footEyebrow")}</span>
            <p className="display mx-auto mt-5 max-w-[22ch] text-[clamp(2rem,5vw,3.5rem)] text-ink">{t("footTitle")}</p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <button type="button" className="btn-primary" onClick={toTop}>
                {t("footStart")}
                <Arrow />
              </button>
              <Link to="/dashboard" className="btn-secondary">
                {t("officersLink")}
              </Link>
            </div>
          </Reveal>

          <div className="mt-20 flex flex-col items-center justify-between gap-5 border-t border-line pt-8 text-center sm:flex-row sm:text-left">
            <div>
              <p className="font-display text-xl font-extrabold tracking-[-0.02em] text-ink">{t("appName")}</p>
              <p className="mt-1 text-xs text-ink-muted">{t("footNotGov")}</p>
            </div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink-muted">{t("footSources")}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
