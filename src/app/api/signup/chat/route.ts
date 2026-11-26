import { NextResponse } from "next/server";
import { z } from "zod";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { LIVE_CHAT_LIMITS } from "@/lib/signup/liveChat";
import { personRead, personSend, requestPerson } from "@/lib/signup/liveChatServer";
import { getAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/server";

// A person in Alti's signup chat (docs/SIGNUP-CHAT.md, «A person joins the chat»).
//
//   POST {action: "request"}  "Chat with a person here": opens the thread for the team.
//   POST {action: "send"}     the person's message (numbers that look like an SSN
//                             or an account are taken out first). While no teammate
//                             is in the chat, Alti answers from the website's library.
//   POST {action: "read"}     the thread, polled every few seconds by the chat.
//
// Every call carries the case reference and its resume token (or comes from
// the account the case is linked to), as /api/signup does. In the demo (no
// database) it answers 503 and the chat simulates the thread in the browser.

const base = { caseRef: z.string().max(12), token: z.string().max(64).nullable().optional() };
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("request"), ...base, locale: z.enum(["en", "es"]) }).strict(),
  z.object({ action: z.literal("send"), ...base, locale: z.enum(["en", "es"]), text: z.string().trim().min(1).max(LIVE_CHAT_LIMITS.maxChars) }).strict(),
  z.object({ action: z.literal("read"), ...base }).strict(),
]);

export async function POST(req: Request) {
  const body = await readJsonBody(req, 4_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const input = parsed.data;
  // Reading is polled; writing is limited harder.
  const limited = rateLimit(req, input.action === "read" ? "signup-chat-read" : "signup-chat-write", input.action === "read" ? { limit: 60, windowMs: 60_000 } : { limit: LIVE_CHAT_LIMITS.personPerMinute, windowMs: 60_000 });
  if (limited) return limited;
  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured", live: false }, { status: 503 });
  const user = await getSessionUser();
  const owner = { caseRef: input.caseRef, token: input.token ?? null };
  try {
    const result =
      input.action === "request"
        ? await requestPerson(db, { ...owner, locale: input.locale }, user?.id ?? null)
        : input.action === "send"
          ? await personSend(db, { ...owner, locale: input.locale, text: input.text }, user?.id ?? null)
          : await personRead(db, owner, user?.id ?? null);
    if (!result.ok) return NextResponse.json({ error: result.code, code: result.code }, { status: result.status });
    return NextResponse.json({ ok: true, live: true, thread: result.thread, ...("removed" in result && result.removed ? { removed: true } : {}) });
  } catch (error) {
    await reportError(error, { where: `api/signup/chat ${input.action}` });
    return NextResponse.json({ error: "The chat could not be reached right now." }, { status: 500 });
  }
}
