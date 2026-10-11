import type { PlanStatus } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { statusColor } from "../lib/tokens";

const STYLES: Record<PlanStatus, string> = {
  planned: "bg-panel-2 text-ink",
  applied: "bg-amber-100 text-amber-900",
  installed: "bg-water-100 text-glow",
  verified: "bg-emerald-700 text-white",
  needs_attention: "bg-red-100 text-red-800",
};

/** Status pill: colour + dot + label, never colour alone. */
export default function Badge({ status }: { status: PlanStatus }) {
  const { t } = useI18n();
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${STYLES[status]}`}>
      <span className="h-2 w-2 rounded-full" style={{ background: status === "verified" ? "#ffffff" : statusColor[status] }} aria-hidden="true" />
      {t(`status_${status}`)}
    </span>
  );
}
