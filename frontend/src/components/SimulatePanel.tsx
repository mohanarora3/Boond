import { useEffect, useRef, useState } from "react";
import { api, ApiError, type Simulation } from "../lib/api";
import { bigLitres } from "../lib/area";
import { Rich, useI18n } from "../lib/i18n";

const DURATION_MS = 6000;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    mq?.addEventListener("change", on);
    return () => mq?.removeEventListener("change", on);
  }, []);
  return reduced;
}

interface Props {
  slug: string;
  wardName: string;
  dailyCycles?: number;
  /** Called with the result when the animation starts (null when cleared), so a map can colour buildings. */
  onResult?: (sim: Simulation | null) => void;
  /** Called with true while the storm is playing (for a rain overlay). */
  onPlaying?: (playing: boolean) => void;
}

export default function SimulatePanel({ slug, wardName, dailyCycles, onResult, onPlaying }: Props) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const [sim, setSim] = useState<Simulation | null>(null);
  const [progress, setProgress] = useState(0); // 0..1
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const frame = useRef<number>(0);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  async function run() {
    setLoading(true);
    setError(null);
    cancelAnimationFrame(frame.current);
    try {
      const result = await api.simulate(slug);
      setSim(result);
      onResult?.(result);
      if (reduced) {
        setProgress(1);
        return;
      }
      onPlaying?.(true);
      const start = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - start) / DURATION_MS);
        setProgress(p);
        if (p < 1) frame.current = requestAnimationFrame(tick);
        else onPlaying?.(false);
      };
      setProgress(0);
      frame.current = requestAnimationFrame(tick);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const fmt = (litres: number) => {
    const b = bigLitres(litres);
    return t(b.key, { n: b.n });
  };
  const eased = 1 - Math.pow(1 - progress, 3);
  const counters = sim
    ? [
        { label: t("simCaptured"), value: sim.totals.captured, cls: "text-glow", bar: "bg-water-500" },
        { label: t("simLost"), value: sim.totals.lostToDrains, cls: "text-ink-soft", bar: "bg-slate-400" },
        { label: t("simBroken"), value: sim.totals.lostBroken, cls: "text-red-800", bar: "bg-status-attention" },
      ]
    : [];
  const done = sim && progress >= 1;

  return (
    <section className="card space-y-4" aria-labelledby="sim-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="sim-title" className="text-lg font-bold text-ink">
          {t("simulate")}
        </h2>
        <button type="button" className="btn-primary" onClick={run} disabled={loading || (!!sim && !done)}>
          {loading ? t("loading") : sim && !done ? t("simulating") : sim ? `↻ ${t("simAgain")}` : t("simulate")}
        </button>
      </div>

      {sim && (
        <p className="text-ink-soft">
          {t("simIntro", { date: new Date(sim.date).toLocaleDateString(), mm: Math.round(sim.rainMm), ward: wardName })}
        </p>
      )}

      {sim && (
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-live="off">
          {counters.map((c) => (
            <div key={c.label} className="rounded-xl bg-panel-2 p-3">
              <dt className="text-sm text-ink-muted">{c.label}</dt>
              <dd className={`text-2xl font-bold tabular-nums ${c.cls}`}>{fmt(c.value * eased)}</dd>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-line" aria-hidden="true">
                <div className={`h-full ${c.bar}`} style={{ width: `${sim.totalRunoff ? (c.value / sim.totalRunoff) * 100 * eased : 0}%` }} />
              </div>
            </div>
          ))}
        </dl>
      )}

      {done && (
        <div className="space-y-2 rounded-xl bg-water-50 p-4 text-lg leading-snug text-ink" aria-live="polite">
          <p>
            <Rich text={t("simEnd", { captured: fmt(sim.totals.captured), lost: fmt(sim.totals.lostToDrains) })} />{" "}
            {sim.totals.lostBroken > 0 && <Rich text={t("simEndBroken", { broken: fmt(sim.totals.lostBroken) })} />}
          </p>
          <p>
            <Rich text={t("simIfAll", { all: fmt(sim.ifAllRequiredHarvested) })} />
          </p>
        </div>
      )}
      {sim && dailyCycles !== undefined && <p className="text-xs text-ink-muted">{t("simNote", { cycles: dailyCycles })}</p>}
      {error && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-amber-900" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
