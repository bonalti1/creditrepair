import { beforeAll, describe, expect, it } from "vitest";
import { importReportForUser } from "../../domain/importReport";
import { loadStaffClients } from "../../staff/load";
import { startHarness, type Harness } from "./pg";
import { addClient, addDocuments, addStaff, assign, sampleReport, signAgreement, uid } from "./seed";

// Row level security, run for real: every migration in supabase/migrations
// applied to an in-process Postgres (pg.ts), each query run as the person
// asking. The console reads through the member's own connection
// (staff/load.ts), so these are the very reads the screens make.

let h: Harness;
let A: string; // a client brought in by ana, assigned to marta
let B: string; // a client brought in by luis, assigned to nobody
let admin: Awaited<ReturnType<typeof addStaff>>;
let marta: Awaited<ReturnType<typeof addStaff>>;
let jorge: Awaited<ReturnType<typeof addStaff>>;
let ana: Awaited<ReturnType<typeof addStaff>>;
let prospectId: string;

beforeAll(async () => {
  h = await startHarness();
  admin = await addStaff(h, "admin", "carmen", "Carmen Ruiz");
  marta = await addStaff(h, "specialist", "marta", "Marta Leal");
  jorge = await addStaff(h, "specialist", "jorge", "Jorge Paz");
  ana = await addStaff(h, "sales", "ana", "Ana Prieto");
  A = await addClient(h, { name: "Rosa Martínez", referredBy: "ana" });
  B = await addClient(h, { name: "Luis Gómez", referredBy: "luis" });
  for (const client of [A, B]) {
    await signAgreement(h, client);
    await addDocuments(h, client);
    await importReportForUser(h.service, client, sampleReport(3));
  }
  await assign(h, A, marta.userId, admin.userId);
  await h.service.from("chat_messages").insert([
    { user_id: A, role: "user", source: "journey", body: "hola" },
    { user_id: B, role: "user", source: "journey", body: "hola" },
  ]);
  const { data: prospect } = await h.service
    .from("prospects")
    .insert({ first_name: "Norma", last_name: "Ybarra", phone_e164: "+19035550135", state: "TX", goal: "auto", salesperson: "ana", created_by: ana.userId })
    .select("id")
    .single();
  prospectId = String((prospect as { id: string }).id);
  await h.service.from("staff_notes").insert([
    { user_id: A, author: marta.userId, author_name: "marta", body: "Llamó por su dirección." },
    { user_id: B, author: admin.userId, author_name: "carmen", body: "Pendiente." },
    { prospect_id: prospectId, author: ana.userId, author_name: "ana", body: "Prefiere WhatsApp." },
  ]);
  await h.service.from("exception_marks").insert([{ user_id: A, exception_key: "documents_missing", handled_by: marta.userId, handled_by_name: "marta" }]);
  await h.service.from("report_samples").insert([{ user_id: A, provider: "identityiq", body: "<html>…</html>", saved_by: marta.userId, saved_by_name: "marta" }]);
}, 60_000);

const count = async (who: string, table: string): Promise<number> => {
  const { data, error } = await h.as(who).from(table).select("*");
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data as unknown[]).length;
};

describe("a client sees only their own data", () => {
  it("their profile, report, items, answers, chat and agreement; nobody else's", async () => {
    for (const table of ["profiles", "report_pulls", "service_agreements", "chat_messages"]) {
      expect(await count(A, table), table).toBe(1);
    }
    expect(await count(A, "identity_documents")).toBe(2);
    expect(await count(A, "report_items")).toBeGreaterThan(5);
    const { data } = await h.as(A).from("report_items").select("user_id");
    expect(new Set((data as Array<{ user_id: string }>).map((r) => r.user_id))).toEqual(new Set([A]));
  });

  it("nothing of the team's: notes, handled marks, samples, staff list, assignments, prospects, audit", async () => {
    for (const table of ["staff_notes", "exception_marks", "report_samples", "staff_members", "client_assignments", "prospects", "team_audit"]) {
      expect(await count(A, table), table).toBe(0);
    }
  });

  it("cannot write a report, a round, a letter, a note or a handled mark of their own", async () => {
    const now = new Date().toISOString();
    const attempts = await Promise.all([
      h.as(A).from("report_pulls").insert({ user_id: A, source: "x", pulled_at: now, raw: {} }),
      h.as(A).from("attack_rounds").insert({ user_id: A, round_number: 9, status: "mailed" }),
      h.as(A).from("staff_notes").insert({ user_id: A, author_name: "yo", body: "x" }),
      h.as(A).from("exception_marks").insert({ user_id: A, exception_key: "documents_missing" }),
      h.as(A).from("report_samples").insert({ user_id: A, provider: "identityiq", body: "x" }),
    ]);
    for (const attempt of attempts) expect(attempt.error?.code).toBe("42501");
  });

  it("reads the round columns migration 0014 adds, like the rest of their round", async () => {
    const { error } = await h.as(A).from("attack_rounds").select("id, sent_by_name, mail_via, responded_at, results");
    expect(error).toBeNull();
  });
});

