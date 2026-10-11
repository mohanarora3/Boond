import turfArea from "@turf/area";

/** Area of a GeoJSON polygon in square metres, rounded to 1 decimal. */
export function polygonAreaM2(polygon: GeoJSON.Polygon): number {
  return Math.round(turfArea(polygon) * 10) / 10;
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });

export const formatInr = (n: number) => inr.format(n);
export const formatNum = (n: number) => num.format(n);

/** Big litre figures the Indian way: { key: "crore" | "lakh" | "litresPlain", n }. */
export function bigLitres(litres: number): { key: "crore" | "lakh" | "litresPlain"; n: string } {
  if (litres >= 1e7) return { key: "crore", n: formatNum(Math.round(litres / 1e6) / 10) };
  if (litres >= 1e5) return { key: "lakh", n: formatNum(Math.round(litres / 1e4) / 10) };
  return { key: "litresPlain", n: formatNum(Math.round(litres)) };
}
