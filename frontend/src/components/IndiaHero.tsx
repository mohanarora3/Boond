import { useId } from "react";
import outline from "../assets/india_outline.json";
import { useI18n } from "../lib/i18n";
import { night } from "../lib/tokens";

/*
 * Glowing outline of India with Delhi marked by a water drop.
 * The outline is Natural Earth's India point-of-view boundary (see assets/india_outline.json → properties.source),
 * which shows India's official boundary including all of Jammu & Kashmir and Ladakh.
 * Outline and Delhi are projected with the same Mercator maths, so the drop always sits on Delhi.
 */

const W = 800;
const H = 900;
const PAD = 24;
const DELHI = [77.209, 28.6139] as const;

type Ring = number[][];
const polygons = (outline.geometry.coordinates as unknown as Ring[][]).map((poly) => poly[0]);

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const xs = polygons.flat().map((p) => p[0]);
const ys = polygons.flat().map((p) => mercY(p[1]));
const minX = Math.min(...xs), maxX = Math.max(...xs);
const minY = Math.min(...ys), maxY = Math.max(...ys);
const k = Math.min((W - 2 * PAD) / (((maxX - minX) * Math.PI) / 180), (H - 2 * PAD) / (maxY - minY));
const offX = (W - (((maxX - minX) * Math.PI) / 180) * k) / 2;
const offY = (H - (maxY - minY) * k) / 2;

function project(lon: number, lat: number): [number, number] {
  return [offX + (((lon - minX) * Math.PI) / 180) * k, offY + (maxY - mercY(lat)) * k];
}

const PATH = polygons
  .map((ring) => ring.map(([lon, lat], i) => `${i ? "L" : "M"}${project(lon, lat).map((v) => v.toFixed(1)).join(",")}`).join("") + "Z")
  .join("");

export const DELHI_POINT = project(DELHI[0], DELHI[1]);
/** Delhi's position as a percentage of the drawing, for CSS transform-origin. */
export const DELHI_ORIGIN = `${((DELHI_POINT[0] / W) * 100).toFixed(1)}% ${((DELHI_POINT[1] / H) * 100).toFixed(1)}%`;

interface Props {
  state?: "idle" | "searching" | "zooming";
  className?: string;
}

export default function IndiaHero({ state = "idle", className = "" }: Props) {
  const { t } = useI18n();
  const id = useId().replace(/:/g, "");
  const [dx, dy] = DELHI_POINT;
  return (
    <div className={`${className} ${state === "zooming" ? "hero-zoom" : ""}`} style={{ transformOrigin: DELHI_ORIGIN }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full overflow-visible" role="img" aria-labelledby={`${id}-title`}>
        <title id={`${id}-title`}>{t("indiaMapAlt")}</title>
        <defs>
          <filter id={`${id}-glow`} x="-10%" y="-10%" width="120%" height="120%">
            <feGaussianBlur stdDeviation="7" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <pattern id={`${id}-dots`} width="14" height="14" patternUnits="userSpaceOnUse">
            <circle cx="7" cy="7" r="1.6" fill={night.line} opacity="0.35" />
          </pattern>
          <radialGradient id={`${id}-shine`} cx={dx / W} cy={dy / H} r="0.6">
            <stop offset="0" stopColor={night.glow} stopOpacity="0.28" />
            <stop offset="1" stopColor={night.glow} stopOpacity="0" />
          </radialGradient>
          <clipPath id={`${id}-clip`}>
            <path d={PATH} />
          </clipPath>
        </defs>

        <g aria-hidden="true">
          {/* Dotted land with a soft light around Delhi. */}
          <g className="india-fill" clipPath={`url(#${id}-clip)`}>
            <rect width={W} height={H} fill={`url(#${id}-dots)`} />
            <rect width={W} height={H} fill={`url(#${id}-shine)`} />
          </g>
          <path
            d={PATH}
            pathLength={1}
            className="india-outline"
            fill="none"
            stroke={night.line}
            strokeWidth="2.2"
            strokeLinejoin="round"
            filter={`url(#${id}-glow)`}
          />

          {/* Delhi: ripples + a water drop. */}
          <circle cx={dx} cy={dy} r="10" fill="none" stroke={night.glow} strokeWidth="2" className={`drop-ripple ${state === "searching" ? "fast" : ""}`} />
          <circle
            cx={dx}
            cy={dy}
            r="10"
            fill="none"
            stroke={night.glow}
            strokeWidth="2"
            className={`drop-ripple ${state === "searching" ? "fast" : ""}`}
            style={{ animationDelay: state === "searching" ? "0.5s" : "1.2s" }}
          />
          <g className="drop-bob">
            <path
              d={`M${dx},${dy - 34} C${dx},${dy - 34} ${dx - 15},${dy - 13} ${dx - 15},${dy - 3} a15,15 0 0 0 30,0 C${dx + 15},${dy - 13} ${dx},${dy - 34} ${dx},${dy - 34}z`}
              fill={night.glow}
              stroke={night.deep}
              strokeWidth="2.5"
            />
            <path d={`M${dx - 7},${dy - 2} a7,7 0 0 0 7,7`} stroke={night.deep} strokeWidth="2.5" fill="none" strokeLinecap="round" />
          </g>
          <text x={dx + 26} y={dy + 6} fill={night.ink} fontSize="26" fontWeight="700" fontFamily="Syne, 'Noto Sans Devanagari', sans-serif">
            {t("delhiLabel")}
          </text>
        </g>
      </svg>
    </div>
  );
}
