import { beforeAll, describe, expect, it } from "vitest";
import { importReportForUser } from "../../domain/importReport";
import { changeSavedAnswer, listSavedAnswers, loadApprovedAnswers } from "../../staff/answersServer";
import { runStaffDigests, type DigestDeliver } from "../../staff/digestServer";
import { draftReply, type DraftCaller } from "../../staff/drafts";
import { loadStaffClients } from "../../staff/load";
import { libraryReplyFor } from "../../staff/answers";
import { startHarness, type Harness } from "./pg";
import { addClient, addDocuments, addStaff, ago, assign, sampleReport, signAgreement } from "./seed";

// Migration 0020 on the real migrations: saved answers (written by the
// server after the role check, read by role, every change recorded), each
// member's preferences, the morning summary sent once per member per day, and
// the pulse and AltiBot's drafts read through the member's own connection.

let h: Harness;
let A: string;
let B: string;
let admin: Awaited<ReturnType<typeof addStaff>>;
let marta: Awaited<ReturnType<typeof addStaff>>;
let jorge: Awaited<ReturnType<typeof addStaff>>;
let ana: Awaited<ReturnType<typeof addStaff>>;

beforeAll(async () => {
  h = await startHarness();
  admin = await addStaff(h, "admin", "carmen", "Carmen Ruiz");
  marta = await addStaff(h, "specialist", "marta", "Marta Leal");
  jorge = await addStaff(h, "specialist", "jorge", "Jorge Paz");
  ana = await addStaff(h, "sales", "ana", "Ana Prieto");
  await h.sql(`update public.staff_members set phone_e164 = '+17135550191' where user_id = $1`, [marta.userId]);
  A = await addClient(h, { name: "Rosa Martínez", referredBy: "ana" });
  B = await addClient(h, { name: "Luis Gómez", referredBy: "ana" });
  for (const client of [A, B]) {
    await signAgreement(h, client, { signedDaysAgo: 30 });
    await addDocuments(h, client);
    await importReportForUser(h.service, client, sampleReport(25));
  }
  await assign(h, A, marta.userId, admin.userId);
  await assign(h, B, jorge.userId, admin.userId);
  // Rosa asked something AltiBot passed to the team.
  await h.sql(`insert into public.events (user_id, kind, payload, created_at) values ($1, 'question_escalated', $2, $3)`, [
    A,
    JSON.stringify({ text: "¿Cuándo salen mis cartas?" }),
    ago(1),
  ]);
  await h.sql(`insert into public.chat_messages (user_id, channel, role, source, body, created_at) values ($1, 'app', 'user', 'coach', '¿Cuándo salen mis cartas?', $2)`, [A, ago(1)]);
  // Her pulse, and Luis's.
  await h.sql(`insert into public.client_pulses (user_id, moment, rating, comment) values ($1, 'agreement_signed', 3, 'Muy claro todo.'), ($2, 'agreement_signed', 1, 'Nadie me llamó.')`, [A, B]);
}, 60_000);

const ANSWER = "Tus cartas salen en cuanto terminas la revisión de tu reporte y pasan los 3 días hábiles de tu periodo de cancelación. Nuestro equipo las prepara y las envía por correo.";

