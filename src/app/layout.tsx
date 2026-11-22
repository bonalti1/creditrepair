import type { Metadata, Viewport } from "next";
import { Inter, Poppins } from "next/font/google";
import "./globals.css";
import { APP_ICONS, BRAND } from "@/lib/brand";
import { TEXT_SIZE_SCRIPT } from "@/lib/ux/textSizeCore";

// The brand kit's typefaces (brand/typography/TYPOGRAPHY.md, confirmed by the
// owner): Inter for body and interface text, Poppins for headings and display
// (`font-display`). next/font downloads both at build time and serves them from
// this site, so no visitor's browser asks Google for anything. latin-ext covers
// Spanish accents, ñ, ¿ and ¡. Only these weights exist: a heavier class would
// make the browser fake a bold, so the tests keep 800/900 out of src/. Neither
// font is ever used to imitate the logo, which is a file
// (src/components/Logo.tsx). See docs/BRAND.md, "Typography".
const inter = Inter({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-inter",
});
const poppins = Poppins({
  subsets: ["latin", "latin-ext"],
  weight: ["600", "700"],
  display: "swap",
  variable: "--font-poppins",
});

// Icons come from Next's file conventions in this folder: favicon.ico,
// icon.svg and apple-icon.png (the brand kit's favicon set, unchanged), and
// manifest.ts. Nothing to list here.
export const metadata: Metadata = {
  title: BRAND.title,
  description:
    "Servicio de crédito en español. Tú nos dices qué está mal en tu reporte; nuestro equipo prepara y envía las cartas por ti. Los resultados varían.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // The brand navy, as in the kit's favicon set and the manifest.
  themeColor: APP_ICONS.themeColor,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the "Letra grande" script below may set data-text-size before React loads.
    <html lang="es" className={`${inter.variable} ${poppins.variable}`} suppressHydrationWarning>
      <head>
        {/* "Letra grande" (src/lib/ux/textSize.ts): applied before the first paint, so nothing jumps. */}
        <script dangerouslySetInnerHTML={{ __html: TEXT_SIZE_SCRIPT }} />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
