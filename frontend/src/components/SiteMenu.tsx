import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router-dom";
import { api, ApiError, type Plan } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { PLAN_CHANGED, recentPlans, type RecentPlan } from "../lib/recentPlans";
import { StagesList } from "./PlanStages";

/**
 * The menu button at the far left of the header, on every page. The drawer is portalled to <body> because the
 * header's backdrop blur would otherwise clip a fixed-position child to the header's own box. It opens a drawer from the left with the
 * homeowner's plan and every stage of it (what is saved, what is next), their recent plans, and the main links.
 */
export default function SiteMenu() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [recent, setRecent] = useState<RecentPlan[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  const routePlanId = /^\/plan\/([^/?#]+)/.exec(pathname)?.[1] ?? null;

  // Close whenever the page changes.
  useEffect(() => setOpen(false), [pathname]);

  // Load the plan to show: the one on screen, else the last one this browser opened.
  useEffect(() => {
    if (!open) return;
    const list = recentPlans();
    setRecent(list);
    const id = routePlanId ?? list[0]?.planId ?? null;
    setPlan(null);
    setError(null);
    if (!id) return;
    let live = true;
    api
      .getPlan(id)
      .then((p) => live && setPlan(p))
      .catch(() => live && setPlan(null));
    return () => {
      live = false;
    };
  }, [open, routePlanId]);

  // Focus, Escape to close, no page scroll behind.
  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    const opener = button.current;
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      opener?.focus();
    };
  }, [open]);

  const getApplication = useCallback(async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.generateApplication(plan.planId);
      window.open(r.url, "_blank", "noopener");
      setPlan(await api.getPlan(plan.planId));
      window.dispatchEvent(new CustomEvent(PLAN_CHANGED, { detail: plan.planId }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [plan]);

  const others = recent.filter((r) => r.planId !== plan?.planId);

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => setOpen(true)}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink transition hover:bg-panel-2"
        aria-label={t("menuOpen")}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

      {open &&
        createPortal(
        <div className="fixed inset-0 z-[2000]">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} aria-hidden="true" />
          <aside
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label={t("menuTitle")}
            tabIndex={-1}
            className="drawer-in absolute inset-y-0 left-0 flex w-full max-w-md flex-col bg-deep shadow-2xl outline-none"
          >
            <header className="flex items-center justify-between gap-3 border-b border-line px-6 py-4">
              <p className="eyebrow text-glow">{t("menuTitle")}</p>
              <button type="button" onClick={() => setOpen(false)} className="grid h-10 w-10 place-items-center rounded-full text-ink-soft hover:bg-panel-2" aria-label={t("close")}>
                ✕
              </button>
            </header>

            <div className="flex-1 overflow-y-auto">
              {/* The plan and its stages */}
              {plan && (
                <section className="border-b border-line px-6 py-5" aria-labelledby="menu-plan">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 id="menu-plan" className="text-xl font-bold text-ink">
                        {t("stagesTitle")}
                      </h2>
                      <p className="mt-0.5 truncate text-sm text-ink-muted">{plan.address}</p>
                    </div>
                    {routePlanId !== plan.planId && (
                      <Link to={`/plan/${plan.planId}`} className="shrink-0 text-sm font-semibold text-glow underline underline-offset-4">
                        {t("menuOpenPlan")}
                      </Link>
                    )}
                  </div>
                  {error && (
                    <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
                      {error}
                    </p>
                  )}
                  <StagesList plan={plan} onGetApplication={getApplication} busy={busy} />
                </section>
              )}

              {/* Links */}
              <nav className="px-6 py-5" aria-label={t("menuTitle")}>
                <ul className="space-y-1">
                  <li>
                    <Link to="/" className="flex min-h-11 items-center rounded-lg px-3 font-semibold text-ink hover:bg-panel-2">
                      {t("menuHome")}
                    </Link>
                  </li>
                  <li>
                    <Link to="/start" className="flex min-h-11 items-center rounded-lg px-3 font-semibold text-ink hover:bg-panel-2">
                      {t("menuNewPlan")}
                    </Link>
                  </li>
                </ul>

                {others.length > 0 && (
                  <>
                    <p className="eyebrow mt-6 px-3 text-ink-muted">{t("menuRecent")}</p>
                    <ul className="mt-2 space-y-1">
                      {others.map((r) => (
                        <li key={r.planId}>
                          <Link to={`/plan/${r.planId}`} className="block rounded-lg px-3 py-2 text-sm text-ink-soft hover:bg-panel-2 hover:text-ink">
                            <span className="line-clamp-1">{r.address}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                <p className="eyebrow mt-6 px-3 text-ink-muted">{t("menuOfficers")}</p>
                <ul className="mt-2 space-y-1">
                  <li>
                    <Link to="/dashboard" className="flex min-h-11 items-center rounded-lg px-3 text-ink-soft hover:bg-panel-2 hover:text-ink">
                      {t("navWards")}
                    </Link>
                  </li>
                  <li>
                    <Link to="/officer/applications" className="flex min-h-11 items-center rounded-lg px-3 text-ink-soft hover:bg-panel-2 hover:text-ink">
                      {t("navApplications")}
                    </Link>
                  </li>
                </ul>
              </nav>
            </div>
          </aside>
        </div>,
          document.body,
        )}
    </>
  );
}
