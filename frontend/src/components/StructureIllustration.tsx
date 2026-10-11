import type { Structure } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { ink, soil, water } from "../lib/tokens";

/** Simple labelled drawing of the recommended structure (cross-section for pits/trenches, side view for tanks). */
export default function StructureIllustration({ structure }: { structure: Structure }) {
  const { t } = useI18n();
  const d = structure.dimensions;
  const label = { fontSize: 13, fill: ink[600], fontWeight: 600 } as const;

  if (structure.type === "storage_tank") {
    return (
      <svg viewBox="0 0 300 170" className="h-auto w-full" role="img" aria-label={t("structure_storage_tank")}>
        <ellipse cx="150" cy="40" rx="70" ry="16" fill={water[100]} stroke={water[700]} strokeWidth="2" />
        <path d="M80 40 V130 A70 16 0 0 0 220 130 V40" fill={water[50]} stroke={water[700]} strokeWidth="2" />
        <path d="M80 90 V130 A70 16 0 0 0 220 130 V90 A70 16 0 0 1 80 90 Z" fill={water[300]} opacity="0.8" />
        <path d="M150 8 V24" stroke={ink[600]} strokeWidth="3" />
        <text x="150" y="162" textAnchor="middle" style={label}>
          {t("litresShort", { n: (d.litresEach ?? 0).toLocaleString("en-IN") })}
          {structure.count > 1 ? ` × ${structure.count}` : ""}
        </text>
      </svg>
    );
  }

  // Pit or trench: ground line, hole with gravel/sand layers, dimension arrows.
  const isTrench = structure.type === "recharge_trench";
  const w = isTrench ? 200 : 110;
  const x0 = 150 - w / 2;
  return (
    <svg viewBox="0 0 300 190" className="h-auto w-full" role="img" aria-label={t(`structure_${structure.type}`)}>
      <rect x="0" y="40" width="300" height="150" fill={soil} />
      <line x1="0" y1="40" x2="300" y2="40" stroke={ink[600]} strokeWidth="2" />
      <rect x={x0} y="40" width={w} height="120" fill={water[50]} stroke={water[700]} strokeWidth="2" />
      <rect x={x0} y="120" width={w} height="40" fill={ink[400]} opacity="0.6" />
      <rect x={x0} y="80" width={w} height="40" fill={ink[200]} />
      <rect x={x0} y="40" width={w} height="40" fill={water[200]} opacity="0.7" />
      <path d="M150 6 V36" stroke={water[600]} strokeWidth="4" markerEnd="url(#arrow)" />
      <defs>
        <marker id="arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
          <path d="M0 0 L8 4 L0 8 z" fill={water[600]} />
        </marker>
      </defs>
      {/* width */}
      <line x1={x0} y1="172" x2={x0 + w} y2="172" stroke={ink[600]} strokeWidth="1.5" />
      <text x="150" y="187" textAnchor="middle" style={label}>
        {isTrench ? `${d.lengthM} m ${t("dimLength")}` : `${d.lengthM} × ${d.widthM} m`}
      </text>
      {/* depth */}
      <line x1={x0 + w + 12} y1="40" x2={x0 + w + 12} y2="160" stroke={ink[600]} strokeWidth="1.5" />
      <text x={x0 + w + 18} y="104" style={label}>
        {d.depthM} m {t("dimDepth")}
      </text>
      {structure.count > 1 && (
        <text x="10" y="30" style={label}>
          × {structure.count}
        </text>
      )}
    </svg>
  );
}
