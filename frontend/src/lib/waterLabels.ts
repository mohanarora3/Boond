import type { Destination } from "./api";
import { formatNum } from "./area";
import type { StringKey } from "./i18n";

type T = (k: StringKey, v?: Record<string, string | number>) => string;

const KINDS = ["pond", "lake", "reservoir", "basin", "lagoon", "oxbow", "water", "drain", "canal", "ditch", "stream", "river"];

export function kindLabel(t: T, kind: string | null | undefined): string {
  return t((KINDS.includes(kind ?? "") ? `kind_${kind}` : "kind_water") as StringKey);
}

export function distanceLabel(t: T, m: number | null | undefined): string {
  if (m === null || m === undefined) return "";
  return m < 1000 ? t("metresAway", { n: formatNum(Math.round(m / 10) * 10) }) : t("kmAway", { n: formatNum(Math.round(m / 100) / 10) });
}

/** "Hauz Rani Lake, 670 m away" — what the homeowner and the officer read for a chosen destination. */
export function destinationLabel(t: T, d: Destination): string {
  if (d.type === "water_body" || d.type === "storm_drain") {
    const name = d.name || kindLabel(t, d.kind);
    const dist = distanceLabel(t, d.distanceM);
    return dist ? `${name}, ${dist}` : name;
  }
  return t(`dest_${d.type}` as StringKey);
}
