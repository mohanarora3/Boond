import { useEffect, useRef } from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";
import type { BuildingFeature } from "../lib/api";
import { ink, litresScale, water } from "../lib/tokens";

interface Props {
  features: BuildingFeature[];
  buckets: number[];
  polygonsMinZoom: number;
  selectedId?: string | null;
  onSelect?: (f: BuildingFeature) => void;
  /** Optional per-building fill override (e.g. simulation states). */
  fillFor?: (f: BuildingFeature) => string | null;
}

const bucketIndex = (litres: number, buckets: number[]) => buckets.filter((edge) => litres >= edge).length;
const toLatLngs = (g: BuildingFeature["geometry"]) =>
  g.type === "Polygon"
    ? g.coordinates.map((ring) => ring.map(([x, y]) => [y, x] as [number, number]))
    : g.coordinates.map((poly) => poly.map((ring) => ring.map(([x, y]) => [y, x] as [number, number])));

/**
 * Draws thousands of buildings on one canvas: centroid dots when zoomed out, real outlines (only those in view)
 * from `polygonsMinZoom`. Colour = litres/year bucket; dark outline = required by law.
 */
export default function BuildingsLayer({ features, buckets, polygonsMinZoom, selectedId, onSelect, fillFor }: Props) {
  const map = useMap();
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const renderer = L.canvas({ padding: 0.3, tolerance: 6 });
    const group = L.layerGroup().addTo(map);

    const draw = () => {
      group.clearLayers();
      const zoom = map.getZoom();
      const view = map.getBounds().pad(0.3);
      for (const f of features) {
        const p = f.properties;
        const [lon, lat] = p.centroid;
        const selected = p.buildingId === selectedId;
        const fill = fillFor?.(f) ?? litresScale[bucketIndex(p.litresPerYear, buckets)];
        let layer: L.Path;
        if (zoom >= polygonsMinZoom) {
          if (!view.contains([lat, lon])) continue;
          layer = L.polygon(toLatLngs(f.geometry), {
            renderer,
            fillColor: selected ? water[300] : fill,
            fillOpacity: 0.85,
            color: selected ? ink[900] : p.mandatory === "required" ? ink[900] : fill,
            weight: selected ? 3 : p.mandatory === "required" ? 1.5 : 0.5,
          });
        } else {
          layer = L.circleMarker([lat, lon], {
            renderer,
            radius: selected ? 6 : zoom >= 14 ? 3 : 2,
            stroke: selected,
            color: ink[900],
            weight: 2,
            fillColor: fill,
            fillOpacity: 0.9,
          });
        }
        if (onSelectRef.current) layer.on("click", () => onSelectRef.current?.(f));
        group.addLayer(layer);
      }
    };

    draw();
    map.on("moveend", draw);
    return () => {
      map.off("moveend", draw);
      group.remove();
    };
  }, [map, features, buckets, polygonsMinZoom, selectedId, fillFor]);

  return null;
}
