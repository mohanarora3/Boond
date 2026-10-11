// Design tokens needed in JavaScript (Leaflet styles, SVG). Mirrors the @theme block in index.css.
// Components must use these names, never one-off hex values.
import type { PlanStatus } from "./api";

export const water = {
  50: "#eef8fb",
  100: "#d9eff5",
  200: "#b4dfeb",
  300: "#7cc5da",
  400: "#3ba7c9",
  500: "#2390b3",
  600: "#1a7a99",
  700: "#15637d",
  800: "#124f63",
  900: "#0f3d4c",
} as const;

export const soil = "#f7efe2";

/** The warm paper theme (mirrors --color-deep, --color-cta etc. in index.css). */
export const night = {
  deep: "#fcf8f0",
  panel: "#ffffff",
  line: "#311f18",
  glow: "#d02c2a",
  cta: "#d02c2a",
  ink: "#311f18",
  muted: "#7f6d65",
} as const;

export const ink = { 900: "#0f172a", 600: "#475569", 400: "#94a3b8", 200: "#e2e8f0", white: "#ffffff" } as const;

/** One colour per plan status, validated for colour-blind separation. Always paired with an icon and a label. */
export const statusColor: Record<PlanStatus, string> = {
  planned: "#766b8b",
  applied: "#326893",
  installed: "#c47a12",
  verified: "#1f8d54",
  needs_attention: "#d02c2a",
};

/** Kept for older screens; the interface no longer uses pictographs. */
export const statusIcon: Record<PlanStatus, string> = { planned: "", applied: "", installed: "", verified: "", needs_attention: "" };

export const roofStyle = { color: water[400], weight: 3, fillColor: water[400], fillOpacity: 0.35 } as const;

/** Sequential scale (one hue, light → dark) for litres-per-year buckets on the ward map. */
export const litresScale = [water[200], water[400], water[600], water[800], water[900]] as const;
