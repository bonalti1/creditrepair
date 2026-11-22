import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { localHour } from "../../autopilot/clock";
import { runAutopilot, type AutopilotDeps, type Deliver } from "../../autopilot/server";
import { loadAutopilotSettings, placeHold, recordOptChange, releaseHold, saveAutopilotSettings } from "../../autopilot/store";
import { importReportForUser } from "../../domain/importReport";
import { reasonsFor } from "../../letters/reasons";
import { startHarness, type Harness } from "./pg";
import { addClient, addDocuments, addStaff, assign, sampleReport, signAgreement } from "./seed";

// The autopilot against the real migrations (0015 and everything before it),
// with the real run (autopilot/server.ts: runAutopilot) and the real mailing
// path (rounds/send.ts; no Lob key, so the simulated mail service). Only the
// message provider is a stand-in that records what it was asked to send.
//
//   - everything new starts off, and off sends nothing;
//   - quiet hours: nothing at night on the client's clock;
//   - a run twice sends once;
//   - an opted-out client gets nothing (a WhatsApp "BAJA" through the real webhook);
//   - a round waits out its review window, a hold stops it, and it goes as "sistema";
//   - the records are append-only and read by role.

const session = vi.hoisted(() => ({ admin: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => session.admin }));

const HOUR = 60 * 60 * 1000;

let h: Harness;
let admin: Awaited<ReturnType<typeof addStaff>>;
let marta: Awaited<ReturnType<typeof addStaff>>;
let A: string; // ready to send, assigned to marta
let B: string; // created an account, has not signed
let C: string; // the same, and wrote BAJA
let D: string; // ready to send, first seen later (the review window), then held

const delivered: string[] = [];
const deliver: Deliver = async (_client, message) => {
  delivered.push(message.dedupeKey);
  return { ok: true, providerRef: `test-${delivered.length}` };
};
const deps: AutopilotDeps = { deliver, channels: { whatsapp: true, email: false, approvedTemplates: "all", simulated: false } };

/** The first moment at `hour` o'clock in Texas, at or after `after`. */
function texasAt(hour: number, after: number): Date {
  let t = new Date(Math.ceil(after / HOUR) * HOUR);
  while (localHour(t, "America/Chicago") !== hour) t = new Date(t.getTime() + HOUR);
  return t;
}

/** A client with everything in and every item answered: round 1 is ready to send. */
async function readyClient(name: string): Promise<string> {
  const id = await addClient(h, { name });
  await signAgreement(h, id);
  await addDocuments(h, id);
  await importReportForUser(h.service, id, sampleReport(2));
  const items = await h.sql<{ id: string; category: string }>(`select id, category from public.report_items where user_id = $1`, [id]);
  for (const item of items) {
    const attested = item.category === "personal_info";
    const { error } = await h.service.from("item_flags").insert({
      user_id: id,
      item_id: item.id,
      state: attested ? "attested" : "correct",
      attested,
      reason: attested ? "No es mío." : "",
      reason_code: attested ? reasonsFor("personal_info")[0]!.code : null,
      attestation_text: attested ? "I believe this item is inaccurate." : null,
      attestation_version: attested ? "v1" : null,
      attested_at: attested ? new Date(Date.now() - HOUR).toISOString() : null,
    });
    if (error) throw new Error(error.message);
  }
  return id;
}

const roundStatus = async (id: string) =>
  (await h.sql<{ status: string; sent_by_name: string | null; mail_via: string | null }>(`select status, sent_by_name, mail_via from public.attack_rounds where user_id = $1`, [id]))[0] ?? null;
const outbound = async (id: string) =>
  h.sql<{ dedupe_key: string; status: string; topic: string; kind: string; channel: string | null }>(`select dedupe_key, status, topic, kind, channel from public.outbound_messages where user_id = $1 order by queued_at`, [id]);

const start = Date.now();
const T1 = texasAt(12, start + 26 * HOUR); // noon, a day after B and C opened their accounts
const NIGHT = texasAt(2, T1.getTime() + 25 * HOUR); // 2 a.m., more than a day after T1
const NOON = texasAt(12, NIGHT.getTime()); // the noon after that night
const LATER = new Date(NOON.getTime() + 25 * HOUR);

