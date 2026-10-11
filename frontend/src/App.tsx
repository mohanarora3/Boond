import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import SiteMenu from "./components/SiteMenu";
import { EmptyState } from "./components/States";
import { useI18n } from "./lib/i18n";
import { night } from "./lib/tokens";
import Applications from "./pages/Applications";
import Chat from "./pages/Chat";
import Dashboard from "./pages/Dashboard";
import Landing from "./pages/Landing";
import Maintenance from "./pages/Maintenance";
import Plan from "./pages/Plan";
import Start from "./pages/Start";
import Verify from "./pages/Verify";
import WardMap from "./pages/WardMap";

function Logo() {
  // Ink drop outline with a red ripple inside, in the same two colours as the rest of the site.
  return (
    <svg viewBox="0 0 28 28" className="h-7 w-7 shrink-0" fill="none" aria-hidden="true">
      <path d="M14 2.5C14 2.5 5 12.6 5 18a9 9 0 0 0 18 0c0-5.4-9-15.5-9-15.5Z" stroke={night.ink} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M9.2 18.4c1.3-1.5 2.5-1.5 3.8 0s2.5 1.5 3.8 0" stroke={night.cta} strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

function NotFound() {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <EmptyState>{t("notFound")}</EmptyState>
      <Link to="/" className="btn-primary w-full">
        {t("goHome")}
      </Link>
    </div>
  );
}

export default function App() {
  const { t, lang, setLang } = useI18n();
  const { pathname } = useLocation();
  // Two separate areas: homeowners (search → plan) and Jal Board officers (ward dashboards).
  const officer = pathname.startsWith("/dashboard") || pathname.startsWith("/ward/") || pathname.startsWith("/officer");
  const langButton = (
    <button
      type="button"
      onClick={() => setLang(lang === "en" ? "hi" : "en")}
      className="min-h-11 min-w-11 rounded-full border border-line-strong bg-panel px-3 font-semibold text-ink hover:border-cta hover:text-cta"
      lang={lang === "en" ? "hi" : "en"}
    >
      {t("langToggle")}
    </button>
  );
  return (
    <div className="min-h-dvh overflow-x-clip">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[3000] focus:rounded focus:bg-cta focus:px-3 focus:py-2 focus:font-semibold focus:text-cta-ink">
        {t("skipToContent")}
      </a>
      <header className="sticky top-0 z-[1100] border-b border-line bg-deep/85 backdrop-blur-xl">
        {/* Full width: logo hard left, actions hard right. */}
        <div className="flex items-center justify-between gap-3 px-4 py-2 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <SiteMenu />
            <Link to={officer ? "/dashboard" : "/"} className="flex min-h-11 items-center gap-2.5 font-display text-[1.35rem] font-extrabold tracking-[-0.02em] text-ink">
              <Logo />
              {t("appName")}
            </Link>
            {officer && <span className="hidden rounded-full bg-cta/10 px-3 py-1 text-xs font-semibold text-cta sm:inline">{t("officerView")}</span>}
          </div>
          {officer ? (
            <nav className="flex items-center gap-1" aria-label={t("officerView")}>
              <NavLink to="/dashboard" className="nav-link-always">
                {t("navWards")}
              </NavLink>
              <NavLink to="/officer/applications" className="nav-link-always">
                {t("navApplications")}
              </NavLink>
              <span className="mx-1 hidden h-6 w-px bg-line sm:block" aria-hidden="true" />
              <Link to="/" className="nav-link">
                {t("homeownerSite")}
              </Link>
              {langButton}
            </nav>
          ) : (
            <nav className="flex items-center gap-2" aria-label={t("appName")}>
              {langButton}
              <Link to="/" className="btn-pill">
                {t("startPlan")}
              </Link>
            </nav>
          )}
        </div>
      </header>
      <main id="main" className="mx-auto max-w-2xl px-4 py-6 pb-16">
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/start" element={<Start />} />
          <Route path="/plan/:id" element={<Plan />} />
          <Route path="/plan/:id/chat" element={<Chat />} />
          <Route path="/plan/:id/maintenance" element={<Maintenance />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/ward/:ward" element={<WardMap />} />
          <Route path="/officer/applications" element={<Applications />} />
          <Route path="/verify/:id" element={<Verify />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
}
