import type { PlanDraft } from "./usePlanDraft";

/** The Lodhi Road example, pre-filled for "Try a demo" and ?demo=1: answers are filled in, the roof comes from the footprint. */
export const DEMO_DRAFT: PlanDraft = {
  place: { label: "Lodhi Road, Kidwai Nagar, New Delhi, Delhi 110003", lat: 28.5897358, lon: 77.2163336, ward: "Kidwai Nagar" },
  // No outline: the roof step finds the real footprint and asks "Is this your building?" (M11).
  polygon: null,
  roofArea: "",
  buildingId: null,
  plotArea: "150",
  residents: "4",
  openSpace: true,
  monthlyBill: "900",
  tankersPerYear: "",
  roofType: "rcc",
  contaminationSourceNearby: "no",
  waterloggingArea: "no",
  pitNearFoundation: "no",
  demo: true,
};