beforeAll(async () => {
  h = await startHarness();
  session.admin = h.service;
  admin = await addStaff(h, "admin", "carmen", "Carmen Ruiz");
  marta = await addStaff(h, "specialist", "marta", "Marta Leal");
  A = await readyClient("Rosa Martínez");
  await assign(h, A, marta.userId, admin.userId);
  B = await addClient(h, { name: "Luis Gómez" });
  C = await addClient(h, { name: "Ana Torres", phone: "+17135550177" });
}, 60_000);

describe("autopilot on the database", () => {
  it("starts with everything new off; with status messages off too, a run sends nothing and mails nothing", async () => {
    const settings = await loadAutopilotSettings(h.service);
    expect(settings).toMatchObject({ roundsEnabled: false, followupsEnabled: false, statusEnabled: true, reviewWindowHours: 24, quietStartHour: 21, quietEndHour: 8, dailyCap: 2 });
    await saveAutopilotSettings(h.service, { statusEnabled: false }, { userId: admin.userId, handle: "carmen" });

    const first = await runAutopilot(h.service, T1, deps);
    const second = await runAutopilot(h.service, new Date(T1.getTime() + 30 * HOUR), deps);
    expect(first.newlyReady).toBe(1);
    expect(second.roundsSent).toEqual([]);
    expect(delivered).toEqual([]);
    expect((await h.sql(`select 1 from public.outbound_messages`)).length).toBe(0);
    expect(await roundStatus(A)).toBeNull();
    // The change was recorded in the team's audit.
    const audit = await h.sql<{ kind: string; detail: Record<string, unknown> }>(`select kind, detail from public.team_audit where kind = 'autopilot_changed'`);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.detail).toMatchObject({ statusEnabled: { from: true, to: false } });
  });

  it("a WhatsApp 'BAJA' through the real webhook records the opt-out and is answered once", async () => {
    const webhook = await import("@/app/api/webhooks/whatsapp/route");
    const payload = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: "wamid.baja1", from: "17135550177", type: "text", text: { body: "BAJA" } }] } }] }] });
    const res = await webhook.POST(new Request("https://app.test/api/webhooks/whatsapp", { method: "POST", headers: { "content-type": "application/json" }, body: payload }));
    expect(res.status).toBe(200);
    const records = await h.sql<{ kind: string; channel: string; keyword: string }>(`select kind, channel, keyword from public.message_opt_outs where user_id = $1`, [C]);
    expect(records).toEqual([{ kind: "opt_out", channel: "whatsapp", keyword: "BAJA" }]);
  });

  it("quiet hours: at 2 a.m. in Texas nothing is sent; the round itself (a letter, not a message) may go", async () => {
    await saveAutopilotSettings(h.service, { roundsEnabled: true, followupsEnabled: true, statusEnabled: true }, { userId: admin.userId, handle: "carmen" });
    D = await readyClient("Diego Arellano");
    const summary = await runAutopilot(h.service, NIGHT, deps);
    expect(delivered).toEqual([]);
    expect(summary.waiting.quiet_hours).toBeGreaterThan(0);
    // A's window (from T1) is over: mailed by the system, every gate checked in send.ts.
    expect(summary.roundsSent).toEqual([{ userId: A, roundNumber: 1, letters: expect.any(Number) }]);
    expect(await roundStatus(A)).toMatchObject({ status: "mailed", sent_by_name: "sistema", mail_via: "mail" });
    // D was first seen now: it waits out its review window.
    expect(summary.roundsInWindow).toBe(1);
    expect(await roundStatus(D)).toBeNull();
    // The client's "letters mailed" waits in the queue for the morning.
    expect((await outbound(A)).map((m) => [m.topic, m.status])).toEqual([["letters_mailed", "queued"]]);
  });

  it("at noon the messages go: status first, then the reminder; the opted-out client gets nothing", async () => {
    await runAutopilot(h.service, NOON, deps);
    expect(delivered.some((k) => k === `status:${A}:letters_mailed:r1`)).toBe(true);
    expect(delivered.some((k) => k.startsWith(`status:${D}:next_round:r1:`))).toBe(true);
    expect(delivered.filter((k) => k.startsWith(`followup:${B}:agreement_unsigned:`))).toHaveLength(1);
    expect(delivered.filter((k) => k.includes(C))).toEqual([]);
    expect(await outbound(C)).toEqual([]);
    for (const row of [...(await outbound(A)), ...(await outbound(B)), ...(await outbound(D))]) {
      expect(row.status).toBe("sent");
      expect(row.channel).toBe("whatsapp");
    }
  });

  it("a run twice sends once", async () => {
    const before = [...delivered];
    const rowsBefore = (await h.sql(`select 1 from public.outbound_messages`)).length;
    const again = await runAutopilot(h.service, NOON, deps);
    const third = await runAutopilot(h.service, new Date(NOON.getTime() + 10 * 60 * 1000), deps);
    expect(delivered).toEqual(before);
    expect(new Set(delivered).size).toBe(delivered.length);
    expect((await h.sql(`select 1 from public.outbound_messages`)).length).toBe(rowsBefore);
    expect(again.roundsSent).toEqual([]);
    expect(third.messagesSent).toBe(0);
    // Two runs at once: the database's unique key lets only one claim a message.
    const dup = await h.service.from("outbound_messages").insert({ user_id: B, dedupe_key: delivered.find((k) => k.startsWith(`followup:${B}`))!, kind: "followup", topic: "agreement_unsigned", step: 1, channel: "whatsapp", locale: "es", body: "x", status: "sending" });
    expect(dup.error?.code).toBe("23505");
    // A round already mailed is refused by send.ts if asked again.
    expect((await h.sql(`select 1 from public.attack_rounds where user_id = $1`, [A])).length).toBe(1);
  });

  it("a hold stops the automatic send after the window; released, the next run mails it as 'sistema'", async () => {
    expect((await placeHold(h.service, D, "Quiere revisar una carta", { userId: marta.userId, handle: "marta" })).ok).toBe(true);
    expect(await placeHold(h.service, D, "Otra vez", { userId: marta.userId, handle: "marta" })).toEqual({ ok: false, message: "Este cliente ya está detenido." });
    const held = await runAutopilot(h.service, LATER, deps);
    expect(held.roundsHeld).toBe(1);
    expect(await roundStatus(D)).toBeNull();
    expect((await releaseHold(h.service, D, { userId: marta.userId, handle: "marta" })).ok).toBe(true);
    const released = await runAutopilot(h.service, LATER, deps);
    expect(released.roundsSent.map((r) => r.userId)).toEqual([D]);
    expect(await roundStatus(D)).toMatchObject({ status: "mailed", sent_by_name: "sistema" });
    const event = await h.sql<{ kind: string }>(`select kind from public.events where user_id = $1 and kind = 'round_sent_automatically'`, [D]);
    expect(event).toHaveLength(1);
  });

  it("the opted-out client is still left alone a day later, and can opt back in", async () => {
    await runAutopilot(h.service, new Date(LATER.getTime() + 24 * HOUR), deps);
    expect(delivered.filter((k) => k.includes(C))).toEqual([]);
    await recordOptChange(h.service, { userId: C, kind: "opt_in", channel: "staff", keyword: "equipo", by: { userId: admin.userId, handle: "carmen" } });
    await runAutopilot(h.service, new Date(LATER.getTime() + 24 * HOUR), deps);
    expect(delivered.filter((k) => k.includes(C)).length).toBe(1);
  });
});

