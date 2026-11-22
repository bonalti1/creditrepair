import type { SupabaseClient } from "@supabase/supabase-js";
import { availabilityFromEnv } from "../autopilot/channels";
import { loadAutopilotSettings } from "../autopilot/store";
import type { ChannelAvailability } from "../autopilot/types";
import { sendEmail } from "../integrations/email";
import { sendWhatsAppTemplate, sendWhatsAppText } from "../integrations/whatsapp";
import { furnisherFromRow } from "../mail/server";
import { reportError } from "../observability/errors";
import { DIGEST_TEMPLATE, digestChannel, digestDue, digestSubject, morningSummary, type DigestChoice, type MorningSummary } from "./digest";
import { DEFAULT_STAFF_LOCALE } from "./i18n/locale";
import { clientsFromRows } from "./fromRows";
import { loadStaffRows } from "./load";
import { isStaffRole } from "./permissions";
import { preferencesFromRow } from "./preferences";

// The morning summary on the database: who asked for it, whose time it is,
// claim, send, record. Runs with the service role from the cron route
// (/api/cron/staff-digest, the shared secret), like the autopilot.
//
// Each member's clients are the ones their role lets them see, filtered here
// with the same rule the console and the database policies use
// (permissions.ts canSeeClient): the cron has no member's own connection.
//
// Sent once per member per local day: the day's row in staff_digests is
// claimed (a unique key) before anything is sent; whoever loses the claim
// sends nothing, and a run that stops after the claim never tries again.

type Row = Record<string, unknown>;

export interface DigestMember {
  userId: string;
  handle: string;
  name: string;
  role: string;
  phone: string | null;
  email: string | null;
}

export type DigestDeliver = (member: DigestMember, summary: MorningSummary, choice: DigestChoice, idempotencyKey: string) => Promise<{ ok: boolean; note?: string }>;

/** The real channels: WhatsApp (the approved template outside the 24-hour window) or email with the legal footer. Never SMS. */
export const deliverDigest: DigestDeliver = async (member, summary, choice, idempotencyKey) => {
  if (choice.channel === "whatsapp" && member.phone) {
    const to = member.phone.replace(/^\+/, "");
    if (choice.mode === "text") {
      const result = await sendWhatsAppText(to, summary.text, "staff:digest");
      return result.sent ? { ok: true } : { ok: false, note: "not_configured" };
    }
    const result = await sendWhatsAppTemplate(to, { name: DIGEST_TEMPLATE, locale: summary.locale, params: summary.params, rendered: summary.text }, "staff:digest");
    return result.sent ? { ok: true } : { ok: false, note: "not_configured" };
  }
  if (choice.channel === "email" && member.email) {
    const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ?? "";
    const address = process.env.NEXT_PUBLIC_COMPANY_ADDRESS ?? "";
    if (!base || !address) return { ok: false, note: "email_not_ready" };
    const result = await sendEmail({
      to: member.email,
      subject: digestSubject(summary),
      text: summary.text,
      // A member turns it off on their own profile: that page is the "unsubscribe" link.
      unsubscribeUrl: `${base}/equipo/perfil#resumen`,
      postalAddress: address,
      idempotencyKey,
    });
    return result.sent ? { ok: true } : { ok: false, note: "not_configured" };
  }
  return { ok: false, note: "no_channel" };
};

export interface DigestRunDeps {
  channels?: ChannelAvailability;
  deliver?: DigestDeliver;
  base?: string;
}

export interface DigestRunSummary {
  members: number;
  sent: number;
  failed: number;
  waiting: number;
  noChannel: number;
  duplicates: number;
}

