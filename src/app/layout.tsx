import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Inter is the fallback; Apple devices use San Francisco via the system stack
// declared in globals.css. latin-ext covers Spanish accents and ñ.
const inter = Inter({ subsets: ["latin", "latin-ext"], display: "swap", variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Bonalti Crédito — Tu asistente de crédito con IA",
  description:
    "Software gratuito de disputas de crédito en español. Tú revisas, tú apruebas, tú envías. Los resultados varían.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f5f5f7",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={inter.variable}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
