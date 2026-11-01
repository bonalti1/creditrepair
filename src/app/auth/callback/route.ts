import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

// Magic-link landing: exchange the auth code for a session cookie, ensure a
// profile row exists, then continue to where the user was headed.

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/dashboard";

  const supabase = await getServerSupabase();
  if (supabase && code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      await supabase
        .from("profiles")
        .upsert({ id: data.user.id }, { onConflict: "id", ignoreDuplicates: true });
    }
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
