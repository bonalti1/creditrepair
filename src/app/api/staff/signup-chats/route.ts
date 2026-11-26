import { NextResponse } from "next/server";
import { z } from "zod";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { listThreads, loadThread, staffHandBack, staffJoin, staffReply, waitingCount } from "@/lib/signup/liveChatServer";
import { getStaffLocaleChoice, requireCapability } from "@/lib/staff/access";
import { getServerSupabase } from "@/lib/supabase/server";

// The console's «Live chats» (/equipo/chats; docs/SIGNUP-CHAT.md). leads.work
// (administrators and sales), like the leads the chats become.
//
//   GET                 the open chats and those handed back in the last day.
//   GET ?case=CR-XXXXX  one chat.
//   GET ?count=1        how many wait for a person (the menu's red circle).
//   POST {action: "join" | "reply" | "hand_back", caseRef}
//
// A reply passes checkStaffReply (the claim rules every staff reply passes)
// on the server; a reply that breaks one is refused with the reasons (422).
// Reads go through the member's own connection (row level security).

const caseRef = z.string().regex(/^CR-[2-9A-HJKMNP-TW-Z]{5}$/);
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("join"), caseRef }).strict(),
  z.object({ action: z.literal("reply"), caseRef, text: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ action: z.literal("hand_back"), caseRef }).strict(),
]);

export async function GET(req: Request) {
  const allowed = await requireCapability("leads.work");
  if (!allowed.ok) return allowed.response;
  const reader = await getServerSupabase();
  if (!reader) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  const url = new URL(req.url);
  try {
    if (url.searchParams.get("count") === "1") return NextResponse.json({ waiting: await waitingCount(reader) });
    const ref = url.searchParams.get("case");
    if (ref) {
      if (!caseRef.safeParse(ref).success) return NextResponse.json({ error: "Not a case" }, { status: 400 });
      const thread = await loadThread(reader, ref);
      return thread ? NextResponse.json({ thread }) : NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ threads: await listThreads(reader) });
  } catch (error) {
    await reportError(error, { where: "api/staff/signup-chats:get", userId: allowed.member.userId });
    return NextResponse.json({ error: "The chats could not be read right now." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-signup-chats", { limit: 240, windowMs: 60 * 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 8_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const input = parsed.data;
  const allowed = await requireCapability("leads.work");
  if (!allowed.ok) return allowed.response;
  const { db, member } = allowed;
  try {
    const result =
      input.action === "join"
        ? await staffJoin(db, input.caseRef, member)
        : input.action === "reply"
          ? await staffReply(db, input.caseRef, member, input.text, (await getStaffLocaleChoice(member)) ?? "en")
          : await staffHandBack(db, input.caseRef);
    if (!result.ok) return NextResponse.json({ error: result.code, code: result.code, ...(result.problems ? { problems: result.problems } : {}) }, { status: result.status });
    return NextResponse.json({ ok: true, thread: result.thread });
  } catch (error) {
    await reportError(error, { where: `api/staff/signup-chats:${input.action}`, userId: member.userId });
    return NextResponse.json({ error: "That did not go through. Try again." }, { status: 500 });
  }
}
