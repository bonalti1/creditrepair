import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { importReportForUser } from "../../domain/importReport";
import { reasonsFor } from "../../letters/reasons";
import { builtinSource } from "../../letters/versions/source";
import { listLetterVersions, recordDecision, saveDraft, sendToAttorney } from "../../letters/versions/server";
import { builtinHash, contentHash, type LetterVersion } from "../../letters/versions/versions";
import { sendRound } from "../../rounds/send";
import { startHarness, type Harness } from "./pg";
import { addClient, addDocuments, addStaff, sampleReport, signAgreement } from "./seed";

// Letter versions (migration 0019) in the real migrations: who reads them,
// that only the server writes them, that a version sent to the attorney never
// changes, the editor's routes, and the readiness rule in the shared mailing
// code: a round is mailed only with attorney-approved text, rendered from that
// version and recorded with its number and hash.

const session = vi.hoisted(() => ({ reader: null as unknown, admin: null as unknown }));
vi.mock("@/lib/supabase/server", () => {
  const user = async () => {
    const reader = session.reader as SupabaseClient | null;
    return reader ? (await reader.auth.getUser()).data.user : null;
  };
  return {
    getServerSupabase: async () => session.reader,
    getSessionUser: user,
    resolveActingUser: async () => {
      const u = await user();
      return u ? { userId: u.id, via: "session" as const } : null;
    },
  };
});
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => session.admin }));

let h: Harness;
let ip = 0;
let admin: Awaited<ReturnType<typeof addStaff>>;
let marta: Awaited<ReturnType<typeof addStaff>>;
let ana: Awaited<ReturnType<typeof addStaff>>;
let client: string;

