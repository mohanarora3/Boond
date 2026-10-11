import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../lib/i18n";

/*
 * The five steps from a roof to water in the ground, drawn as one wave: odd steps ride the crests, even steps the troughs.
 * "story" (front page) walks a marker along the wave step by step; "progress" (plan page) parks it on the homeowner's step.
 */

export type StopState = "done" | "current" | "todo" | "warn";
export interface Stop {
  title: string;
  sub: string;
  state: StopState;
}

const W = 1000;
const H = 320;
// Crest, trough, crest, trough, crest — the middle step sits highest.
const POINTS: [number, number][] = [
  [40, 150],
  [270, 262],
  [500, 64],
  [730, 262],
  [960, 120],
];

/** Catmull-Rom through the points, as cubic Béziers, with gentle lead-in and lead-out. */
function wavePath(pts: [number, number][]): string {
  const p = [[pts[0][0] - 30, pts[0][1] - 40] as [number, number], ...pts, [pts[pts.length - 1][0] + 30, pts[pts.length - 1][1] - 40] as [number, number]];
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < p.length - 2; i++) {
    const [x0, y0] = p[i - 1];
    const [x1, y1] = p[i];
    const [x2, y2] = p[i + 1];
    const [x3, y3] = p[i + 2];
    d += ` C ${x1 + (x2 - x0) / 6} ${y1 + (y2 - y0) / 6}, ${x2 - (x3 - x1) / 6} ${y2 - (y3 - y1) / 6}, ${x2} ${y2}`;
  }
  return d;
}

const reduced = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Tweens a number toward a target with an ease-out, so the marker glides along the wave. */
function useTween(target: number, ms = 1000): number {
  const [value, setValue] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (reduced()) {
      setValue(target);
      from.current = target;
      return;
    }
    const start = performance.now();
    const a = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      const v = a + (target - a) * (1 - Math.pow(1 - k, 3));
      from.current = v;
      setValue(v);
      if (k < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, ms]);
  return value;
}

