import { useCallback, useEffect, useState } from "react";
import type { GeocodeResult, RoofType, SafetyAnswer } from "./api";

/** Everything the user has entered in the planning flow, kept in one place so Back never loses answers. */
export interface PlanDraft {
  place: GeocodeResult | null;
  polygon: GeoJSON.Polygon | null;
  roofArea: string;
  buildingId: string | null;
  plotArea: string;
  residents: string;
  openSpace: boolean | null;
  monthlyBill: string;
  tankersPerYear: string;
  roofType: RoofType;
  contaminationSourceNearby: SafetyAnswer | null;
  waterloggingArea: SafetyAnswer | null;
  pitNearFoundation: SafetyAnswer | null;
  demo?: boolean;
}

export const SAFETY_FIELDS = ["contaminationSourceNearby", "waterloggingArea", "pitNearFoundation"] as const;

export const EMPTY_DRAFT: PlanDraft = {
  place: null,
  polygon: null,
  roofArea: "",
  buildingId: null,
  plotArea: "",
  residents: "4",
  openSpace: null,
  monthlyBill: "",
  tankersPerYear: "",
  roofType: "rcc",
  contaminationSourceNearby: null,
  waterloggingArea: null,
  pitNearFoundation: null,
};

const KEY = "boond.draft";

function load(): PlanDraft {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) return { ...EMPTY_DRAFT, ...(JSON.parse(raw) as Partial<PlanDraft>) };
  } catch {
    /* storage unavailable or corrupt */
  }
  return EMPTY_DRAFT;
}

/** Write a draft synchronously (before navigating to /start from another page). */
export function saveDraft(draft: PlanDraft): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    /* storage unavailable */
  }
}

/** A building footprint as a single Polygon (the largest part of a MultiPolygon). */
export function footprintPolygon(g: GeoJSON.Polygon | GeoJSON.MultiPolygon): GeoJSON.Polygon {
  if (g.type === "Polygon") return g;
  const ringSize = (poly: GeoJSON.Position[][]) => poly[0].length;
  const largest = [...g.coordinates].sort((a, b) => ringSize(b) - ringSize(a))[0];
  return { type: "Polygon", coordinates: largest };
}

export function usePlanDraft() {
  const [draft, setDraft] = useState<PlanDraft>(load);

  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(draft));
    } catch {
      /* storage unavailable */
    }
  }, [draft]);

  const update = useCallback((patch: Partial<PlanDraft>) => setDraft((d) => ({ ...d, ...patch })), []);
  const replace = useCallback((next: PlanDraft) => setDraft(next), []);
  const reset = useCallback(() => setDraft(EMPTY_DRAFT), []);
  return { draft, update, replace, reset };
}

export const toNumber = (s: string) => (s.trim() === "" ? NaN : Number(s));