const as = (who: SupabaseClient | null) => {
  session.reader = who;
  session.admin = h.service;
};
const req = (path: string, body?: unknown) =>
  new Request(`https://app.test${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.9.${Math.floor(++ip / 250)}.${ip % 250}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, unknown> });
const carmen = () => ({ userId: admin.userId, name: "Carmen Ruiz" });
const today = () => new Date().toISOString().slice(0, 10);
const approve = (id: string, attorneyName = "Lic. Laura Benítez") =>
  recordDecision(h.service, id, { decision: "approved", attorneyName, decidedOn: today(), note: "Aprobada sin cambios.", confirmed: true }, carmen());

const EDITED_LINE = "I am asking you to review the personal information below and update my file.";

beforeAll(async () => {
  h = await startHarness();
  admin = await addStaff(h, "admin", "carmen", "Carmen Ruiz");
  marta = await addStaff(h, "specialist", "marta", "Marta Leal");
  ana = await addStaff(h, "sales", "ana", "Ana Prieto");
  client = await addClient(h, { name: "Rosa Martínez" });
  await signAgreement(h, client);
  await addDocuments(h, client);
  await importReportForUser(h.service, client, sampleReport(2));
  const { data: items } = await h.service.from("report_items").select("id, category").eq("user_id", client);
  for (const item of (items ?? []) as Array<{ id: string; category: "personal_info" | "tradeline" }>) {
    const attest = item.category === "personal_info";
    await h.service.from("item_flags").insert({
      user_id: client,
      item_id: item.id,
      state: attest ? "attested" : "correct",
      attested: attest,
      attestation_text: attest ? "I believe this item is inaccurate." : null,
      attestation_version: attest ? "v1" : null,
      attested_at: attest ? new Date().toISOString() : null,
      reason_code: attest ? reasonsFor("personal_info")[0]!.code : null,
    });
  }
}, 60_000);

afterEach(() => {
  delete process.env.LETTERS_ALLOW_UNAPPROVED;
});

describe("letter_template_versions: written by the server, frozen once sent", () => {
  let v2: LetterVersion;

  it("a draft is saved, rewritten, then sent to the attorney; version 1 gets its own row when it is sent", async () => {
    const builtin = builtinSource("dispute_611_inquiries");
    const first = await saveDraft(h.service, { templateKey: "dispute_611_inquiries", subject: builtin.subject, body: builtin.body.replace("I dispute", "I am disputing") }, carmen());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value).toMatchObject({ version: 2, origin: "edited", status: "draft", basedOn: 1, authorName: "Carmen Ruiz" });
    // Saving again rewrites the one draft.
    const again = await saveDraft(h.service, { templateKey: "dispute_611_inquiries", subject: builtin.subject, body: builtin.body.replace("I dispute", "I respectfully dispute") }, carmen());
    expect(again.ok && again.value.id).toBe(first.value.id);
    // Invalid text is refused on the server whatever the screen showed.
    const bad = await saveDraft(h.service, { templateKey: "dispute_611_inquiries", subject: builtin.subject, body: "We will remove every item. {inventada}" }, carmen());
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.problems.map((p) => p.code)).toEqual(expect.arrayContaining(["chip_unknown", "chip_missing", "guardrail"]));

    const sent = await sendToAttorney(h.service, ["dispute_611_inquiries", "dispute_611_accounts"], carmen());
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    v2 = sent.value.find((v) => v.templateKey === "dispute_611_inquiries")!;
    expect(v2).toMatchObject({ version: 2, status: "sent", sentByName: "Carmen Ruiz" });
    const v1 = sent.value.find((v) => v.templateKey === "dispute_611_accounts")!;
    expect(v1).toMatchObject({ version: 1, origin: "builtin", status: "sent", contentHash: builtinHash("dispute_611_accounts") });
    const [row] = await h.sql<{ content_hash: string; variables: string[] }>(`select content_hash, variables from public.letter_template_versions where id = $1`, [v2.id]);
    expect(row!.content_hash).toBe(contentHash("dispute_611_inquiries", v2));
    expect(row!.variables).toEqual(["partidas"]);
  });

  it("the text of a sent version cannot be changed, it cannot be deleted, and it moves only to a decision", async () => {
    await expect(h.sql(`update public.letter_template_versions set body = 'I changed it.' where id = $1`, [v2.id])).rejects.toThrow(/cannot be changed/);
    await expect(h.sql(`update public.letter_template_versions set version = 9 where id = $1`, [v2.id])).rejects.toThrow(/keeps its letter/);
    await expect(h.sql(`delete from public.letter_template_versions where id = $1`, [v2.id])).rejects.toThrow(/cannot be deleted/);
    await expect(h.sql(`update public.letter_template_versions set status = 'draft', sent_at = null where id = $1`, [v2.id])).rejects.toThrow();
    // A decision needs the attorney's name and the date.
    await expect(h.sql(`update public.letter_template_versions set status = 'approved' where id = $1`, [v2.id])).rejects.toThrow(/letter_versions_approved/);
  });

  it("the attorney's decision is recorded once and never changes", async () => {
    const decided = await approve(v2.id);
    expect(decided.ok && decided.value).toMatchObject({ status: "approved", approvedBy: "Lic. Laura Benítez", approvedAt: today(), recordedByName: "Carmen Ruiz" });
    expect((await approve(v2.id)).ok).toBe(false);
    await expect(h.sql(`update public.letter_template_versions set approved_by = 'Otra Persona' where id = $1`, [v2.id])).rejects.toThrow(/decision cannot be changed/);
    await expect(h.sql(`update public.letter_template_versions set status = 'rejected', rejected_by = 'X Y Z', rejected_at = current_date, rejection_note = 'n' where id = $1`, [v2.id])).rejects.toThrow();
  });

  it("a draft can be thrown away; one open draft per letter", async () => {
    const builtin = builtinSource("goodwill_adjustment");
    const draft = await saveDraft(h.service, { templateKey: "goodwill_adjustment", subject: builtin.subject, body: `${builtin.body}\n\nThank you again.` }, carmen());
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    const dup = await h.service.from("letter_template_versions").insert({
      template_key: "goodwill_adjustment",
      version: 7,
      origin: "edited",
      subject: "x",
      body: "y",
      content_hash: "c".repeat(64),
      author_name: "x",
    });
    expect(dup.error?.message).toMatch(/letter_versions_one_draft|duplicate/);
    await h.sql(`delete from public.letter_template_versions where id = $1`, [draft.value.id]);
    expect(await h.sql(`select 1 from public.letter_template_versions where id = $1`, [draft.value.id])).toEqual([]);
  });

  it("who reads: the administrator every version, a specialist the approved ones, sales and clients none; nobody else writes", async () => {
    const statuses = async (who: SupabaseClient) => ((await listLetterVersions(who)) ?? []).map((v) => `${v.templateKey}:${v.version}:${v.status}`).sort();
    expect(await statuses(h.as(admin.userId))).toEqual(["dispute_611_accounts:1:sent", "dispute_611_inquiries:2:approved"]);
    expect(await statuses(h.as(marta.userId))).toEqual(["dispute_611_inquiries:2:approved"]);
    expect(await statuses(h.as(ana.userId))).toEqual([]);
    expect(await statuses(h.as(client))).toEqual([]);
    expect(await statuses(h.anon)).toEqual([]);
    const insert = await h.as(admin.userId).from("letter_template_versions").insert({
      template_key: "mov_request",
      version: 2,
      origin: "edited",
      subject: "x",
      body: "y",
      content_hash: "d".repeat(64),
      author_name: "carmen",
    });
    expect(insert.error).not.toBeNull();
    const update = await h.as(admin.userId).from("letter_template_versions").update({ status: "approved" }).eq("id", v2.id).select("id");
    expect((update.data as unknown[] | null) ?? []).toEqual([]);
  });
});

describe("the editor's routes", () => {
  it("GET and POST /api/staff/letters are for administrators; the approved texts for anyone who works a case", async () => {
    const route = await import("@/app/api/staff/letters/route");
    const approved = await import("@/app/api/staff/letters/approved/route");
    as(h.as(marta.userId));
    expect((await route.GET(req("/api/staff/letters"))).status).toBe(403);
    expect((await route.POST(req("/api/staff/letters", { action: "send_to_attorney", templateKeys: ["mov_request"] }))).status).toBe(403);
    const forMarta = await json(await approved.GET(req("/api/staff/letters/approved")));
    expect(forMarta.status).toBe(200);
    expect((forMarta.body.versions as LetterVersion[]).every((v) => v.status === "approved")).toBe(true);
    as(h.as(ana.userId));
    expect((await approved.GET(req("/api/staff/letters/approved"))).status).toBe(403);
    as(h.as(client));
    expect((await route.GET(req("/api/staff/letters"))).status).toBe(403);

    as(h.as(admin.userId));
    const list = await json(await route.GET(req("/api/staff/letters")));
    expect(list.status).toBe(200);
    expect((list.body.versions as LetterVersion[]).length).toBe(2);
    // Strict bodies.
    expect((await route.POST(req("/api/staff/letters", { action: "save_draft", templateKey: "mov_request", subject: "x", body: "y", by: "Impostor" }))).status).toBe(400);
    expect((await route.POST(req("/api/staff/letters", { action: "publish", templateKey: "mov_request" }))).status).toBe(400);
    // The text is checked on the server.
    const invalid = await json(await route.POST(req("/api/staff/letters", { action: "save_draft", templateKey: "mov_request", subject: "Re: hola", body: "Credalti guarantees deletion." })));
    expect(invalid.status).toBe(422);
    expect((invalid.body.problems as Array<{ code: string }>).map((p) => p.code)).toEqual(expect.arrayContaining(["chip_missing", "company_named", "frame"]));
    // An approval needs the confirmation that it is the attorney's.
    const sent = await json(await route.POST(req("/api/staff/letters", { action: "send_to_attorney", templateKeys: ["mov_request"] })));
    expect(sent.status).toBe(200);
    const [mov] = sent.body.result as LetterVersion[];
    const unconfirmed = await route.POST(req("/api/staff/letters", { action: "record_decision", id: mov!.id, decision: "approved", attorneyName: "Lic. Laura Benítez", decidedOn: today(), note: "", confirmed: false }));
    expect(unconfirmed.status).toBe(422);
    const ok = await json(await route.POST(req("/api/staff/letters", { action: "record_decision", id: mov!.id, decision: "approved", attorneyName: "Lic. Laura Benítez", decidedOn: today(), note: "", confirmed: true })));
    expect(ok.status).toBe(200);
    // Signed with the member's own name from their staff row.
    expect(ok.body.result).toMatchObject({ status: "approved", recordedByName: "Carmen Ruiz" });
  });
});

describe("what is mailed: only attorney-approved text (rounds/send.ts, step 6)", () => {
  const send = (now = new Date()) =>
    sendRound(h.service, { userId: client, roundNumber: 1, sender: { kind: "staff", userId: admin.userId, name: "carmen" }, requireAgreement: true, via: "print", now });

  it("refuses a round whose letter has no approved version, and mails nothing", async () => {
    const result = await send();
    expect(result).toMatchObject({ ok: false, status: 409, code: "letters_not_approved" });
    if (!result.ok) expect(result.error).toMatch(/personal_info_cleanup/);
    expect(await h.sql(`select 1 from public.letters where user_id = $1`, [client])).toEqual([]);
    expect(await h.sql(`select 1 from public.attack_rounds where user_id = $1`, [client])).toEqual([]);
  });

  it("mails the newest approved version, and each letter records its version and hash", async () => {
    const builtin = builtinSource("personal_info_cleanup");
    const draft = await saveDraft(
      h.service,
      { templateKey: "personal_info_cleanup", subject: builtin.subject, body: builtin.body.replace("I am writing to request that you update the personal information on my credit file.", EDITED_LINE) },
      carmen(),
    );
    expect(draft.ok).toBe(true);
    const sent = await sendToAttorney(h.service, ["personal_info_cleanup"], carmen());
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    const version = sent.value[0]!;
    // Still with the attorney: not yet.
    expect(await send()).toMatchObject({ ok: false, code: "letters_not_approved" });
    await approve(version.id);

    const result = await send();
    expect(result).toMatchObject({ ok: true, roundNumber: 1 });
    const letters = await h.sql<{ body: string; template_version: number; template_hash: string }>(
      `select body, template_version, template_hash from public.letters where user_id = $1`,
      [client],
    );
    expect(letters.length).toBeGreaterThan(0);
    for (const letter of letters) {
      expect(letter.template_version).toBe(2);
      expect(letter.template_hash).toBe(version.contentHash);
      expect(letter.body).toContain(EDITED_LINE);
      expect(letter.body).toContain("Rosa Martínez");
      expect(letter.body).toMatch(/Sincerely,\n\nRosa Martínez/);
    }
  });

  it("LETTERS_ALLOW_UNAPPROVED=1 lets an unapproved letter go, rendered from version 1 and recorded as such", async () => {
    const other = await addClient(h, { name: "Prueba Sinaprobar" });
    await signAgreement(h, other);
    await addDocuments(h, other);
    await importReportForUser(h.service, other, sampleReport(2));
    const { data: items } = await h.service.from("report_items").select("id, category").eq("user_id", other).eq("category", "personal_info");
    for (const item of (items ?? []) as Array<{ id: string }>) {
      await h.service.from("item_flags").insert({
        user_id: other,
        item_id: item.id,
        state: "attested",
        attested: true,
        attestation_text: "I believe this item is inaccurate.",
        attestation_version: "v1",
        attested_at: new Date().toISOString(),
        reason_code: reasonsFor("personal_info")[0]!.code,
      });
    }
    // An unapproved text is a letter no round can use: it is checked per template.
    const loadNone = async () => [] as LetterVersion[];
    const blocked = await sendRound(h.service, { userId: other, roundNumber: 1, sender: { kind: "staff", userId: admin.userId, name: "carmen" }, requireAgreement: true, via: "print", deps: { loadLetterVersions: loadNone } });
    expect(blocked).toMatchObject({ ok: false, code: "letters_not_approved" });
    process.env.LETTERS_ALLOW_UNAPPROVED = "1";
    const allowed = await sendRound(h.service, { userId: other, roundNumber: 1, sender: { kind: "staff", userId: admin.userId, name: "carmen" }, requireAgreement: true, via: "print", deps: { loadLetterVersions: loadNone } });
    expect(allowed).toMatchObject({ ok: true });
    const [letter] = await h.sql<{ template_version: number; template_hash: string }>(`select template_version, template_hash from public.letters where user_id = $1 limit 1`, [other]);
    expect(letter).toEqual({ template_version: 1, template_hash: builtinHash("personal_info_cleanup") });
  });
});
