import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ChatMessage } from "../lib/api";
import { useI18n } from "../lib/i18n";

const URL_RE = /(https?:\/\/[^\s)]+)/g;
const IS_URL = /^https?:\/\//;

function MessageText({ text }: { text: string }) {
  // Render links (e.g. the application PDF) as tappable anchors; everything else as plain text.
  return (
    <>
      {text.split(URL_RE).map((part, i) =>
        IS_URL.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noreferrer" className="break-all font-semibold underline">
            {part.length > 40 ? "PDF ↗" : part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

interface Props {
  messages: ChatMessage[];
  pending: boolean;
  error: string | null;
  suggestions: string[];
  onSend: (text: string) => void;
  onRetry: () => void;
}

export default function ChatBox({ messages, pending, error, suggestions, onSend, onRetry }: Props) {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, pending, error]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || pending) return;
    onSend(text);
    setDraft("");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-3" aria-live="polite">
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onSend(s)}
                disabled={pending}
                className="min-h-11 rounded-full border border-water-200 bg-water-50 px-4 text-left text-glow hover:bg-water-100"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={`${m.at}-${i}`} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-3xl px-4 py-3 text-base leading-relaxed ${
                m.role === "user" ? "rounded-br-md bg-ink text-deep" : "rounded-bl-md border border-line bg-panel text-ink"
              }`}
            >
              <MessageText text={m.text} />
            </div>
          </div>
        ))}
        {pending && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1 rounded-3xl rounded-bl-md border border-line bg-panel px-4 py-3 text-ink-muted">
              <span className="sr-only">{t("thinking")}</span>
              <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" aria-hidden="true" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:150ms]" aria-hidden="true" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:300ms]" aria-hidden="true" />
            </div>
          </div>
        )}
        {error && (
          <div className="space-y-2 rounded-xl bg-amber-50 px-4 py-3 text-amber-900" role="alert">
            <p>{error}</p>
            <button type="button" className="btn-secondary min-h-11" onClick={onRetry} disabled={pending}>
              ↻ {t("retry")}
            </button>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <form onSubmit={submit} className="sticky bottom-0 -mx-4 flex gap-2 border-t border-line bg-panel/95 px-4 py-3 backdrop-blur">
        <input
          className="field mt-0 flex-1"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("chatPlaceholder")}
          aria-label={t("chatPlaceholder")}
          maxLength={1000}
        />
        <button className="btn-primary" disabled={pending || !draft.trim()}>
          {t("send")}
        </button>
      </form>
    </div>
  );
}
