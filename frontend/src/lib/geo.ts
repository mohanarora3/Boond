import type { BuildingFeature, WardSummary2 } from "./api";

type Ring = GeoJSON.Position[];
const M_PER_DEG_LAT = 111_320;

function inRing([x, y]: [number, number], ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function polygons(g: GeoJSON.Polygon | GeoJSON.MultiPolygon): Ring[][] {
  return g.type === "Polygon" ? [g.coordinates] : g.coordinates;
}

export function pointInGeometry(lon: number, lat: number, g: GeoJSON.Polygon | GeoJSON.MultiPolygon): boolean {
  return polygons(g).some((poly) => inRing([lon, lat], poly[0]) && !poly.slice(1).some((hole) => inRing([lon, lat], hole)));
}

/** Metres from a point to the nearest edge of a geometry (0 if inside). Flat-earth maths: fine at building scale. */
export function distanceToGeometryM(lon: number, lat: number, g: GeoJSON.Polygon | GeoJSON.MultiPolygon): number {
  if (pointInGeometry(lon, lat, g)) return 0;
  const kx = M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  let best = Infinity;
  for (const poly of polygons(g)) {
    for (const ring of poly) {
      for (let i = 0; i < ring.length - 1; i++) {
        const ax = (ring[i][0] - lon) * kx, ay = (ring[i][1] - lat) * M_PER_DEG_LAT;
        const bx = (ring[i + 1][0] - lon) * kx, by = (ring[i + 1][1] - lat) * M_PER_DEG_LAT;
        const dx = bx - ax, dy = by - ay;
        const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
        best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
      }
    }
  }
  return best;
}

/** The building containing the point, else the nearest one within maxM, else null. */
export function findBuilding(lon: number, lat: number, features: BuildingFeature[], maxM: number): BuildingFeature | null {
  let best: BuildingFeature | null = null;
  let bestD = maxM;
  const kx = M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  for (const f of features) {
    const [cx, cy] = f.properties.centroid;
    if (Math.abs(cx - lon) * kx > 300 || Math.abs(cy - lat) * M_PER_DEG_LAT > 300) continue; // cheap pre-filter
    const d = distanceToGeometryM(lon, lat, f.geometry);
    if (d === 0) return f;
    if (d <= bestD) {
      best = f;
      bestD = d;
    }
  }
  return best;
}

/** Demo wards whose bounding box contains the point (the caller confirms with the real boundary). */
export function wardsAround(lon: number, lat: number, wards: WardSummary2[]): WardSummary2[] {
  return wards.filter(({ bbox: [w, s, e, n] }) => lon >= w && lon <= e && lat >= s && lat <= n);
}
