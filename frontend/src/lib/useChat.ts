import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type ChatMessage, type PlanStatus } from "./api";
import type { Lang } from "./i18n";

/** Chat state for one plan. A failed question is removed and kept so "Try again" resends it. */
export function useChat(planId: string, lang: Lang, onPlanChanged?: (status: PlanStatus) => void) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const failed = useRef<string | null>(null);
  const onChanged = useRef(onPlanChanged);
  onChanged.current = onPlanChanged;

  useEffect(() => {
    api
      .getChat(planId)
      .then((r) => setMessages(r.messages))
      .catch(() => undefined); // history is a nice-to-have
  }, [planId]);

  const send = useCallback(
    async (text: string) => {
      const at = new Date().toISOString();
      setMessages((m) => [...m, { role: "user", text, at }]);
      setPending(true);
      setError(null);
      failed.current = null;
      try {
        const r = await api.chat(planId, text, lang);
        setMessages((m) => [...m, { role: "assistant", text: r.reply, at: new Date().toISOString() }]);
        onChanged.current?.(r.status);
      } catch (err) {
        setMessages((m) => m.filter((x) => x.at !== at));
        failed.current = text;
        setError(err instanceof ApiError ? err.message : String(err));
      } finally {
        setPending(false);
      }
    },
    [planId, lang],
  );

  const retry = useCallback(() => {
    if (failed.current) send(failed.current);
  }, [send]);

  return { messages, pending, error, send, retry };
}
