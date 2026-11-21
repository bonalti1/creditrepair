import type { Metadata, Viewport } from "next";
import { Inter, Nunito } from "next/font/google";
import "./globals.css";
import { BRAND } from "@/lib/brand";

// Inter is the fallback; Apple devices use San Francisco via the system stack
// declared in globals.css. latin-ext covers Spanish accents and ñ.
const inter = Inter({ subsets: ["latin", "latin-ext"], display: "swap", variable: "--font-inter" });
// Rounded display face for the wordmark and big headlines.
const nunito = Nunito({
  subsets: ["latin", "latin-ext"],
  weight: ["800", "900"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-nunito",
});

export const metadata: Metadata = {
  title: BRAND.title,
  description:
    "Servicio de crédito en español. Tú nos dices qué está mal en tu reporte; nuestro equipo prepara y envía las cartas por ti. Los resultados varían.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f5f5f7",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${inter.variable} ${nunito.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
