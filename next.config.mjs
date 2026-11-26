// Private pages are kept out of search engines twice: robots.txt disallows
// them (src/app/robots.ts, from PRIVATE_PATHS in src/lib/site/routes.ts) and
// every response under them says "noindex" (X-Robots-Tag), so a link from
// elsewhere never gets one indexed. The list below is PRIVATE_PATHS as Next
// header patterns; src/lib/__tests__/seo.test.ts keeps the two the same.
// (The proxy, src/proxy.ts, adds the same header to its own redirects.)
export const NOINDEX_PATHS = [
  "/api/",
  "/equipo",
  "/socios/portal",
  "/dashboard",
  "/asistente",
  "/audit",
  "/items",
  "/attack",
  "/rounds",
  "/goal",
  "/caso",
  "/aprende",
  "/acuerdo",
  "/pagos",
  "/mas",
  "/documentos",
  "/confirmar-direccion",
  "/onboarding",
  "/registro",
  "/login",
  "/auth/",
  "/baja",
  "/r/",
  // The live funnel (docs/LIVE-FUNNEL.md): a campaign page, and the private video links.
  "/live",
  "/v/",
];

const noindex = [{ key: "X-Robots-Tag", value: "noindex, nofollow" }];

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return NOINDEX_PATHS.flatMap((path) => {
      const base = path.replace(/\/$/, "");
      return [
        { source: base, headers: noindex },
        { source: `${base}/:path*`, headers: noindex },
      ];
    });
  },
};

export default nextConfig;
