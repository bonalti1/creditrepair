import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bonalti Crédito — Tu herramienta de disputas DIY",
  description:
    "Software gratuito de disputas de crédito. Tú revisas, tú apruebas, tú envías. Los resultados varían.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