function Numeral({ n, state, className = "" }: { n: number; state: StopState; className?: string }) {
  const lit = state === "current" || state === "warn";
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none select-none font-display font-extrabold leading-none tracking-tighter ${
        lit
          ? state === "warn"
            ? "bg-gradient-to-b from-status-attention to-status-attention/0 bg-clip-text text-transparent"
            : "bg-gradient-to-b from-cta to-cta/0 bg-clip-text text-transparent"
          : "text-ink/[0.07]"
      } ${className}`}
    >
      {n}
    </span>
  );
}

function Label({ stop, align }: { stop: Stop; align: "left" | "center" | "right" }) {
  const lit = stop.state === "current" || stop.state === "warn";
  const tone = stop.state === "warn" ? "text-status-attention" : lit ? "text-cta" : "text-ink";
  return (
    <div className={`w-max max-w-[13rem] ${align === "left" ? "text-left" : align === "right" ? "text-right" : "text-center"}`}>
      <p className={`font-display text-lg font-bold leading-tight ${tone}`}>
        {stop.state === "done" && (
          <span className="mr-1.5 text-status-verified" aria-hidden="true">
            ✓
          </span>
        )}
        {stop.title}
      </p>
      <p className={`mt-1 text-sm leading-snug ${lit ? tone : "text-ink-muted"}`}>{stop.sub}</p>
    </div>
  );
}

export default function JourneyWave({
  stops,
  mode,
  current = 0,
  title,
}: {
  stops: Stop[];
  mode: "story" | "progress";
  /** Index of the step the marker sits on (progress mode). Use stops.length - 1 with every stop done for "finished". */
  current?: number;
  title?: string;
}) {
  const { t } = useI18n();
  const d = useMemo(() => wavePath(POINTS), []);
  const pathRef = useRef<SVGPathElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [fracs, setFracs] = useState<number[]>(POINTS.map((_, i) => i / (POINTS.length - 1)));
  const [total, setTotal] = useState(0);
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(mode === "progress" ? current : 0);

  // Where each step sits along the curve, as a fraction of its length.
  useLayoutEffect(() => {
    const path = pathRef.current;
    if (!path?.getTotalLength) return;
    const len = path.getTotalLength();
    const samples = 600;
    const found = POINTS.map(([px]) => {
      let best = 0;
      let bestDx = Infinity;
      for (let i = 0; i <= samples; i++) {
        const dx = Math.abs(path.getPointAtLength((len * i) / samples).x - px);
        if (dx < bestDx) {
          bestDx = dx;
          best = i / samples;
        }
      }
      return best;
    });
    setTotal(len);
    setFracs(found);
  }, [d]);

  // Start moving only once the wave is on screen.
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Story: step through the journey, pause at the end, start again.
  useEffect(() => {
    if (mode !== "story" || !visible || reduced()) return;
    const id = window.setInterval(() => setStep((s) => (s + 1) % stops.length), 2600);
    return () => window.clearInterval(id);
  }, [mode, visible, stops.length]);
  useEffect(() => {
    if (mode === "progress") setStep(current);
  }, [mode, current]);

  const target = visible ? fracs[Math.min(step, fracs.length - 1)] : 0;
  const f = useTween(target, mode === "story" && step === 0 ? 700 : 1200);
  const dot = total && pathRef.current ? pathRef.current.getPointAtLength(f * total) : { x: POINTS[0][0], y: POINTS[0][1] };

  // In story mode the lit step follows the marker; in progress mode it is the plan's own state.
  const shown: Stop[] =
    mode === "story" ? stops.map((s, i) => ({ ...s, state: i === step ? "current" : i < step ? "done" : "todo" })) : stops;
  const markerWarn = shown[step]?.state === "warn";

  return (
    <section aria-label={title ?? t("howItWorks")} className="relative">
      {/* Wide screens: the wave */}
      <div ref={boxRef} className="relative hidden pb-28 pt-28 md:block">
        <div className="relative" style={{ aspectRatio: `${W} / ${H}` }}>
          <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
            <defs>
              <filter id="jw-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="6" />
              </filter>
            </defs>
            <path ref={pathRef} d={d} fill="none" stroke="var(--color-line-strong)" strokeWidth="1.5" />
            <path
              d={d}
              fill="none"
              stroke="var(--color-cta)"
              strokeWidth="3"
              strokeLinecap="round"
              pathLength={1}
              strokeDasharray="1 1"
              strokeDashoffset={1 - f}
            />
            {POINTS.map(([x, y], i) => (
              <circle
                key={i}
                cx={x}
                cy={y}
                r={5}
                fill={shown[i].state === "todo" ? "var(--color-panel)" : "var(--color-cta)"}
                stroke={shown[i].state === "todo" ? "var(--color-line-strong)" : "var(--color-cta)"}
                strokeWidth="2"
              />
            ))}
            <circle cx={dot.x} cy={dot.y} r={16} fill={markerWarn ? "var(--color-status-attention)" : "var(--color-cta)"} opacity="0.35" filter="url(#jw-glow)" />
            <circle cx={dot.x} cy={dot.y} r={11} fill="var(--color-panel)" stroke={markerWarn ? "var(--color-status-attention)" : "var(--color-cta)"} strokeWidth="3" />
            <circle cx={dot.x} cy={dot.y} r={4} fill={markerWarn ? "var(--color-status-attention)" : "var(--color-cta)"} />
          </svg>

          {POINTS.map(([x, y], i) => {
            const up = i % 2 === 0; // crests carry their label above, troughs below
            const align = i === 0 ? "left" : i === POINTS.length - 1 ? "right" : "center";
            const shift = align === "left" ? "0%" : align === "right" ? "-100%" : "-50%";
            return (
              <div
                key={i}
                className="absolute"
                style={{
                  left: `${(x / W) * 100}%`,
                  top: `${(y / H) * 100}%`,
                  transform: `translate(${shift}, ${up ? "calc(-100% - 22px)" : "22px"})`,
                }}
              >
                <div className="relative isolate">
                  <Numeral
                    n={i + 1}
                    state={shown[i].state}
                    className={`absolute text-[8.5rem] ${up ? "-top-10" : "-top-6"} -right-[3.75rem] -z-10`}
                  />
                  <Label stop={shown[i]} align={align} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Phones: the same steps, stacked along a line */}
      <ol className="relative space-y-7 border-l-2 border-line pl-7 md:hidden">
        {shown.map((s, i) => (
          <li key={i} className="relative" aria-current={s.state === "current" || s.state === "warn" ? "step" : undefined}>
            <span
              className={`absolute -left-[2.15rem] top-1 h-4 w-4 rounded-full border-2 ${
                s.state === "todo"
                  ? "border-line-strong bg-panel"
                  : s.state === "warn"
                    ? "border-status-attention bg-panel ring-4 ring-status-attention/20"
                    : s.state === "current"
                      ? "border-cta bg-panel ring-4 ring-cta/20"
                      : "border-cta bg-cta"
              }`}
              aria-hidden="true"
            />
            <div className="flex items-start justify-between gap-3">
              <Label stop={s} align="left" />
              <Numeral n={i + 1} state={s.state} className="-mt-2 text-6xl" />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
