import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { BRAND } from "@/lib/brand";

// The image a link to the site shows when it is shared (Open Graph; Twitter
// falls back to it). Drawn from the brand: the official logo file as it is
// (white version on navy, never redrawn or recoloured), the brand navy and
// gold, and the site's one-line description. No score, no character art (the
// art is WebP, which the image renderer does not read; it is never re-encoded).
// Generated once at build time.

export const alt = `${BRAND.name}: you tell us what's wrong on your credit report; our team prepares and mails the letters.`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  const logo = await readFile(join(process.cwd(), "public", BRAND.logo.onDark.src));
  const logoSrc = `data:image/svg+xml;base64,${logo.toString("base64")}`;
  const logoHeight = 84;
  const logoWidth = Math.round((logoHeight * BRAND.logo.onDark.width) / BRAND.logo.onDark.height);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "linear-gradient(180deg, #2E3C52 0%, #12213A 100%)",
          padding: "72px 80px 0 80px",
          color: "#FFFFFF",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoSrc} width={logoWidth} height={logoHeight} alt="" />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 64, lineHeight: 1.1, fontWeight: 700, letterSpacing: -1.5, display: "flex", flexWrap: "wrap" }}>
            Something wrong on your credit report?
          </div>
          <div style={{ fontSize: 64, lineHeight: 1.1, fontWeight: 700, letterSpacing: -1.5, color: "#EFB537", marginTop: 6 }}>
            A real team handles the letters.
          </div>
          <div style={{ fontSize: 30, marginTop: 28, color: "#DFE5EE" }}>English or Spanish · You see every step · Results vary</div>
        </div>
        <div style={{ display: "flex", height: 18, background: "#EFB537", marginLeft: -80, marginRight: -80, marginTop: 56 }} />
      </div>
    ),
    { ...size },
  );
}
