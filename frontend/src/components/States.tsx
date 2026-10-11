import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../lib/i18n";

/** Grey placeholder blocks shown while content loads — never a blank screen. */
export function Skeleton({ lines = 3, hero = true }: { lines?: number; hero?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="space-y-4" role="status" aria-label={t("loadingLabel")}>
      {hero && <div className="skeleton h-40 w-full" />}
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton h-24 w-full" />
      ))}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="card space-y-3 border-red-200 bg-red-50" role="alert">
      <h2 className="text-lg font-bold text-red-800">{t("errorTitle")}</h2>
      <p className="text-red-800">{message}</p>
      <div className="flex flex-wrap gap-2">
        {onRetry && (
          <button type="button" className="btn-primary" onClick={onRetry}>
            {t("retry")}
          </button>
        )}
        <Link to="/" className="btn-ghost">
          {t("goHome")}
        </Link>
      </div>
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-(--radius-card) border border-dashed border-line-strong bg-panel px-5 py-8 text-center text-ink-muted">{children}</p>;
}
