import { useEffect, useState } from "react";
import { api, fetchBuildings, type BuildingFeature, type WardDetail } from "./api";
import { pointInGeometry, wardsAround } from "./geo";

/** If the point is inside a demo ward, load that ward and its building footprints. Silent (null) otherwise. */
export function useWardBuildings(lon: number | null, lat: number | null) {
  const [ward, setWard] = useState<WardDetail | null>(null);
  const [buildings, setBuildings] = useState<BuildingFeature[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setWard(null);
    setBuildings(null);
    if (lon === null || lat === null) return;
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        for (const candidate of wardsAround(lon, lat, await api.wards())) {
          const detail = await api.ward(candidate.slug);
          if (detail.boundary && !pointInGeometry(lon, lat, detail.boundary)) continue;
          const features = await fetchBuildings(detail.buildingsUrl);
          if (alive) {
            setWard(detail);
            setBuildings(features);
          }
          return;
        }
      } catch {
        /* footprints are an enhancement; drawing still works */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [lon, lat]);

  return { ward, buildings, loading };
}
