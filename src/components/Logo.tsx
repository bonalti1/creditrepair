import { BRAND } from "@/lib/brand";

// Credalti brand marks, drawn in code so they stay crisp at any size.
// The wordmark is "Cred" in navy (white on dark) and "alti" in the gold
// gradient, beside a yellow-to-orange gauge with a needle. The text comes from
// src/lib/brand.ts. When the final logo files arrive (SVG with transparent
// background), swap them in here — every screen uses these two components.

const GAUGE = ["#fde539", "#fdcb1f", "#fdb203", "#fb9d07", "#f9890b"];
const NAVY = "#0e2b6b";

function point(cx: number, cy: number, r: number, deg: number): string {
  const rad = (deg * Math.PI) / 180;
  return `${(cx + r * Math.cos(rad)).toFixed(2)} ${(cy - r * Math.sin(rad)).toFixed(2)}`;
}

function sector(cx: number, cy: number, outer: number, inner: number, a0: number, a1: number): string {
  return `M${point(cx, cy, outer, a0)}A${outer} ${outer} 0 0 1 ${point(cx, cy, outer, a1)}L${point(cx, cy, inner, a1)}A${inner} ${inner} 0 0 0 ${point(cx, cy, inner, a0)}Z`;
}

export function GaugeMark({ height = 24, needle = NAVY }: { height?: number; needle?: string }) {
  const cx = 32;
  const cy = 34;
  const gap = 3;
  const span = (180 - gap * (GAUGE.length - 1)) / GAUGE.length;

  return (
    <svg
      height={height}
      width={(height * 64) / 40}
      viewBox="0 0 64 40"
      aria-hidden="true"
      className="shrink-0"
    >
      {GAUGE.map((color, i) => {
        const start = 180 - i * (span + gap);
        return <path key={color} d={sector(cx, cy, 30, 18.5, start, start - span)} fill={color} />;
      })}
      <path d={`M${cx} ${cy} 51 10`} stroke={needle} strokeWidth="3.6" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="5" fill={needle} />
    </svg>
  );
}

export default function Logo({
  size = 22,
  tone = "light",
  withMark = true,
}: {
  /** Wordmark font size in px; the gauge scales with it. */
  size?: number;
  /** "dark" for navy backgrounds: white "Cred" and a white needle. */
  tone?: "light" | "dark";
  withMark?: boolean;
}) {
  const dark = tone === "dark";
  return (
    <span
      className="inline-flex items-center gap-[0.28em] font-display font-black italic leading-none tracking-tight"
      style={{ fontSize: size }}
      role="img"
      aria-label={BRAND.name}
    >
      {withMark && <GaugeMark height={size * 1.05} needle={dark ? "#ffffff" : NAVY} />}
      <span aria-hidden="true">
        <span className={dark ? "text-white" : "text-blue-700"}>{BRAND.wordmark[0]}</span>
        <span className="bg-gradient-to-r from-amber-400 to-amber-600 bg-clip-text pr-[0.08em] text-transparent">
          {BRAND.wordmark[1]}
        </span>
      </span>
    </span>
  );
}
