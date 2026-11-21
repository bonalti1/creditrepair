// The one rule for "is this the demo?": the app runs on the database when the
// two public Supabase settings are present, and is the demo when they are not.
// Every part of the app asks this function (the browser and server clients,
// the proxy, the staff console's data layer, the client app's stores), so the
// two can never disagree.
//
// Read at call time, not at module load: Next inlines NEXT_PUBLIC_ values into
// the browser bundle wherever they are written out like this, and on the
// server the tests can change them.

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/** No Supabase settings, no database: the demo. */
export function isDemoMode(): boolean {
  return !isSupabaseConfigured();
}