describe("autopilot records: read by role, written by the server, never rewritten", () => {
  it("a client reads their own messages and opt-outs, nobody else's, and none of the team's switches or holds", async () => {
    const own = async (who: string, table: string) => ((await h.as(who).from(table).select("*")).data as Array<{ user_id: string }>) ?? [];
    expect((await own(A, "outbound_messages")).length).toBeGreaterThan(0);
    expect((await own(A, "outbound_messages")).every((m) => m.user_id === A)).toBe(true);
    expect((await own(C, "message_opt_outs")).every((m) => m.user_id === C)).toBe(true);
    expect((await own(C, "message_opt_outs")).length).toBe(2);
    expect(await own(A, "autopilot_holds")).toEqual([]);
    expect(await own(A, "autopilot_settings")).toEqual([]);
    expect(await own(A, "autopilot_ready_rounds")).toEqual([]);
  });

  it("a specialist reads the messages and holds of the clients assigned to them; an administrator reads all", async () => {
    const rows = async (who: SupabaseClient, table: string) => ((await who.from(table).select("*")).data as Array<{ user_id: string }>) ?? [];
    const mine = await rows(h.as(marta.userId), "outbound_messages");
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((m) => m.user_id === A)).toBe(true);
    expect((await rows(h.as(marta.userId), "autopilot_holds")).length).toBe(0);
    expect((await rows(h.as(admin.userId), "autopilot_holds")).length).toBe(1);
    expect((await rows(h.as(admin.userId), "outbound_messages")).some((m) => m.user_id === D)).toBe(true);
    expect((await rows(h.as(marta.userId), "autopilot_settings")).length).toBe(1);
  });

  it("nobody writes them directly; the service role cannot rewrite or delete a message, or turn sent back into queued", async () => {
    for (const table of ["outbound_messages", "message_opt_outs", "autopilot_holds", "autopilot_settings", "autopilot_ready_rounds"]) {
      const insert = await h.as(admin.userId).from(table).insert({ user_id: A });
      expect(insert.error, table).not.toBeNull();
    }
    const update = await h.as(admin.userId).from("autopilot_settings").update({ rounds_enabled: false }).eq("id", true).select("id");
    expect((update.data as unknown[] | null) ?? []).toEqual([]);

    const [row] = await h.sql<{ id: string }>(`select id from public.outbound_messages where user_id = $1 and status = 'sent' limit 1`, [A]);
    expect((await h.service.from("outbound_messages").update({ body: "otra cosa" }).eq("id", row!.id)).error?.message).toMatch(/cannot be rewritten/);
    expect((await h.service.from("outbound_messages").update({ status: "queued" }).eq("id", row!.id)).error?.message).toMatch(/cannot become/);
    expect((await h.service.from("outbound_messages").delete().eq("id", row!.id)).error?.message).toMatch(/cannot be deleted/);
    expect((await h.service.from("message_opt_outs").delete().eq("user_id", C)).error?.message).toMatch(/cannot be deleted/);
    const [hold] = await h.sql<{ id: string }>(`select id from public.autopilot_holds where user_id = $1`, [D]);
    expect((await h.service.from("autopilot_holds").update({ reason: "cambiado" }).eq("id", hold!.id)).error?.message).toMatch(/released hold cannot be changed/);
    // SMS is not a channel the database accepts.
    const sms = await h.service.from("outbound_messages").insert({ user_id: A, dedupe_key: "followup:test:sms:1", kind: "followup", topic: "agreement_unsigned", step: 1, channel: "sms", body: "x", status: "sending" });
    expect(sms.error).not.toBeNull();
  });

  it("the console reads it all back: messages, the opt-out record, holds, and when each round was first seen ready", async () => {
    const { loadStaffClients } = await import("../../staff/load");
    const clients = await loadStaffClients(h.as(admin.userId));
    const a = clients.find((c) => c.id === A)!;
    expect(a.outbound?.map((m) => m.topic)).toEqual(["letters_mailed"]);
    expect(a.rounds[0]!.sentBy).toBe("sistema");
    const d = clients.find((c) => c.id === D)!;
    expect(d.holds?.[0]).toMatchObject({ by: "marta", reason: "Quiere revisar una carta", releasedBy: "marta" });
    const c = clients.find((x) => x.id === C)!;
    expect(c.optOut ?? null).toBeNull();
  });
});
