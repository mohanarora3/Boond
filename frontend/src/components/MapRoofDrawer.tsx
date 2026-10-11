import { useEffect, useRef, type ReactNode } from "react";
import L from "leaflet";
import { CircleMarker, MapContainer, TileLayer, useMap } from "react-leaflet";
import "@geoman-io/leaflet-geoman-free";
import { useI18n } from "../lib/i18n";
import { ink, roofStyle, water } from "../lib/tokens";

const DELHI: [number, number] = [28.6139, 77.209];
const ESRI_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const ESRI_ATTRIBUTION = "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community";

interface Props {
  center: [number, number] | null;
  polygon: GeoJSON.Polygon | null;
  onPolygonChange: (polygon: GeoJSON.Polygon | null) => void;
  /** Corners of the current outline can be dragged. */
  editing: boolean;
  /** Increment to start drawing a fresh outline. */
  drawRequest: number;
  drawing: boolean;
  onDrawingChange: (drawing: boolean) => void;
  /** Extra layers, e.g. building footprints. */
  children?: ReactNode;
}

function FlyTo({ center }: { center: [number, number] | null }) {
  const map = useMap();
  const last = useRef<string>("");
  useEffect(() => {
    const key = center ? center.join(",") : "";
    if (center && key !== last.current) {
      last.current = key;
      // Fly down from city level to the rooftop (instant when the user prefers less motion).
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) map.setView(center, 19);
      else map.flyTo(center, 19, { duration: 1.8 });
    }
  }, [center, map]);
  return null;
}

const sameGeometry = (a: GeoJSON.Polygon | null, b: GeoJSON.Polygon | null) => JSON.stringify(a) === JSON.stringify(b);

function RoofLayer({ polygon, onPolygonChange, editing, drawRequest, onDrawingChange }: Omit<Props, "center" | "children" | "drawing">) {
  const map = useMap();
  const layerRef = useRef<L.Polygon | null>(null);
  const emitted = useRef<GeoJSON.Polygon | null>(null);
  const onChange = useRef(onPolygonChange);
  onChange.current = onPolygonChange;

  const emit = (p: GeoJSON.Polygon | null) => {
    emitted.current = p;
    onChange.current(p);
  };

  const attach = (layer: L.Polygon) => {
    layerRef.current?.remove();
    layerRef.current = layer;
    layer.setStyle(roofStyle);
    layer.on("pm:edit", () => emit(layer.toGeoJSON().geometry as GeoJSON.Polygon));
  };

  // Geoman draw events, wired once.
  useEffect(() => {
    map.pm.setPathOptions(roofStyle);
    const onCreate = (e: { layer: L.Layer }) => {
      const layer = e.layer as L.Polygon;
      attach(layer);
      layer.pm.enable({ allowSelfIntersection: false });
      emit(layer.toGeoJSON().geometry as GeoJSON.Polygon);
    };
    const onDrawEnd = () => onDrawingChange(false);
    map.on("pm:create", onCreate);
    map.on("pm:drawend", onDrawEnd);
    return () => {
      map.off("pm:create", onCreate);
      map.off("pm:drawend", onDrawEnd);
      map.pm.disableDraw();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, onDrawingChange]);

  // Show a polygon set from outside (demo, footprint, coming back to this step).
  useEffect(() => {
    if (sameGeometry(polygon, emitted.current) && layerRef.current) return;
    emitted.current = polygon;
    if (!polygon) {
      layerRef.current?.remove();
      layerRef.current = null;
      return;
    }
    const layer = L.geoJSON(polygon).getLayers()[0] as L.Polygon;
    layer.addTo(map);
    attach(layer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polygon, map]);

  // Corner editing on/off.
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    if (editing) layer.pm.enable({ allowSelfIntersection: false });
    else layer.pm.disable();
  }, [editing, polygon]);

  // Start a fresh drawing when asked.
  useEffect(() => {
    if (drawRequest === 0) return;
    layerRef.current?.remove();
    layerRef.current = null;
    emit(null);
    map.pm.enableDraw("Polygon", {
      snappable: false,
      allowSelfIntersection: false,
      templineStyle: { color: water[400] },
      hintlineStyle: { color: water[400], dashArray: "5,5" },
      pathOptions: roofStyle,
    });
    onDrawingChange(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawRequest, map]);

  return null;
}

export default function MapRoofDrawer({ center, polygon, onPolygonChange, editing, drawRequest, drawing, onDrawingChange, children }: Props) {
  const { t } = useI18n();
  return (
    <div className="relative h-[52vh] min-h-72 overflow-hidden rounded-(--radius-card) border border-line shadow-[0_30px_60px_-30px_rgb(0_0_0_/_0.9)] ring-1 ring-line">
      <MapContainer center={center ?? DELHI} zoom={center ? 14 : 11} maxZoom={21} className="h-full w-full">
        <TileLayer url={ESRI_URL} attribution={ESRI_ATTRIBUTION} maxNativeZoom={19} maxZoom={21} />
        {children}
        {center && !polygon && !drawing && (
          <CircleMarker center={center} radius={8} pathOptions={{ color: ink.white, weight: 3, fillColor: water[600], fillOpacity: 1 }} />
        )}
        <FlyTo center={center} />
        <RoofLayer
          polygon={polygon}
          onPolygonChange={onPolygonChange}
          editing={editing}
          drawRequest={drawRequest}
          onDrawingChange={onDrawingChange}
        />
      </MapContainer>
      <div className="map-vignette absolute inset-0 z-[450]" aria-hidden="true" />
      {drawing && (
        <div className="glass pointer-events-none absolute inset-x-3 top-3 z-[1000] px-4 py-3 text-sm text-ink">
          {t("drawHint")}
        </div>
      )}
    </div>
  );
}
