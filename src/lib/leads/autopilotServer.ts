import type { SupabaseClient } from "@supabase/supabase-js";
import { storeMessage } from "../chat/history";
import { capDay, decideAutoReply, type SkipReason } from "./autopilot";
import { LIVE_SEND, loadAutopilotSettings, loadLeads, loadLeadThread, type LeadSendDeps } from "./inboxServer";
import type { HandoffReason, Lead } from "./types";

// The lead autopilot's run (the rules are autopilot.ts). Called by
// POST /api/cron/leads every few minutes. With the switch off it reads the
// switch and nothing else. Each message is claimed (a unique row in
// lead_auto_messages) BEFORE it is sent, so two runs never both send it; a run
// that dies after the claim leaves it "claimed" and never retries it (at most
// once). A hand-off is a row too, and is what the alerts sweep tells a person.

const HOUR = 60 * 60 * 1000;

type Row = Record<string, unknown>;

export interface AutopilotRun {
  enabled: boolean;
  considered: number;
  sent: number;
  failed: number;
  handedOff: Array<{ leadId: string; reason: HandoffReason }>;
  skipped: Partial<Record<SkipReason, number>>;
}

export async function runLeadAutopilot(db: SupabaseClient, now: Date, options: { appUrl: string; deps?: LeadSendDeps }): Promise<AutopilotRun> {
  const deps = options.deps ?? LIVE_SEND;
  const run: AutopilotRun = { enabled: false, considered: 0, sent: 0, failed: 0, handedOff: [], skipped: {} };
  const settings = await loadAutopilotSettings(db);
  if (!settings.enabled || !settings.enabledAt) return run;
  run.enabled = true;

  // Only leads whose last message came after it was turned on, inside WhatsApp's 24 hours.
  const since = new Date(Math.max(Date.parse(settings.enabledAt), now.getTime() - 24 * HOUR)).toISOString();
  const leads = (await loadLeads(db)).filter((l: Lead) => l.lastInboundAt && l.lastInboundAt >= since);
  if (leads.length === 0) return run;

  const { data: recent, error } = await db.from("lead_auto_messages").select("lead_id, status, dedupe_key, created_at").gte("created_at", new Date(now.getTime() - 26 * HOUR).toISOString());
  if (error) throw new Error(`lead_auto_messages: ${error.message}`);
  const today = capDay(now);
  const sentToday = ((recent as Row[] | null) ?? []).filter((r) => r.status === "sent" && capDay(String(r.created_at)) === today);
  let allToday = sentToday.length;

  for (const lead of leads) {
    run.considered += 1;
    const thread = await loadLeadThread(db, lead.id);
    if (!thread) continue;
    const { data: keys } = await db.from("lead_auto_messages").select("dedupe_key").eq("lead_id", lead.id);
    const done = new Set(((keys as Row[] | null) ?? []).map((k) => String(k.dedupe_key)));
    const decision = decideAutoReply({
      lead,
      messages: thread.messages,
      settings,
      sentToday: { lead: sentToday.filter((r) => r.lead_id === lead.id).length, all: allToday },
      done,
      now,
      appUrl: options.appUrl,
    });
    if (decision.action === "skip") {
      run.skipped[decision.reason] = (run.skipped[decision.reason] ?? 0) + 1;
      continue;
    }
    if (decision.action === "handoff") {
      const { error: claim } = await db.from("lead_auto_messages").insert({ lead_id: lead.id, kind: "handoff", status: "handed_off", reason: decision.reason, body: null, inbound_at: decision.inboundAt, dedupe_key: decision.dedupeKey });
      if (!claim) run.handedOff.push({ leadId: lead.id, reason: decision.reason });
      continue;
    }
    // Claim, then send: never twice.
    const { data: claimed, error: claimError } = await db
      .from("lead_auto_messages")
      .insert({ lead_id: lead.id, kind: decision.kind, status: "claimed", body: decision.body, inbound_at: decision.inboundAt, dedupe_key: decision.dedupeKey })
      .select("id")
      .single();
    if (claimError || !claimed) continue;
    const id = String((claimed as Row).id);
    try {
      const result = await deps.sendText(lead.phone.replace(/^\+/, ""), decision.body, "whatsapp:lead-autopilot");
      if (!result.sent) {
        await db.from("lead_auto_messages").update({ status: "failed", reason: "whatsapp_not_configured" }).eq("id", id);
        run.failed += 1;
        continue;
      }
      await db.from("lead_auto_messages").update({ status: "sent" }).eq("id", id);
      // The conversation shows it, as Alti's (AI) message.
      await storeMessage(db, { phoneE164: lead.phone, channel: "whatsapp", role: "assistant", source: "coach", text: decision.body });
      run.sent += 1;
      allToday += 1;
      sentToday.push({ lead_id: lead.id, status: "sent", created_at: now.toISOString() });
    } catch (sendError) {
      await db.from("lead_auto_messages").update({ status: "failed", reason: String(sendError instanceof Error ? sendError.message : sendError).slice(0, 200) }).eq("id", id);
      run.failed += 1;
    }
  }
  return run;
}
