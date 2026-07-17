import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Service-role client for API routes and n8n-triggered jobs. RLS is defined in
// supabase/migrations and applies to the anon/user clients; the service client
// bypasses it, so every query here must filter by user_id explicitly.
// TODO(Phase 1): wire Supabase Auth session handling and replace the explicit
// user_id parameters in API routes with the authenticated user.

export function getAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}
