import type { ReactNode } from "react";
import { useI18n } from "../lib/i18n";

/** Plain-language explanation tucked under a card; jargon lives only in here. */
export default function HowCalculated({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <details className="mt-4 rounded-xl bg-panel-2 px-4 py-2 text-ink-soft">
      <summary className="min-h-10 cursor-pointer py-2 font-semibold text-glow">{t("howCalc")}</summary>
      <div className="space-y-2 pb-2 text-sm leading-relaxed">{children}</div>
    </details>
  );
}