describe("saved answers on the database", () => {
  let proposalId = "";

  it("a specialist's goes in as a proposal; an administrator's goes in approved; sales cannot save", async () => {
    const proposal = await changeSavedAnswer(h.service, marta, { action: "save", question: "¿Cuándo salen mis cartas?", answer: ANSWER, clientFirstName: "Rosa" });
    expect(proposal).toMatchObject({ ok: true, answer: { status: "proposed", createdBy: "marta", approvedBy: null } });
    proposalId = proposal.ok ? proposal.answer!.id : "";
    const direct = await changeSavedAnswer(h.service, admin, {
      action: "save",
      question: "¿Tengo que mandar algo por correo yo?",
      answer: "No. Nuestro equipo prepara tus cartas y las envía por correo; tú revisas tu reporte en la app.",
    });
    expect(direct).toMatchObject({ ok: true, answer: { status: "approved", approvedBy: "carmen" } });
    expect(await changeSavedAnswer(h.service, ana, { action: "save", question: "¿Cuándo salen mis cartas?", answer: ANSWER })).toMatchObject({ ok: false, status: 403 });
  });

  it("refuses a promise or the client's name before anything is stored", async () => {
    const promise = await changeSavedAnswer(h.service, admin, { action: "save", question: "¿Me van a borrar la cuenta?", answer: "Sí, eliminamos esa cuenta de tu reporte muy pronto." });
    expect(promise).toMatchObject({ ok: false, status: 422, code: "answer_rules" });
    const named = await changeSavedAnswer(h.service, admin, { action: "save", question: "¿Cuándo salen mis cartas?", answer: `Hola Rosa. ${ANSWER}`, clientFirstName: "Rosa" });
    expect(named).toMatchObject({ ok: false, status: 422 });
    const rows = await h.sql<{ n: number }>(`select count(*)::int as n from public.saved_answers`);
    expect(rows[0]!.n).toBe(2);
  });

  it("read by role: approved for admins and specialists, a proposal for admins and its author, nothing for sales", async () => {
    const forAdmin = await listSavedAnswers(h.as(admin.userId));
    expect(forAdmin.map((a) => a.status).sort()).toEqual(["approved", "proposed"]);
    expect((await listSavedAnswers(h.as(marta.userId))).map((a) => a.status).sort()).toEqual(["approved", "proposed"]);
    expect((await listSavedAnswers(h.as(jorge.userId))).map((a) => a.status)).toEqual(["approved"]);
    expect(await listSavedAnswers(h.as(ana.userId))).toEqual([]);
    expect(await listSavedAnswers(h.as(A))).toEqual([]);
  });

  it("nobody writes the table directly", async () => {
    const { error } = await h.as(admin.userId).from("saved_answers").insert({ question: "¿Una pregunta cualquiera?", answer: ANSWER, status: "approved", created_by_name: "x", approved_by_name: "x", approved_at: new Date().toISOString() });
    expect(error).not.toBeNull();
    // Approved means approved by someone, on a date.
    await expect(h.sql(`insert into public.saved_answers (question, answer, status, created_by_name) values ('¿Una pregunta cualquiera?', $1, 'approved', 'x')`, [ANSWER])).rejects.toThrow();
  });

  it("only an administrator approves; AltiBot uses it only once it is approved", async () => {
    expect(libraryReplyFor("¿Cuándo salen mis cartas?", await loadApprovedAnswers(h.service))).toBeNull();
    expect(await changeSavedAnswer(h.service, marta, { action: "approve", id: proposalId })).toMatchObject({ ok: false, status: 403 });
    expect(await changeSavedAnswer(h.service, jorge, { action: "edit", id: proposalId, question: "¿Cuándo salen?", answer: ANSWER })).toMatchObject({ ok: false, status: 403 });
    expect(await changeSavedAnswer(h.service, admin, { action: "approve", id: proposalId })).toMatchObject({ ok: true, answer: { status: "approved", approvedBy: "carmen" } });
    expect(libraryReplyFor("cuando salen mis cartas", await loadApprovedAnswers(h.service))?.answer.id).toBe(proposalId);
    // Once approved, its author can no longer change or withdraw it.
    expect(await changeSavedAnswer(h.service, marta, { action: "delete", id: proposalId })).toMatchObject({ ok: false, status: 403 });
  });

  it("every change is recorded with the words, and the record cannot be rewritten", async () => {
    const events = await h.sql<{ kind: string; actor_name: string }>(`select kind, actor_name from public.saved_answer_events where answer_id = $1 order by created_at`, [proposalId]);
    expect(events.map((e) => `${e.kind}:${e.actor_name}`)).toEqual(["saved:marta", "approved:carmen"]);
    await expect(h.sql(`update public.saved_answer_events set answer = 'otra cosa' where answer_id = $1`, [proposalId])).rejects.toThrow(/cannot be changed/);
    await expect(h.sql(`delete from public.saved_answer_events where answer_id = $1`, [proposalId])).rejects.toThrow(/cannot be changed/);
    expect(await changeSavedAnswer(h.service, admin, { action: "delete", id: proposalId })).toMatchObject({ ok: true });
    const after = await h.sql<{ kind: string }>(`select kind from public.saved_answer_events where answer_id = $1 order by created_at`, [proposalId]);
    expect(after.map((e) => e.kind)).toEqual(["saved", "approved", "deleted"]);
    // Only an administrator reads the history.
    expect((await h.as(marta.userId).from("saved_answer_events").select("*")).data).toEqual([]);
  });
});

describe("the pulse and drafts through the member's own connection", () => {
  it("pulses: an administrator reads every client's, a specialist only their assigned client's, sales none", async () => {
    const forAdmin = await loadStaffClients(h.as(admin.userId));
    expect(forAdmin.flatMap((c) => c.pulses ?? []).map((p) => p.comment).sort()).toEqual(["Muy claro todo.", "Nadie me llamó."]);
    const forMarta = await loadStaffClients(h.as(marta.userId));
    expect(forMarta.flatMap((c) => c.pulses ?? []).map((p) => p.comment)).toEqual(["Muy claro todo."]);
    const forAna = await loadStaffClients(h.as(ana.userId));
    expect(forAna.flatMap((c) => c.pulses ?? [])).toEqual([]);
  });

  it("a draft for the assigned specialist uses the client's waiting question and the case as their role reads it", async () => {
    const [rosa] = await loadStaffClients(h.as(marta.userId), { clientId: A });
    expect(rosa?.questions.map((q) => q.answeredAt)).toEqual([null]);
    const seen: string[] = [];
    const caller: DraftCaller = async (call) => {
      seen.push(call.user);
      return { reply: "Hola Rosa. Tus cartas salen en cuanto terminas tu revisión; nuestro equipo las prepara y las envía.", problem: null };
    };
    const outcome = await draftReply({ client: rosa!, role: marta.role, now: new Date(), savedAnswers: await loadApprovedAnswers(h.service) }, caller);
    expect(outcome, JSON.stringify(outcome)).toMatchObject({ ok: true });
    expect(seen[0]).toMatch(/PREGUNTA QUE HAY QUE RESPONDER: ¿Cuándo salen mis cartas\?/);
    expect(seen[0]).not.toContain("+1713555");
    // Another specialist cannot even read the case to draft for it.
    expect(await loadStaffClients(h.as(jorge.userId), { clientId: A })).toEqual([]);
  });
});

