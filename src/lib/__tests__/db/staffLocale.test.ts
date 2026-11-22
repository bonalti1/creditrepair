import { beforeAll, describe, expect, it } from "vitest";
import { importReportForUser } from "../../domain/importReport";
import { libraryReplyFor } from "../../staff/answers";
import { changeSavedAnswer, listSavedAnswers, loadApprovedAnswers } from "../../staff/answersServer";
import { runStaffDigests, type DigestDeliver } from "../../staff/digestServer";
import { applyPreferencesUpdate, DEFAULT_PREFERENCES, preferencesFromRow, preferencesToRow } from "../../staff/preferences";
import { startHarness, type Harness } from "./pg";
import { addClient, addDocuments, addStaff, ago, sampleReport, signAgreement } from "./seed";

// Migration 0025 on the real migrations: each member's console language
// (staff_preferences.locale, nothing until they choose: English), and the
// language each saved answer is written in (saved_answers.language; answers
// from before are Spanish), recorded in its history too.

let h: Harness;
let admin: Awaited<ReturnType<typeof addStaff>>;
let marta: Awaited<ReturnType<typeof addStaff>>;

beforeAll(async () => {
  h = await startHarness();
  admin = await addStaff(h, "admin", "carmen", "Carmen Ruiz");
  marta = await addStaff(h, "specialist", "marta", "Marta Leal");
  const client = await addClient(h, { name: "Rosa Martínez", referredBy: "carmen" });
  await signAgreement(h, client, { signedDaysAgo: 30 });
  await addDocuments(h, client);
  await importReportForUser(h.service, client, sampleReport(25));
  await h.sql(`insert into public.events (user_id, kind, payload, created_at) values ($1, 'question_escalated', $2, $3)`, [
    client,
    JSON.stringify({ text: "When do my letters go out?" }),
    ago(1),
  ]);
}, 60_000);

describe("migration 0025: the member's console language", () => {
  it("is empty until the member chooses, and only English or Spanish", async () => {
    await h.service.from("staff_preferences").upsert({ user_id: marta.userId, digest_enabled: false });
    const [row] = await h.sql<{ locale: string | null }>(`select locale from public.staff_preferences where user_id = $1`, [marta.userId]);
    expect(row!.locale).toBeNull();
    await h.sql(`update public.staff_preferences set locale = 'es' where user_id = $1`, [marta.userId]);
    await h.sql(`update public.staff_preferences set locale = 'en' where user_id = $1`, [marta.userId]);
    await expect(h.sql(`update public.staff_preferences set locale = 'fr' where user_id = $1`, [marta.userId])).rejects.toThrow();
    await h.sql(`update public.staff_preferences set locale = null where user_id = $1`, [marta.userId]);
  });

  it("is saved the way the route saves it and read back through the member's own connection", async () => {
    const now = new Date();
    const next = applyPreferencesUpdate(DEFAULT_PREFERENCES, { locale: "es" }, now);
    const { error } = await h.service.from("staff_preferences").upsert(preferencesToRow(marta.userId, next, now));
    expect(error).toBeNull();
    const { data } = await h.as(marta.userId).from("staff_preferences").select("*").eq("user_id", marta.userId).maybeSingle();
    expect(preferencesFromRow(data as Record<string, unknown> | null).locale).toBe("es");
    // Nobody else reads it, and the member cannot write it directly.
    expect((await h.as(admin.userId).from("staff_preferences").select("locale").eq("user_id", marta.userId)).data).toEqual([]);
    await h.as(marta.userId).from("staff_preferences").update({ locale: "en" }).eq("user_id", marta.userId);
    const [row] = await h.sql<{ locale: string }>(`select locale from public.staff_preferences where user_id = $1`, [marta.userId]);
    expect(row!.locale).toBe("es");
  });

  it("the morning summary goes in English to a member who chose nothing", async () => {
    await h.sql(`update public.staff_members set email = 'carmen@example.test' where user_id = $1`, [admin.userId]);
    await h.service.from("staff_preferences").upsert({ user_id: admin.userId, digest_enabled: true, digest_channel: "email", digest_time: "08:30" });
    const sent: string[] = [];
    const deliver: DigestDeliver = async (_member, summary) => {
      sent.push(summary.text);
      return { ok: true };
    };
    const channels = { whatsapp: false, email: true, approvedTemplates: [] as string[], simulated: false };
    const result = await runStaffDigests(h.service, new Date("2026-12-07T15:00:00.000Z"), { channels, deliver, base: "https://app.test" });
    expect(result).toMatchObject({ sent: 1 });
    expect(sent[0]).toMatch(/^Good morning, Carmen\. Today: /);
  });
});

describe("migration 0025: the language of a saved answer", () => {
  it("answers saved before it are Spanish; only English or Spanish", async () => {
    const [row] = await h.sql<{ id: string; language: string }>(
      `insert into public.saved_answers (question, answer, status, created_by, created_by_name) values ('¿Cuándo?', 'Pronto, te avisamos por aquí.', 'proposed', $1, 'Carmen') returning id, language`,
      [admin.userId],
    );
    expect(row!.language).toBe("es");
    await expect(h.sql(`update public.saved_answers set language = 'fr' where id = $1`, [row!.id])).rejects.toThrow();
    await h.sql(`delete from public.saved_answers where id = $1`, [row!.id]);
  });

  it("is kept with the answer and its history, and an answer goes only to a client in its language", async () => {
    const english = await changeSavedAnswer(h.service, admin, {
      action: "save",
      question: "When do my letters go out?",
      answer: "Your letters go out once you finish reviewing your report and your 3-business-day cancellation period ends. Our team prepares them and mails them.",
      language: "en",
    });
    expect(english).toMatchObject({ ok: true, answer: { status: "approved", language: "en" } });
    const spanish = await changeSavedAnswer(h.service, admin, {
      action: "save",
      question: "¿Cuándo salen mis cartas?",
      answer: "Tus cartas salen en cuanto terminas la revisión de tu reporte y pasan los 3 días hábiles de tu periodo de cancelación.",
    });
    expect(spanish).toMatchObject({ ok: true, answer: { language: "es" } });
    const listed = await listSavedAnswers(h.as(admin.userId));
    expect(listed.map((a) => a.language).sort()).toEqual(["en", "es"]);
    const events = await h.sql<{ language: string | null }>(`select language from public.saved_answer_events order by created_at`);
    expect(events.map((e) => e.language)).toEqual(expect.arrayContaining(["en", "es"]));
    const approved = await loadApprovedAnswers(h.service);
    expect(libraryReplyFor("When do my letters go out?", approved, "en")?.answer.language).toBe("en");
    expect(libraryReplyFor("When do my letters go out?", approved.filter((a) => a.language === "es"), "en")).toBeNull();
  });
});
