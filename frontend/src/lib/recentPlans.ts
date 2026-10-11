// Plans this browser has opened, newest first, so the menu can offer them on any page.
// Per-browser convenience only: storage can be unavailable, so every access is guarded.

export interface RecentPlan {
  planId: string;
  address: string;
  at: string;
}

const KEY = "boond.recentPlans";
const MAX = 5;

export function recentPlans(): RecentPlan[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as RecentPlan[]) : [];
    return Array.isArray(list) ? list.filter((p) => p && typeof p.planId === "string") : [];
  } catch {
    return [];
  }
}

export function rememberPlan(planId: string, address: string): void {
  try {
    const list = [{ planId, address, at: new Date().toISOString() }, ...recentPlans().filter((p) => p.planId !== planId)].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable: the menu simply shows no recent plans */
  }
}

/** Fired after the menu changes a plan (e.g. files its application) so an open plan page reloads. */
export const PLAN_CHANGED = "boond:plan-changed";