describe("member preferences and the morning summary", () => {
  it("a member reads only their own preferences; nobody writes them directly", async () => {
    await h.service.from("staff_preferences").upsert({ user_id: marta.userId, digest_enabled: true, digest_channel: "whatsapp", digest_time: "08:30" });
    expect((await h.as(marta.userId).from("staff_preferences").select("user_id")).data).toEqual([{ user_id: marta.userId }]);
    expect((await h.as(admin.userId).from("staff_preferences").select("user_id")).data).toEqual([]);
    const { error } = await h.as(marta.userId).from("staff_preferences").update({ digest_time: "05:00" }).eq("user_id", marta.userId);
    const [row] = await h.sql<{ digest_time: string }>(`select digest_time from public.staff_preferences where user_id = $1`, [marta.userId]);
    expect(error !== null || row!.digest_time === "08:30").toBe(true);
    expect(row!.digest_time).toBe("08:30");
    await expect(h.sql(`update public.staff_preferences set digest_time = '8:30am' where user_id = $1`, [marta.userId])).rejects.toThrow();
  });

  it("sends once per member per day, after their time, by the channel that can carry it; a second run sends nothing", async () => {
    const sent: Array<{ handle: string; channel: string | null; text: string }> = [];
    const deliver: DigestDeliver = async (member, summary, choice) => {
      sent.push({ handle: member.handle, channel: choice.channel, text: summary.text });
      return { ok: true };
    };
    const channels = { whatsapp: true, email: true, approvedTemplates: ["credalti_resumen_equipo"], simulated: false };
    // 7:00 a.m. in Texas: not yet.
    const early = new Date("2026-12-07T13:00:00.000Z");
    expect(await runStaffDigests(h.service, early, { channels, deliver, base: "https://app.test" })).toMatchObject({ sent: 0, waiting: 1 });
    // 9:00 a.m.: Marta's goes, by WhatsApp with the template, with only her assigned client's work.
    const nine = new Date("2026-12-07T15:00:00.000Z");
    expect(await runStaffDigests(h.service, nine, { channels, deliver, base: "https://app.test" })).toMatchObject({ members: 1, sent: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ handle: "marta", channel: "whatsapp" });
    expect(sent[0]!.text).toMatch(/^Buenos días, Marta\. Hoy: /);
    expect(sent[0]!.text).toContain("https://app.test/equipo?siguiente=1");
    expect(sent[0]!.text).not.toContain("Luis");
    // Again the same morning: nothing.
    expect(await runStaffDigests(h.service, new Date("2026-12-07T16:00:00.000Z"), { channels, deliver })).toMatchObject({ sent: 0 });
    expect(sent).toHaveLength(1);
    const rows = await h.sql<{ status: string; channel: string; local_day: string }>(`select status, channel, local_day::text from public.staff_digests where user_id = $1`, [marta.userId]);
    expect(rows).toEqual([{ status: "sent", channel: "whatsapp", local_day: "2026-12-07" }]);
  });

  it("what was sent cannot be rewritten, and never by SMS", async () => {
    await expect(h.sql(`update public.staff_digests set body = 'otra cosa' where user_id = $1`, [marta.userId])).rejects.toThrow(/cannot be changed/);
    await expect(h.sql(`delete from public.staff_digests where user_id = $1`, [marta.userId])).rejects.toThrow(/cannot be deleted/);
    await expect(h.sql(`insert into public.staff_digests (user_id, local_day, channel, status, body) values ($1, '2026-12-08', 'sms', 'sending', 'x')`, [marta.userId])).rejects.toThrow();
    // Only the member (and an administrator) reads them.
    expect((await h.as(marta.userId).from("staff_digests").select("user_id")).data).toHaveLength(1);
    expect((await h.as(jorge.userId).from("staff_digests").select("user_id")).data).toEqual([]);
  });

  it("with no channel that can carry it, nothing is claimed for the day", async () => {
    await h.service.from("staff_preferences").upsert({ user_id: jorge.userId, digest_enabled: true, digest_channel: "email", digest_time: "08:30" });
    const none = { whatsapp: false, email: false, approvedTemplates: [] as string[], simulated: false };
    const result = await runStaffDigests(h.service, new Date("2026-12-08T15:00:00.000Z"), { channels: none, deliver: async () => ({ ok: true }) });
    expect(result).toMatchObject({ sent: 0, noChannel: 2 });
    expect(await h.sql(`select 1 from public.staff_digests where local_day = '2026-12-08'`)).toEqual([]);
  });
});
