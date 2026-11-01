import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";

// Cookie-bound Supabase client for server components and route handlers.
// Queries through this client run as the signed-in user, so RLS applies.
// Returns null when Supabase isn't configured (demo mode).

export async function getServerSupabase(): Promise<SupabaseClient | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component — middleware handles the refresh.
        }
      },
    },
  });
}

export async function getSessionUser(): Promise<User | null> {
  const supabase = await getServerSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

/**
 * Resolve the acting user for an API route. Priority:
 * 1. Signed-in session user (normal app traffic — RLS-backed).
 * 2. Explicit userId from a service caller presenting the n8n webhook secret
 *    (cron/round-loop traffic — uses the admin client, RLS bypassed).
 */
export async function resolveActingUser(
  req: Request,
  explicitUserId?: string | null,
): Promise<{ userId: string; via: "session" | "service" } | null> {
  const user = await getSessionUser();
  if (user) return { userId: user.id, via: "session" };

  const secret = process.env.N8N_WEBHOOK_SECRET;
  if (explicitUserId && secret && req.headers.get("x-webhook-secret") === secret) {
    return { userId: explicitUserId, via: "service" };
  }
  return null;
}
