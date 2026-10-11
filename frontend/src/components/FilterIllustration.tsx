import { ink, statusColor, water } from "../lib/tokens";

/** Drawn examples for the photo guide: a close, clear filter vs a far-away, dark one. */
export default function FilterIllustration({ variant, label }: { variant: "good" | "bad"; label: string }) {
  const good = variant === "good";
  const mesh = Array.from({ length: 7 }, (_, i) => 20 + i * 10);
  return (
    <figure className="space-y-1">
      <svg viewBox="0 0 100 100" className="aspect-square w-full rounded-xl" role="img" aria-label={label}>
        <rect width="100" height="100" fill={good ? water[50] : ink[900]} />
        {good ? (
          <g>
            <circle cx="50" cy="50" r="38" fill={ink.white} stroke={ink[600]} strokeWidth="3" />
            {mesh.map((v) => (
              <g key={v} stroke={ink[400]} strokeWidth="1">
                <line x1={v} y1="16" x2={v} y2="84" />
                <line x1="16" y1={v} x2="84" y2={v} />
              </g>
            ))}
          </g>
        ) : (
          <g opacity="0.55">
            <circle cx="70" cy="70" r="9" fill={ink[600]} stroke={ink[400]} strokeWidth="1.5" />
            <rect x="10" y="20" width="30" height="40" fill={ink[600]} />
          </g>
        )}
        <circle cx="86" cy="14" r="9" fill={good ? statusColor.verified : statusColor.needs_attention} />
        <text x="86" y="18" textAnchor="middle" fontSize="12" fontWeight="700" fill={ink.white}>
          {good ? "✓" : "✕"}
        </text>
      </svg>
      <figcaption className="text-center text-sm text-ink-soft">{label}</figcaption>
    </figure>
  );
}