describe("a specialist sees only the clients assigned to them", () => {
  it("marta reads A's whole case and nothing of B", async () => {
    const clients = await loadStaffClients(h.as(marta.userId));
    expect(clients.map((c) => c.id)).toEqual([A]);
    const rosa = clients[0]!;
    expect(rosa.report?.items.length).toBeGreaterThan(5);
    expect(rosa.notes.map((n) => n.text)).toEqual(["Llamó por su dirección."]);
    expect(rosa.handled.documents_missing).toBeTruthy();
    expect(rosa.reportSamples?.length).toBe(1);
    expect(rosa.conversation?.length).toBe(1);
    expect(rosa.assignedTo).toBe("marta");
  });

  it("jorge, with nobody assigned, sees no client", async () => {
    expect(await loadStaffClients(h.as(jorge.userId))).toEqual([]);
    expect(await count(jorge.userId, "staff_notes")).toBe(0);
    expect(await count(jorge.userId, "report_samples")).toBe(0);
  });
});

describe("sales sees who they brought in, and no case data", () => {
  it("ana sees A (referred_by ana) and her prospect, with notes, but no report, answers, letters, chat, samples or money", async () => {
    const clients = await loadStaffClients(h.as(ana.userId));
    expect(clients.map((c) => c.id).sort()).toEqual([A, prospectId].sort());
    const rosa = clients.find((c) => c.id === A)!;
    expect(rosa.report).toBeNull();
    expect(rosa.answers).toEqual({});
    expect(rosa.rounds).toEqual([]);
    expect(rosa.conversation).toBeUndefined();
    expect(rosa.reportSamples).toBeUndefined();
    expect(rosa.billing.charges).toEqual([]);
    // The agreement and the documents on file are hers to follow up.
    expect(rosa.agreementSignedAt).toBeTruthy();
    expect(rosa.documents).toEqual(["government_id", "proof_of_address"]);
    expect(rosa.notes.length).toBe(1);
    const norma = clients.find((c) => c.id === prospectId)!;
    expect(norma.signedUpAt).toBeNull();
    expect(norma.notes.map((n) => n.text)).toEqual(["Prefiere WhatsApp."]);
    for (const table of ["report_pulls", "report_items", "item_flags", "letters", "chat_messages", "report_samples", "charges"]) {
      expect(await count(ana.userId, table), table).toBe(0);
    }
  });
});

describe("an administrator sees everyone", () => {
  it("both clients and the prospect, with every note", async () => {
    const clients = await loadStaffClients(h.as(admin.userId));
    expect(clients.map((c) => c.id).sort()).toEqual([A, B, prospectId].sort());
    expect(await count(admin.userId, "staff_notes")).toBe(3);
  });

  it("staff never appear as clients", async () => {
    const ids = (await loadStaffClients(h.as(admin.userId))).map((c) => c.id);
    for (const member of [admin, marta, jorge, ana]) expect(ids).not.toContain(member.userId);
  });
});

describe("staff write only through the server", () => {
  it("no member of staff can insert, update or delete a client record or a team record directly", async () => {
    for (const member of [admin, marta, ana]) {
      const db = h.as(member.userId);
      const tries = await Promise.all([
        db.from("staff_notes").insert({ user_id: A, author_name: member.handle, body: "directo" }),
        db.from("exception_marks").insert({ user_id: A, exception_key: "report_stale" }),
        db.from("report_samples").insert({ user_id: A, provider: "identityiq", body: "x" }),
        db.from("item_flags").insert({ user_id: A, item_id: uid(), state: "attested" }),
        db.from("attack_rounds").insert({ user_id: A, round_number: 7, status: "mailed" }),
        db.from("client_assignments").insert({ user_id: B, staff_user_id: member.userId }),
      ]);
      for (const t of tries) expect(t.error?.code, member.handle).toBe("42501");
      const updated = await db.from("profiles").update({ full_name: "cambiado" }).eq("id", A).select("id");
      expect(updated.data ?? [], member.handle).toEqual([]);
    }
  });

  it("notes, handled marks and samples are records: not even the service role can edit or delete one", async () => {
    const edit = await h.service.from("staff_notes").update({ body: "editada" }).eq("user_id", A);
    expect(edit.error?.message).toMatch(/cannot be changed/);
    const remove = await h.service.from("exception_marks").delete().eq("user_id", A);
    expect(remove.error?.message).toMatch(/cannot be deleted/);
    const sample = await h.service.from("report_samples").delete().eq("user_id", A);
    expect(sample.error?.message).toMatch(/cannot be deleted/);
  });

  it("a note is about one client or one prospect, never both or neither", async () => {
    const both = await h.service.from("staff_notes").insert({ user_id: A, prospect_id: prospectId, author_name: "x", body: "x" });
    expect(both.error?.message).toMatch(/staff_notes_one_subject/);
    const neither = await h.service.from("staff_notes").insert({ author_name: "x", body: "x" });
    expect(neither.error?.message).toMatch(/staff_notes_one_subject/);
  });
});
