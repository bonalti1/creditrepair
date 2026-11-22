import { BRAND, LOGO_CLEAR_SPACE } from "@/lib/brand";

// The official ✓Credalti logo: the brand kit's vector files, shown as they
// are (public/brand/logo/, byte for byte; paths in src/lib/brand.ts). An SVG
// in an <img> stays sharp at any size and on any screen. Never recolour,
// outline, stretch or rearrange it, never put it on the gold accent, and
// never set "Credalti" in a font to imitate it: there is no wordmark without
// the check.
//
// Clear space: the kit asks for at least the height of the "C" around the
// logo. `clearSpace` adds it as margin, for places where the surroundings do
// not already leave it (headers usually do, with their padding).

export default function Logo({
  size = 28,
  tone = "light",
  variant = "full",
  clearSpace = false,
  className = "",
  priority = false,
}: {
  /** Height of the logo in px; the width follows the file's aspect ratio. */
  size?: number;
  /** "light" backgrounds get the navy wordmark; "dark" (navy) backgrounds the white one. */
  tone?: "light" | "dark";
  /** "full" is the check and the wordmark; "check" is the gold check alone, the same on any tone. */
  variant?: "full" | "check";
  /** Add the kit's minimum clear space around the logo as margin. */
  clearSpace?: boolean;
  className?: string;
  /** Load it eagerly: for a logo at the top of the first screen. */
  priority?: boolean;
}) {
  const file = variant === "check" ? BRAND.logo.check : tone === "dark" ? BRAND.logo.onDark : BRAND.logo.onLight;
  const width = Math.round((size * file.width) / file.height);
  return (
    // eslint-disable-next-line @next/next/no-img-element -- an SVG file shown as is; next/image adds nothing here.
    <img
      src={file.src}
      alt={BRAND.name}
      width={width}
      height={size}
      decoding="async"
      fetchPriority={priority ? "high" : undefined}
      className={`block shrink-0 select-none ${className}`}
      style={{ width, height: size, margin: clearSpace ? Math.ceil(size * LOGO_CLEAR_SPACE) : undefined }}
      draggable={false}
    />
  );
}
