import { NextResponse } from "next/server";
import { getStaffMember } from "@/lib/staff/access";
import { getServerSupabase } from "@/lib/supabase/server";

// Magic-link landing: exchange the auth code for a session cookie, then go on.
// A member of the team (from their own staff record) goes to the console and
// gets no client profile; anyone else gets their profile row and continues
// to where they were headed.

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const requested = url.searchParams.get("next") ?? "/dashboard";
  // Only a path inside this app: never another site.
  let next = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/dashboard";

  const supabase = await getServerSupabase();
  if (supabase && code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      if (await getStaffMember()) {
        if (!next.startsWith("/equipo")) next = "/equipo";
      } else {
        await supabase.from("profiles").upsert({ id: data.user.id }, { onConflict: "id", ignoreDuplicates: true });
      }
    }
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
