import { beforeAll, describe, expect, it } from "vitest";
import { importReportForUser } from "../../domain/importReport";
import { recordIntake } from "../../intake/server";
import { NO_USAGE } from "../../intake/cost";
import { loadStaffClients } from "../../staff/load";
import { clientExceptions } from "../../staff/stage";
import { startHarness, type Harness } from "./pg";
import { addClient, addDocuments, addStaff, assign, sampleReport, signAgreement } from "./seed";

// AI intake's table (migration 0016) in the real migrations: who reads what,
// nobody but the server writes, records are not edited, and the console turns
// a document that needs a person into a notice.

let h: Harness;
let A: string;
let B: string;
let admin: Awaited<ReturnType<typeof addStaff>>;
let marta: Awaited<ReturnType<typeof addStaff>>;
let ana: Awaited<ReturnType<typeof addStaff>>;

const base = { simulated: false, model: "claude-opus-5-5", usage: NO_USAGE, costUsd: 0.03 };

beforeAll(async () => {
  h = await startHarness();
  admin = await addStaff(h, "admin", "carmen", "Carmen Ruiz");
  marta = await addStaff(h, "specialist", "marta", "Marta Leal");
  ana = await addStaff(h, "sales", "ana", "Ana Prieto");
  A = await addClient(h, { name: "Rosa Martínez", referredBy: "ana" });
  B = await addClient(h, { name: "Luis Gómez", referredBy: "luis" });
  for (const client of [A, B]) {
    await signAgreement(h, client);
    await addDocuments(h, client);
    await importReportForUser(h.service, client, sampleReport(3));
  }
  await assign(h, A, marta.userId, admin.userId);
  await recordIntake(h.service, { ...base, userId: A, kind: "government_id", status: "accepted", reasons: ["Es una licencia de conducir."], uploadedBy: A, role: "client" });
  await recordIntake(h.service, { ...base, userId: A, kind: "proof_of_address", status: "needs_person", reasons: ["La dirección del documento no coincide con tu dirección postal en la cuenta."], uploadedBy: A, role: "client" });
  await recordIntake(h.service, { ...base, userId: A, kind: "credit_report", status: "read", reasons: [], result: { envelope: { secret: true } }, uploadedBy: marta.userId, role: "staff" });
  await recordIntake(h.service, {
    ...base,
    userId: A,
    kind: "bureau_letter",
    status: "needs_person",
    reasons: ["La carta pide más información o documentos."],
    result: { letter: { bureau: "equifax", letterDate: "2026-11-15", items: [] } },
    uploadedBy: A,
    role: "client",
  });
  await recordIntake(h.service, { ...base, userId: B, kind: "government_id", status: "accepted", reasons: ["ok"], uploadedBy: B, role: "client" });
}, 60_000);

const kinds = async (who: string) => {
  const { data, error } = await h.as(who).from("intake_documents").select("kind, user_id");
  if (error) throw new Error(error.message);
  return (data as Array<{ kind: string; user_id: string }>).map((r) => `${r.user_id === A ? "A" : "B"}:${r.kind}`).sort();
};

describe("intake_documents", () => {
  it("a client reads their own checks and letters, not the report readings, and nobody else's", async () => {
    expect(await kinds(A)).toEqual(["A:bureau_letter", "A:government_id", "A:proof_of_address"]);
    expect(await kinds(B)).toEqual(["B:government_id"]);
  });

  it("staff read by role: the specialist their client's case, sales only the documents, the admin everything", async () => {
    expect(await kinds(marta.userId)).toEqual(["A:bureau_letter", "A:credit_report", "A:government_id", "A:proof_of_address"]);
    expect(await kinds(ana.userId)).toEqual(["A:government_id", "A:proof_of_address"]);
    expect((await kinds(admin.userId)).length).toBe(5);
  });

  it("nobody but the server writes, and a record is never edited", async () => {
    const insert = await h.as(A).from("intake_documents").insert({ user_id: A, kind: "government_id", status: "accepted", uploaded_by_role: "client" });
    expect(insert.error).not.toBeNull();
    const asStaff = await h.as(admin.userId).from("intake_documents").insert({ user_id: A, kind: "government_id", status: "accepted", uploaded_by_role: "staff" });
    expect(asStaff.error).not.toBeNull();
    const edit = await h.service.from("intake_documents").update({ status: "accepted" }).eq("user_id", A);
    expect(edit.error?.message).toMatch(/cannot be changed/);
  });

  it("the console shows the records, and only what needs a person becomes a notice", async () => {
    const [client] = await loadStaffClients(h.as(marta.userId), { clientId: A });
    expect(client!.intake!.map((r) => `${r.kind}:${r.status}`)).toEqual(["government_id:accepted", "proof_of_address:needs_person", "bureau_letter:needs_person"]);
    // The report reading never travels to the console's client record.
    expect(JSON.stringify(client)).not.toContain("secret");
    const kindsOfNotice = clientExceptions(client!, new Date()).map((e) => e.kind).filter((k) => k.endsWith("needs_person"));
    expect(kindsOfNotice.sort()).toEqual(["bureau_letter_needs_person", "document_check_needs_person"]);
  });

  it("the private bucket exists", async () => {
    const { data } = await h.service.storage.getBucket("intake-files");
    expect(data).toMatchObject({ public: false });
  });
});
