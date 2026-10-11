import type { Plan } from "./api";
import type { StringKey } from "./i18n";

/** Chat suggestion chips that fit where the plan is. */
export function suggestionKeys(plan: Pick<Plan, "status" | "openSpace">): StringKey[] {
  if (["installed", "verified", "needs_attention"].includes(plan.status)) return ["sug_clean", "sug_whyCheck", "sug_whoSubsidy"];
  const keys: StringKey[] = [plan.openSpace ? "sug_noOpen" : "suggestion1", "sug_whoSubsidy", "sug_required"];
  if (plan.status === "planned") keys.push("sug_application");
  return keys;
}
