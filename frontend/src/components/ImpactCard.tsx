import { useEffect, useMemo, useState } from "react";
import { api, type Impact, type ImpactDay } from "../lib/api";
import { bigLitres, formatNum } from "../lib/area";
import { Rich, useI18n } from "../lib/i18n";
import { water } from "../lib/tokens";

interface Week {
  start: string;
  litres: number;
}

/** Daily series → Monday-start weekly totals (readable bars at phone width). */
function weekly(series: ImpactDay[]): Week[] {
  const weeks = new Map<string, number>();
  for (const d of series) {
    const day = new Date(`${d.date}T00:00:00`);
    day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    weeks.set(key, (weeks.get(key) ?? 0) + d.litres);
  }
  return [...weeks].map(([start, litres]) => ({ start, litres }));
}

function WeeklyBars({ weeks, label, fmtDate }: { weeks: Week[]; label: string; fmtDate: (iso: string) => string }) {
  const { t } = useI18n();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...weeks.map((w) => w.litres));
  const W = 320, H = 110, gap = 2;
  const bw = (W - gap * (weeks.length - 1)) / Math.max(weeks.length, 1);
  const h = hover !== null ? weeks[hover] : null;
  return (
    <figure className="space-y-2">
      <figcaption className="text-sm font-medium text-ink-soft">{label}</figcaption>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H + 2}`} className="h-auto w-full" role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
          <line x1="0" x2={W} y1={H + 1} y2={H + 1} stroke="currentColor" className="text-line-strong" strokeWidth="1" />
          {weeks.map((w, i) => {
            const bh = Math.max(w.litres > 0 ? 2 : 0, (w.litres / max) * H);
            return (
              <g key={w.start} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
                {/* Hit target taller than the bar. */}
                <rect x={i * (bw + gap)} y={0} width={bw} height={H} fill="transparent" />
                <path
                  d={`M${i * (bw + gap)},${H} v${-bh + Math.min(4, bh)} q0,-${Math.min(4, bh)} ${Math.min(4, bw / 2)},-${Math.min(4, bh)} h${bw - 2 * Math.min(4, bw / 2)} q${Math.min(4, bw / 2)},0 ${Math.min(4, bw / 2)},${Math.min(4, bh)} v${bh - Math.min(4, bh)} z`}
                  fill={hover === null || hover === i ? water[600] : water[300]}
                />
              </g>
            );
          })}
        </svg>
        {h && (
          <div className="pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white shadow" role="status">
            {t("impactWeekOf", { date: fmtDate(h.start) })}: <strong>{t("litresShort", { n: formatNum(h.litres) })}</strong>
          </div>
        )}
      </div>
      <details className="text-sm text-ink-soft">
        <summary className="min-h-10 cursor-pointer py-2 font-semibold text-glow">{t("impactTable")}</summary>
        <table className="w-full text-left">
          <thead className="text-ink-muted">
            <tr>
              <th className="py-1 font-medium">{t("colWeek")}</th>
              <th className="py-1 text-right font-medium">{t("colLitresCaught")}</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => (
              <tr key={w.start}>
                <td className="py-0.5">{fmtDate(w.start)}</td>
                <td className="py-0.5 text-right tabular-nums">{formatNum(w.litres)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

export default function ImpactCard({ planId }: { planId: string }) {
  const { t, lang } = useI18n();
  const [impact, setImpact] = useState<Impact | null>(null);
  useEffect(() => {
    api.impact(planId).then(setImpact).catch(() => setImpact({ available: false, stale: true, computedAt: null }));
  }, [planId]);
  const weeks = useMemo(() => weekly(impact?.series ?? []), [impact]);

  if (!impact) return <div className="skeleton h-40" role="status" aria-label={t("loadingLabel")} />;
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(lang === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short" });
  const big = (n: number) => {
    const b = bigLitres(n);
    return b.key === "litresPlain" ? t("litresShort", { n: b.n }) : t(b.key, { n: b.n });
  };

  return (
    <section className="card space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">{t("impactTitle")}</h2>
      {!impact.available ? (
        <p className="text-ink-soft">{t("impactUnavailable")}</p>
      ) : (
        <>
          <p className="text-xl leading-snug text-ink">
            <Rich text={t("impactSince", { litres: big(impact.totalLitres ?? 0) })} />{" "}
            {impact.lastRain ? (
              <Rich text={t("impactLastRain", { date: fmtDate(impact.lastRain.date), litres: big(impact.lastRain.litres) })} />
            ) : (
              t("impactNoRain")
            )}
          </p>
          {weeks.some((w) => w.litres > 0) && <WeeklyBars weeks={weeks} label={t("impactWeekly")} fmtDate={fmtDate} />}
          {(impact.brokenDays ?? 0) > 0 && <p className="text-sm text-amber-900">{t("impactBrokenDays", { n: impact.brokenDays ?? 0 })}</p>}
          {impact.stale && impact.computedAt && <p className="text-sm text-ink-muted">{t("impactStale", { date: fmtDate(impact.computedAt) })}</p>}
        </>
      )}
      <p className="text-xs text-ink-muted">{t("impactEstimate")}</p>
    </section>
  );
}
