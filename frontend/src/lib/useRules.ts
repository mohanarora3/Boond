import { useEffect, useState } from "react";
import { api, type Rules } from "./api";

let cached: Promise<Rules> | null = null;

/** Policy figures from the backend config (never hard-coded in the UI). null while loading or if unavailable. */
export function useRules(): Rules | null {
  const [rules, setRules] = useState<Rules | null>(null);
  useEffect(() => {
    let alive = true;
    cached ??= api.rules().catch((err) => {
      cached = null;
      throw err;
    });
    cached.then((r) => alive && setRules(r)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return rules;
}

export const pct = (fraction: number) => Math.round(fraction * 100);
