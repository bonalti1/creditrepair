import { beforeAll, describe, expect, it } from "vitest";
import { loadClientCaseFacts } from "../../case/server";
import { caseState, caseStatusSentence } from "../../case/timeline";
import { importReportForUser } from "../../domain/importReport";
import { pulseFromRow, pulseSummary, type PulseRow } from "../../pulse/pulse";
import { startHarness, type Harness } from "./pg";
import { addClient, addDocuments, addStaff, ago, assign, sampleReport, signAgreement } from "./seed";

// Migration 0018 and "Mi caso" on the real migrations: the case facts read
// through the client's own connection, and the satisfaction pulse (written
// only by the server, read by the client and by staff by role, never changed
// except for one first comment).

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
  A = await addClient(h, { name: "Rosa Martínez", referredBy: "ana" });
  B = await addClient(h, { name: "Luis Gómez", referredBy: "ana" });
  for (const client of [A, B]) {
    await signAgreement(h, client, { signedDaysAgo: 30 });
    await addDocuments(h, client);
    await importReportForUser(h.service, client, sampleReport(25));
  }
  await assign(h, A, marta.userId, admin.userId);
  // A's round 1: mailed 12 days ago, one certified letter delivered 8 days ago.
  const [round] = await h.sql<{ id: string }>(
    `insert into public.attack_rounds (user_id, round_number, status, mailed_at, created_at) values ($1, 1, 'mailed', $2, $3) returning id`,
    [A, ago(12), ago(14)],
  );
  await h.sql(
    `insert into public.letters (user_id, round_id, target_type, target_key, target_name, template_key, escalation_stage, body, status, mailed_at, mail_class, mail_status, delivered_at)
     values ($1, $2, 'bureau', 'equifax', 'Equifax', 'personal_info_cleanup', 'dispute', 'x', 'mailed', $3, 'certified', 'delivered', $4)`,
    [A, round!.id, ago(12), ago(8)],
  );
}, 60_000);

describe("Mi caso on the database", () => {
  it("reads the client's own case through their own connection", async () => {
    const facts = await loadClientCaseFacts(h.as(A), A);
    expect(facts.agreement?.signedAt).toBeTruthy();
    expect(facts.documents.map((d) => d.kind).sort()).toEqual(["government_id", "proof_of_address"]);
    expect(facts.reportImports).toHaveLength(1);
    expect(facts.review.total).toBeGreaterThan(0);
    expect(facts.rounds).toHaveLength(1);
    expect(facts.rounds[0]!.letters).toEqual([
      expect.objectContaining({ recipient: "Equifax", mailClass: "certified", status: "delivered" }),
    ]);
    expect(caseState(facts, new Date())).toBe("delivered");
    expect(caseStatusSentence(facts, "es")).toMatch(/^Tus cartas de la ronda 1 llegaron el/);
  });

  it("shows another client nothing of A's (row level security)", async () => {
    const facts = await loadClientCaseFacts(h.as(B), A);
    expect(facts.agreement).toBeNull();
    expect(facts.documents).toEqual([]);
    expect(facts.rounds).toEqual([]);
    expect(facts.reportImports).toEqual([]);
  });
});

describe("client_pulses (migration 0018)", () => {
  it("a client cannot write a pulse row directly, for themselves or anyone", async () => {
    const own = await h.as(A).from("client_pulses").insert({ user_id: A, moment: "agreement_signed", rating: 3 });
    expect(own.error).not.toBeNull();
    const other = await h.as(A).from("client_pulses").insert({ user_id: B, moment: "agreement_signed", rating: 1 });
    expect(other.error).not.toBeNull();
  });

  it("the server writes one answer per client per moment, and checks the values", async () => {
    expect((await h.service.from("client_pulses").insert({ user_id: A, moment: "agreement_signed", rating: 3 })).error).toBeNull();
    expect((await h.service.from("client_pulses").insert({ user_id: A, moment: "agreement_signed", rating: 1 })).error).not.toBeNull();
    expect((await h.service.from("client_pulses").insert({ user_id: A, moment: "first_round_mailed", rating: 4 })).error).not.toBeNull();
    expect((await h.service.from("client_pulses").insert({ user_id: A, moment: "whenever", rating: 2 })).error).not.toBeNull();
    expect((await h.service.from("client_pulses").insert({ user_id: B, moment: "first_round_mailed", rating: 1, comment: "Tardaron en contestarme." })).error).toBeNull();
  });

  it("allows one first comment, and no other change, even for the server", async () => {
    const first = await h.service.from("client_pulses").update({ comment: "Muy claro todo." }).eq("user_id", A).eq("moment", "agreement_signed");
    expect(first.error).toBeNull();
    const again = await h.service.from("client_pulses").update({ comment: "Otro." }).eq("user_id", A).eq("moment", "agreement_signed");
    expect(again.error).not.toBeNull();
    const rating = await h.service.from("client_pulses").update({ rating: 1 }).eq("user_id", B);
    expect(rating.error).not.toBeNull();
  });

  it("a client reads their own answers only", async () => {
    const { data } = await h.as(A).from("client_pulses").select("user_id, moment");
    expect((data as Array<{ user_id: string }>).map((r) => r.user_id)).toEqual([A]);
  });

  it("staff read by role: admin all, a specialist their clients, sales none; nobody on staff writes", async () => {
    const read = async (uid: string) => ((await h.as(uid).from("client_pulses").select("user_id")).data as unknown[]).length;
    expect(await read(admin.userId)).toBe(2);
    expect(await read(marta.userId)).toBe(1);
    expect(await read(jorge.userId)).toBe(0);
    expect(await read(ana.userId)).toBe(0);
    const write = await h.as(admin.userId).from("client_pulses").insert({ user_id: A, moment: "first_answer", rating: 3 });
    expect(write.error).not.toBeNull();
    await h.as(admin.userId).from("client_pulses").update({ comment: "editado" }).eq("user_id", B);
    await h.as(admin.userId).from("client_pulses").delete().eq("user_id", B);
    const [row] = await h.sql<{ comment: string | null }>(`select comment from public.client_pulses where user_id = $1`, [B]);
    expect(row!.comment).toBe("Tardaron en contestarme.");
  });

  it("feeds the business dashboard's summary", async () => {
    const { data } = await h.as(admin.userId).from("client_pulses").select("user_id, moment, rating, comment, created_at");
    const rows = ((data as Array<Record<string, unknown>>) ?? []).map(pulseFromRow).filter((r): r is PulseRow => r !== null);
    const summary = pulseSummary(rows);
    expect(summary.count).toBe(2);
    expect(summary.average).toBe(2);
    expect(summary.comments.map((c) => c.comment).sort()).toEqual(["Muy claro todo.", "Tardaron en contestarme."]);
  });
});
