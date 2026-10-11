import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import ChatBox from "../components/ChatBox";
import { api, type Plan } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { suggestionKeys } from "../lib/suggestions";
import { useChat } from "../lib/useChat";

export default function Chat() {
  const { id = "" } = useParams();
  const { t, lang, setLang } = useI18n();
  const chat = useChat(id, lang);
  const [plan, setPlan] = useState<Pick<Plan, "status" | "openSpace"> | null>(null);

  useEffect(() => {
    api.getPlan(id).then(setPlan).catch(() => undefined);
  }, [id]);

  return (
    <div className="space-y-4">
      <Link to={`/plan/${id}`} className="inline-flex min-h-11 items-center font-medium text-glow">
        ← {t("back")}
      </Link>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">{t("chatTitle")}</h1>
          <p className="mt-1 text-ink-muted">{t("chatIntro")}</p>
        </div>
        <div className="flex shrink-0 overflow-hidden rounded-full border border-line-strong" role="group" aria-label={t("langToggle")}>
          {(["en", "hi"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              aria-pressed={lang === l}
              className={`min-h-11 px-4 font-semibold ${lang === l ? "bg-ink text-deep" : "bg-panel text-ink-soft"}`}
            >
              {t(l === "en" ? "langEn" : "langHi")}
            </button>
          ))}
        </div>
      </div>
      <ChatBox {...chat} suggestions={(plan ? suggestionKeys(plan) : []).map((k) => t(k))} onSend={chat.send} onRetry={chat.retry} />
    </div>
  );
}
