import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import IndiaHero from "../IndiaHero";
import { api, ApiError, type GeocodeResult } from "../../lib/api";
import { useI18n } from "../../lib/i18n";

/*
 * The homeowner's front door: headline and house search on the left, the India outline with Delhi marked on the right.
 * Picking an address zooms the outline into Delhi, then hands over to the roof step (where the satellite map flies to the roof).
 */

const DEBOUNCE_MS = 700; // the backend's Nominatim fallback allows 1 request per second
const ZOOM_MS = 750;

interface Props {
  initialQuery: string;
  onChoose: (place: GeocodeResult) => void;
  /** "home" adds the demo link; "step" is the same search inside the planning flow. */
  variant?: "home" | "step";
  /** Three short facts under the search (front page only). */
  stats?: { value: string; label: string }[];
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export default function FindStep({ initialQuery, onChoose, variant = "step", stats }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [busy, setBusy] = useState<"search" | "locate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zooming, setZooming] = useState(false);
  const requestId = useRef(0);
  const typed = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  /** Dive into Delhi, then continue (instantly with reduced motion). */
  function choose(place: GeocodeResult) {
    if (zooming) return;
    if (reducedMotion()) return onChoose(place);
    setZooming(true);
    timer.current = window.setTimeout(() => onChoose(place), ZOOM_MS);
  }

  async function search(q: string) {
    const id = ++requestId.current;
    setBusy("search");
    setError(null);
    try {
      const found = await api.geocode(q);
      if (id === requestId.current) setResults(found);
    } catch (err) {
      if (id === requestId.current) setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      if (id === requestId.current) setBusy(null);
    }
  }

  // Debounced suggestions while typing.
  useEffect(() => {
    if (!typed.current || query.trim().length < 3) return;
    const id = setTimeout(() => search(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (query.trim().length >= 3) search(query.trim());
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setError(t("locationDenied"));
      return;
    }
    setBusy("locate");
    setError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const [place] = await api.reverseGeocode(pos.coords.latitude, pos.coords.longitude);
          if (place) choose(place);
        } catch (err) {
          setError(err instanceof ApiError ? err.message : String(err));
        } finally {
          setBusy(null);
        }
      },
      () => {
        setBusy(null);
        setError(t("locationDenied"));
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <section className="relative flex min-h-[calc(100svh-61px)] w-screen items-center overflow-hidden [margin-inline:calc(50%-50vw)] -mt-6">
      {/* Drafting grid and two warm washes behind the hero. */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="hero-grid absolute inset-0" />
        <div className="absolute -top-32 right-[-8%] h-[560px] w-[560px] rounded-full bg-[radial-gradient(circle,rgb(208_44_42_/_0.08),transparent_70%)] blur-3xl" />
        <div className="absolute bottom-[-10%] left-[-12%] h-[480px] w-[480px] rounded-full bg-[radial-gradient(circle,rgb(196_160_100_/_0.22),transparent_70%)] blur-3xl" />
      </div>

      <div className="relative mx-auto grid w-full max-w-[1180px] items-center gap-10 px-[clamp(20px,5vw,64px)] py-12 lg:grid-cols-[1.08fr_0.92fr] lg:gap-14">
        <div className={`max-w-xl transition-opacity duration-500 ${zooming ? "opacity-0" : ""}`}>
          <p className="eyebrow text-glow">{t("heroEyebrow")}</p>
          <h1 className="mt-3 mb-4 font-display font-extrabold leading-none">
            <span className="mb-2 block text-[clamp(1rem,1.8vw,1.2rem)] tracking-[-0.01em] text-ink-muted">{t("heroKicker")}</span>
            <span className="block text-[clamp(2.3rem,5vw,3.7rem)] leading-[1.03] tracking-[-0.045em] text-ink">
              {t("heroImpact1")}
              <br />
              <em className="not-italic text-cta">{t("heroImpact2")}</em>
            </span>
          </h1>
          <p className="max-w-lg text-[clamp(1rem,1.3vw,1.1rem)] leading-relaxed text-ink-soft">{t("heroSub")}</p>

          <div className="mt-7 space-y-3">
            <form
              onSubmit={onSubmit}
              className="flex gap-2 rounded-xl border border-line-strong bg-panel p-1.5 shadow-[0_12px_32px_-20px_rgb(49_31_24_/_0.4)] focus-within:border-ink"
              role="search"
            >
              <span className="grid w-8 shrink-0 place-items-center text-xl text-ink-muted" aria-hidden="true">
                ⌕
              </span>
              <input
                className="min-h-12 w-full min-w-0 flex-1 bg-transparent text-lg text-ink outline-none placeholder:text-ink-muted"
                value={query}
                onChange={(e) => {
                  typed.current = true;
                  setQuery(e.target.value);
                }}
                placeholder={t("searchPlaceholder")}
                aria-label={t("step1")}
                autoComplete="street-address"
                autoFocus
              />
              <button className="btn-primary min-h-12 shrink-0 px-6" disabled={busy !== null || zooming || query.trim().length < 3}>
                {busy === "search" ? t("searching") : t("search")}
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                </svg>
              </button>
            </form>

            {results && (
              <ul className="overflow-hidden rounded-xl border border-line bg-panel shadow-sm" aria-label={t("suggestionsLabel")}>
                {results.length === 0 && <li className="px-4 py-3 text-ink-soft">{t("noResults")}</li>}
                {results.map((r) => (
                  <li key={`${r.lat},${r.lon}`} className="border-b border-line last:border-0">
                    <button
                      type="button"
                      onClick={() => choose(r)}
                      className="flex min-h-12 w-full items-start gap-3 px-4 py-3 text-left hover:bg-panel-2 focus:bg-panel-2"
                    >
                      <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-cta" />
                      <span>
                        <span className="text-ink">{r.label}</span>
                        {r.ward && <span className="block text-sm text-ink-muted">{r.ward}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
              <button type="button" className="btn-ghost -ml-4" onClick={useMyLocation} disabled={busy !== null || zooming}>
                ◎ {busy === "locate" ? t("locating") : t("useMyLocation")}
              </button>
              {variant === "home" && (
                <>
                  <span className="hidden text-line-strong sm:inline" aria-hidden="true">
                    ·
                  </span>
                  <Link to="/start?demo=1" className="btn-ghost -ml-4 sm:ml-0">
                    ▶ {t("tryDemo")}
                  </Link>
                </>
              )}
            </div>

            {error && (
              <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900" role="alert">
                {error}
              </p>
            )}
          </div>

          <ul className="mt-5 flex flex-wrap gap-2" aria-label={t("heroTrust")}>
            {(["heroTag1", "heroTag2", "heroTag3", "heroTag4"] as const).map((k) => (
              <li key={k} className="rounded-full border border-line bg-panel/60 px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
                {t(k)}
              </li>
            ))}
          </ul>

          {stats && (
            <dl className="mt-7 grid max-w-md grid-cols-3 gap-4 border-t border-line pt-5">
              {stats.map((s) => (
                <div key={s.label}>
                  <dt className="font-display text-2xl font-extrabold tracking-[-0.03em] text-ink">{s.value}</dt>
                  <dd className="mt-2 font-mono text-[10px] font-semibold uppercase leading-snug tracking-[0.08em] text-ink-muted">{s.label}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        {/* India sits in a tilted cream card on wide screens, above the text on phones. */}
        <div className="order-first mx-auto w-full max-w-[13rem] lg:order-none lg:max-w-[440px]">
          <div className="seal-card px-6 pb-6 pt-12 sm:px-10 lg:px-12 lg:pb-10 lg:pt-14">
            <span className="absolute right-6 top-5 z-10 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink-muted">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cta" aria-hidden="true" />
              {t("heroCardLive")}
            </span>
            <IndiaHero state={zooming ? "zooming" : busy === "search" ? "searching" : "idle"} className="pointer-events-none" />
            <p className="mt-4 hidden text-center text-sm text-ink-muted lg:block">{t("heroCardCaption")}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