export async function runStaffDigests(db: SupabaseClient, now: Date = new Date(), deps: DigestRunDeps = {}): Promise<DigestRunSummary> {
  const summary: DigestRunSummary = { members: 0, sent: 0, failed: 0, waiting: 0, noChannel: 0, duplicates: 0 };
  const { data: prefRows, error } = await db.from("staff_preferences").select("*").eq("digest_enabled", true);
  if (error) throw new Error(`staff_preferences: ${error.message}`);
  const wanting = ((prefRows as Row[] | null) ?? []).map((row) => ({ userId: String(row.user_id), prefs: preferencesFromRow(row) }));
  if (wanting.length === 0) return summary;

  const { data: memberRows, error: memberError } = await db
    .from("staff_members")
    .select("user_id, handle, display_name, role, active, email, phone_e164")
    .in("user_id", wanting.map((w) => w.userId));
  if (memberError) throw new Error(`staff_members: ${memberError.message}`);
  const members = new Map(
    ((memberRows as Row[] | null) ?? [])
      .filter((m) => m.active === true && isStaffRole(m.role))
      .map((m) => [
        String(m.user_id),
        {
          userId: String(m.user_id),
          handle: String(m.handle ?? ""),
          name: String(m.display_name || m.handle || "Equipo"),
          role: String(m.role),
          phone: typeof m.phone_e164 === "string" ? m.phone_e164 : null,
          email: typeof m.email === "string" ? m.email : null,
        } satisfies DigestMember,
      ]),
  );

  const settings = await loadAutopilotSettings(db);
  const channels = deps.channels ?? availabilityFromEnv();
  const deliver = deps.deliver ?? deliverDigest;
  const base = deps.base ?? process.env.NEXT_PUBLIC_APP_URL ?? "";

  // Which days each member already has, so a due check never claims twice.
  const { data: sentRows } = await db.from("staff_digests").select("user_id, local_day").in("user_id", [...members.keys()]);
  const sentDays = new Map<string, Set<string>>();
  for (const row of (sentRows as Row[] | null) ?? []) {
    const set = sentDays.get(String(row.user_id)) ?? new Set<string>();
    set.add(String(row.local_day).slice(0, 10));
    sentDays.set(String(row.user_id), set);
  }

  const due = wanting.flatMap(({ userId, prefs }) => {
    const member = members.get(userId);
    if (!member) return [];
    const check = digestDue(prefs, now, settings, sentDays.get(userId) ?? new Set());
    if (!check.due) {
      if (check.why === "not_yet" || check.why === "quiet_hours") summary.waiting += 1;
      return [];
    }
    return [{ member, prefs, day: check.day }];
  });
  summary.members = due.length;
  if (due.length === 0) return summary;

  // Every client once, mapped as the console maps them; each member then sees their own.
  const clients = clientsFromRows(await loadStaffRows(db));
  const { data: bookRows } = await db.from("furnishers").select("*");
  const furnishers = ((bookRows as Row[] | null) ?? []).map(furnisherFromRow);

  for (const { member, prefs, day } of due) {
    const viewer = { handle: member.handle, name: member.name, role: member.role as "admin" | "specialist" | "sales" };
    // In the member's language: their saved choice, else English (the cron has no browser to ask).
    const text = morningSummary(viewer, clients, now, { furnishers, autopilot: { settings, channels } }, base, prefs.locale ?? DEFAULT_STAFF_LOCALE);
    const choice = digestChannel(prefs.digestChannel, member, channels, now);
    if (!choice.channel) {
      summary.noChannel += 1;
      continue;
    }
    const { data: claimed, error: claimError } = await db
      .from("staff_digests")
      .insert({ user_id: member.userId, local_day: day, channel: choice.channel, status: "sending", body: text.text })
      .select("id")
      .single();
    if (claimError) {
      if (claimError.code === "23505") {
        summary.duplicates += 1;
        continue;
      }
      throw new Error(`staff_digests: ${claimError.message}`);
    }
    let result: { ok: boolean; note?: string };
    try {
      result = await deliver(member, text, choice, `staff-digest:${member.userId}:${day}`);
    } catch (error) {
      await reportError(error, { where: "staff:digest", extra: { member: member.handle } });
      result = { ok: false, note: (error as Error).message.slice(0, 200) };
    }
    await db
      .from("staff_digests")
      .update({ status: result.ok ? "sent" : "failed", sent_at: now.toISOString(), note: result.note ?? null })
      .eq("id", String((claimed as Row).id))
      .eq("status", "sending");
    if (result.ok) summary.sent += 1;
    else summary.failed += 1;
  }
  return summary;
}
