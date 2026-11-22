import type { Metadata, Viewport } from "next";
import { Inter, Nunito } from "next/font/google";
import "./globals.css";
import { APP_ICONS, BRAND } from "@/lib/brand";

// Inter is the fallback; Apple devices use San Francisco via the system stack
// declared in globals.css. latin-ext covers Spanish accents and ñ.
const inter = Inter({ subsets: ["latin", "latin-ext"], display: "swap", variable: "--font-inter" });
// Rounded display face for big headlines. (The logo is a file, never a font:
// src/components/Logo.tsx. The kit's Poppins/Inter is a recommendation the
// owner has not confirmed; see docs/BRAND.md.)
const nunito = Nunito({
  subsets: ["latin", "latin-ext"],
  weight: ["800", "900"],
  display: "swap",
  variable: "--font-nunito",
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
    <html lang="es" className={`${inter.variable} ${nunito.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
