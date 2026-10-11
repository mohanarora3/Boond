import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ErrorState, Skeleton } from "../components/States";
import { api, ApiError, type PublicStatus } from "../lib/api";
import { useI18n } from "../lib/i18n";

/** Public page behind the certificate's QR code: status only — no address, photos or money. */
export default function Verify() {
  const { id = "" } = useParams();
  const { t, lang } = useI18n();
  const [data, setData] = useState<PublicStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api
      .verify(id)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError && err.status === 404 ? t("verifyNotFound") : err instanceof ApiError ? err.message : String(err)));
  }, [id, t]);
  useEffect(load, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <Skeleton lines={1} />;

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(lang === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short", year: "numeric" });
  const verified = data.status === "verified";
  const headline = verified
    ? t("verifyVerified", { date: fmtDate(data.verifiedAt ?? data.lastCheckAt ?? "") })
    : data.status === "needs_attention"
      ? t("verifyAttention")
      : data.lastCheckAt
        ? t("verifyNot")
        : t("verifyNever");

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-ink">{t("verifyTitle")}</h1>
      <section
        className={`rounded-(--radius-card) p-6 shadow-sm ${verified ? "bg-emerald-700 text-white" : data.status === "needs_attention" ? "bg-red-50 text-red-800 ring-1 ring-red-200" : "bg-panel text-ink ring-1 ring-line"}`}
        aria-live="polite"
      >
        <p className="mt-3 text-2xl font-bold leading-snug">{headline}</p>
        {data.lastCheckAt && data.lastVerdict && (
          <p className="mt-2 opacity-90">{t("verifyLastCheck", { date: fmtDate(data.lastCheckAt), verdict: t(`verdict_${data.lastVerdict}`) })}</p>
        )}
        {data.lastCheckAt && <p className="mt-1 opacity-90">{data.locationVerified ? t("verifyLocationOk") : t("verifyLocationNo")}</p>}
      </section>
      <dl className="card grid grid-cols-2 gap-3">
        <div>
          <dt className="text-sm text-ink-muted">{t("verifyStructure")}</dt>
          <dd className="font-semibold">{t(`structure_${data.structureType}`)}</dd>
        </div>
        <div>
          <dt className="text-sm text-ink-muted">{t("verifyWard")}</dt>
          <dd className="font-semibold">{data.ward ?? "—"}</dd>
        </div>
      </dl>
      <p className="text-sm text-ink-muted">{t("verifyDisclaimer")}</p>
    </div>
  );
}
