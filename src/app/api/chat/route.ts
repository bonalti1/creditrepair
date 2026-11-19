import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSupabase, getSessionUser } from "@/lib/supabase/server";
import { loadAppThread, MAX_MESSAGE_CHARS } from "@/lib/chat/history";
import { rateLimit } from "@/lib/security/rateLimit";

// The in-app thread with Capi, stored per user. Runs as the signed-in user
// through the cookie-bound client, so row-level security enforces ownership and
// limits what a client may write: its own scripted "journey" lines only.
// AI replies are stored by /api/coach, never accepted from the browser.

export async function GET() {
  const supabase = await getServerSupabase();
  const user = await getSessionUser();
  if (!supabase || !user) return NextResponse.json({ authenticated: false, messages: [] });
  const messages = await loadAppThread(supabase, user.id);
  return NextResponse.json({ authenticated: true, messages });
}

const postSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().trim().min(1).max(MAX_MESSAGE_CHARS) }))
    .min(1)
    .max(10),
});

export async function POST(req: Request) {
  const limited = rateLimit(req, "chat", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const supabase = await getServerSupabase();
  const user = await getSessionUser();
  if (!supabase || !user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { error } = await supabase.from("chat_messages").insert(
    parsed.data.messages.map((m) => ({
      user_id: user.id,
      channel: "app",
      role: m.role,
      source: "journey",
      body: m.text,
    })),
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, stored: parsed.data.messages.length });
}
