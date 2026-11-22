import type { MetadataRoute } from "next";
import { APP_ICONS, BRAND } from "@/lib/brand";

// The web app manifest, served at /manifest.webmanifest (Next writes the
// <link rel="manifest"> tag). It is the brand kit's site.webmanifest with the
// icon paths pointed at where the files live here (public/brand/icons/), plus
// the fields an installable app needs.
//
// start_url is the client's home, /dashboard: an icon on a phone's home
// screen is for a client opening their app, not for reading the landing page
// again. Signed out, the auth gate (src/proxy.ts) sends them to /login and
// back to /dashboard after; in the demo (no database) it opens straight away.

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: BRAND.name,
    short_name: BRAND.name,
    description:
      "Servicio de crédito en español. Tú nos dices qué está mal en tu reporte; nuestro equipo prepara y envía las cartas por ti. Los resultados varían.",
    lang: "es",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    theme_color: APP_ICONS.themeColor,
    background_color: APP_ICONS.themeColor,
    icons: APP_ICONS.manifestIcons.map((icon) => ({ ...icon })),
  };
}
