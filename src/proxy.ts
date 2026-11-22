import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isSupabaseConfigured } from "@/lib/supabase/config";

// Session refresh + auth gate for app pages and the staff console. When
// Supabase isn't configured, everything passes through (demo mode) so the
// product is explorable with zero setup.
// (Next.js 16 calls this file "proxy"; it was "middleware" before. It runs on
// the Node.js runtime.)

export async function proxy(req: NextRequest) {
  // The demo rule (supabase/config.ts): no settings, no login gate.
  if (!isSupabaseConfigured()) return NextResponse.next();
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
    return NextResponse.redirect(loginUrl);
  }
  return res;
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
    // The service agreement: read, signed and cancelled only by the signed-in client.
    "/acuerdo/:path*",
    // "Mis pagos": the client's charges, receipts and payment method.
    "/pagos/:path*",
    // The staff console. Signed in is the first check; being an active member
    // of staff is the second, in src/app/equipo/layout.tsx.
    "/equipo/:path*",
  ],
};
