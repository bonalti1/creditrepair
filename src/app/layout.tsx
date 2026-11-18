import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

// One warm, highly legible typeface across the product (brand skin pending —
// this is palette-neutral). Latin-ext covers Spanish accents and ñ cleanly.
const font = Plus_Jakarta_Sans({ subsets: ["latin", "latin-ext"], display: "swap" });

export const metadata: Metadata = {
  title: "Bonalti Crédito — Tu asistente de crédito con IA",
  description:
    "Software gratuito de disputas de crédito en español. Tú revisas, tú apruebas, tú envías. Los resultados varían.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className={font.className}>{children}</body>
    </html>
  );
}
