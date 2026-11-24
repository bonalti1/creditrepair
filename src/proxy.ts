import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { LOCALE_COOKIE, LOCALE_QUERY, localeCookie, parseLocale, PATH_HEADER } from "@/lib/i18n/detect";

// Session refresh + auth gate for app pages and the staff console. When
// Supabase isn't configured, everything passes through (demo mode) so the
// product is explorable with zero setup.
// (Next.js 16 calls this file "proxy"; it was "middleware" before. It runs on
// the Node.js runtime.)
//
// Language (src/lib/i18n/detect.ts): a link that carries `?lang=es` or
// `?lang=en` (a salesperson's invitation) saves that choice in the language
// cookie, on the request too, so the very first render is already in that
// language. The path goes on the request for the root layout, which keeps the
// staff console's <html lang> Spanish.

/** The pages that need a signed-in session (everything in the matcher below that is not public). */
const PROTECTED = [
  "/asistente",
  "/mas",
  "/dashboard",
  "/audit",
  "/items",
  "/attack",
  "/rounds",
  "/goal",
  "/caso",
  "/aprende",
  "/construir",
  "/acuerdo",
  "/pagos",
  "/confirmar-direccion",
  "/documentos",
  "/equipo",
  "/socios/portal",
];

const isProtected = (path: string) => PROTECTED.some((p) => path === p || path.startsWith(`${p}/`));

export async function proxy(req: NextRequest) {
  const fromLink = parseLocale(req.nextUrl.searchParams.get(LOCALE_QUERY));
  const secure = req.nextUrl.protocol === "https:";
  if (fromLink) req.cookies.set(LOCALE_COOKIE, fromLink);
  req.headers.set(PATH_HEADER, req.nextUrl.pathname);
  const withLocale = <T extends NextResponse>(res: T): T => {
    if (fromLink) res.cookies.set(localeCookie(fromLink, secure));
    return res;
  };

  // The demo rule (supabase/config.ts): no settings, no login gate. Public pages: no gate either.
  if (!isSupabaseConfigured() || !isProtected(req.nextUrl.pathname)) return withLocale(NextResponse.next({ request: req }));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  let res = NextResponse.next({ request: req });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", req.nextUrl.pathname);
    return withLocale(NextResponse.redirect(loginUrl));
  }
  return withLocale(res);
}

export const config = {
  matcher: [
    "/asistente/:path*",
    "/mas/:path*",
    "/dashboard/:path*",
    "/audit/:path*",
    "/items/:path*",
    "/attack/:path*",
    "/rounds/:path*",
    "/goal/:path*",
    // "Mi caso" and "Aprende" (the client app's timeline and lessons).
    "/caso/:path*",
    "/aprende/:path*",
    // After-care: the build-your-credit plan, the home-ready path and the ITIN guide.
    "/construir/:path*",
    // The service agreement: read, signed and cancelled only by the signed-in client.
    "/acuerdo/:path*",
    // "Mis pagos": the client's charges, receipts and payment method.
    "/pagos/:path*",
    // The one-tap screens the automatic messages link to (migration 0022): the client's own address and documents.
    "/confirmar-direccion/:path*",
    "/documentos/:path*",
    // The staff console. Signed in is the first check; being an active member
    // of staff is the second, in src/app/equipo/layout.tsx.
    "/equipo/:path*",
    // The partner portal (migration 0017): signed in first; the portal's routes check the partner.
    "/socios/portal/:path*",
    // Public pages: no login gate, only the language of an invitation link (?lang=) and the path.
    "/",
    "/empezar",
    "/onboarding/:path*",
    "/login",
    "/socios",
    "/conoce/:path*",
    "/baja",
  ],
};
