import { NextResponse } from "next/server";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { COACH_SAFE_FALLBACK, replyLanguage } from "@/lib/coach/language";
import { coachSystemPrompt, replyLanguageLine } from "@/lib/coach/systemPrompt";
import { containsTaxpayerNumber } from "@/lib/aftercare/itin";
import { checkClaimGuardrails } from "@/lib/compliance/guardrails";
import { DEMO_SAVED_ANSWERS, libraryReplyFor, libraryReplyText, type SavedAnswer } from "@/lib/staff/answers";
import { loadApprovedAnswers } from "@/lib/staff/answersServer";
import { isDemoMode } from "@/lib/supabase/config";
import { storeMessage } from "@/lib/chat/history";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { getAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/server";
import { clientOption } from "@/lib/service/server";
import { parseServiceOption, type ServiceOption } from "@/lib/service/options";

// AI Credit Coach (spec §4.3). Answers in the language the client writes in,
// else in the app's language (`locale`, English by default; coach/language.ts).
// The system prompt hard-codes the
// claim guardrails; as defense in depth, output is also linted post-hoc and
// replaced with a safe fallback if it would violate them.
//
// When the caller is signed in, the question and the reply are stored
// server-side (chat_messages, source "coach") so there is a record of what the
// AI said that the browser cannot alter.
//
// Before the model: the team's saved answers (src/lib/staff/answers.ts). An
// answer an ADMINISTRATOR approved that matches the question closely is sent
// as the reply, after the claim rules pass on it again (libraryReplyFor); it
// works with or without a model key. Anything else goes on exactly as before.

const bodySchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) }))
    .min(1)
    .max(40),
  /** The language the client is using the app in (the fallback when a message does not say). */
  locale: z.enum(["es", "en"]).optional(),
  /** The demo only (no account): the option this device chose. A signed-in client's option is read on the server. */
  option: z.enum(["full_service", "diy"]).optional(),
});


export async function POST(req: Request) {
  // Each call spends model tokens: cap it per caller.
  const limited = rateLimit(req, "coach", { limit: 20, windowMs: 5 * 60_000 });
  if (limited) return limited;

  // 40 messages of 4,000 characters is ~160 KB; anything past 256 KB is not a conversation.
  const body = await readJsonBody(req, 256_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const messages = parsed.data.messages;
  const question = messages[messages.length - 1]!;
  const language = replyLanguage(question.content, parsed.data.locale);
  if (question.role !== "user" || messages[0]!.role !== "user") {
    return NextResponse.json({ error: "Conversation must start and end with a user message" }, { status: 400 });
  }

  // The team's approved answers first: a close match is answered without the model and without a person.
  const library = await approvedLibrary();
  const fromLibrary = libraryReplyFor(question.content, library);
  // Only an answer written in the language of the reply (the team writes each one in one language).
  if (fromLibrary && replyLanguage(fromLibrary.answer.answer, language) === language) {
    const reply = libraryReplyText(fromLibrary, language);
    // Checked once more as the exact words that go out.
    if (checkClaimGuardrails(reply).length === 0) {
      const stored = await storeExchange(question.content, reply);
      return NextResponse.json({ reply, stored, source: "saved_answer", savedAnswerId: fromLibrary.answer.id });
    }
  }

  // No key means the coach is switched off here (the demo), which is a normal
  // state and not a failure: answer 200 with no reply and let the client show
  // its own fallback. A 5xx is kept for a model call that actually failed, so
  // an outage is not hidden behind the demo's noise.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ reply: null, configured: false });

  const user = await getSessionUser().catch(() => null);
  // The client's own option decides how Alti describes the service (Credalti Complete or Credalti DIY).
  // Signed in: read on the server. The demo: what this device chose.
  const admin = user ? getAdminClient() : null;
  const mode: ServiceOption = admin && user ? await clientOption(admin, user.id) : (parseServiceOption(parsed.data.option) ?? "full_service");

  let reply: string;
  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      system: `${coachSystemPrompt(mode, parsed.data.locale ?? "en")}\n\n${replyLanguageLine(language)}`,
      messages,
    });
    reply = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
  } catch (error) {
    await reportError(error, { where: "api/coach", userId: user?.id });
    return NextResponse.json({ error: "Coach temporarily unavailable" }, { status: 502 });
  }

  const violations = checkClaimGuardrails(reply, mode);
  // Never a full Social Security number or ITIN in a reply (src/lib/aftercare/itin.ts).
  if (violations.length > 0 || !reply || containsTaxpayerNumber(reply)) {
    console.warn("Coach guardrail violation, replacing reply:", violations.map((v) => v.rule));
    reply = COACH_SAFE_FALLBACK[language];
  }

  const stored = await storeExchange(question.content, reply, user);
  return NextResponse.json({ reply, stored });
}

/** The approved saved answers: the demo's invented ones, or the database's (service role; approved rows only). */
async function approvedLibrary(): Promise<readonly SavedAnswer[]> {
  if (isDemoMode()) return DEMO_SAVED_ANSWERS.filter((a) => a.status === "approved");
  const db = getAdminClient();
  return db ? loadApprovedAnswers(db) : [];
}

/** Store the question and the reply for a signed-in client. False when nothing was stored. */
async function storeExchange(question: string, reply: string, known?: { id: string } | null): Promise<boolean> {
  const user = known === undefined ? await getSessionUser().catch(() => null) : known;
  const db = user ? getAdminClient() : null;
  if (!user || !db) return false;
  const base = { userId: user.id, channel: "app" as const, source: "coach" as const };
  const savedQuestion = await storeMessage(db, { ...base, role: "user", text: question });
  const savedReply = await storeMessage(db, { ...base, role: "assistant", text: reply });
  return savedQuestion && savedReply;
}
