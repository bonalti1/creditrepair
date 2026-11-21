import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { importReportForUser } from "../../domain/importReport";
import { reasonsFor } from "../../letters/reasons";
import { sendRound } from "../../rounds/send";
import { importStaffReport } from "../../staff/actions";
import { loadStaffClients } from "../../staff/load";
import type { StaffClient } from "../../staff/types";
import { startHarness, type Harness } from "./pg";
import { addClient, addDocuments, addStaff, assign, DAY, sampleReport, signAgreement } from "./seed";

// Each new staff route against the real migrations: what it accepts, who may
// call it (the role from the caller's own staff row; the client through the
// caller's own connection), and what it writes. The routes run as they do in
// production; only the two Supabase clients are swapped for the test
// database's (pg.ts), as the person signed in.

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
const as = (who: SupabaseClient | null) => {
  session.reader = who;
  session.admin = h.service;
};
const req = (path: string, body?: unknown, raw?: string) =>
  new Request(`https://app.test${path}`, {
    method: body === undefined && raw === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.1.${Math.floor(++ip / 250)}.${ip % 250}` },
    ...(raw !== undefined ? { body: raw } : body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, unknown> });

let admin: Awaited<ReturnType<typeof addStaff>>;
let marta: Awaited<ReturnType<typeof addStaff>>;
let ana: Awaited<ReturnType<typeof addStaff>>;
let A: string; // ana's client, assigned to marta, report on file
let B: string; // luis's client, nobody assigned

beforeAll(async () => {
  h = await startHarness();
  admin = await addStaff(h, "admin", "carmen", "Carmen Ruiz");
  marta = await addStaff(h, "specialist", "marta", "Marta Leal");
  ana = await addStaff(h, "sales", "ana", "Ana Prieto");
  A = await addClient(h, { name: "Rosa Martínez", referredBy: "ana" });
  B = await addClient(h, { name: "Luis Gómez", referredBy: "luis" });
  await assign(h, A, marta.userId, admin.userId);
  for (const c of [A, B]) {
    await signAgreement(h, c);
    await addDocuments(h, c);
    await importReportForUser(h.service, c, sampleReport(3));
  }
}, 60_000);

describe("GET /api/staff/clients", () => {
  it("answers 503 with no database, 403 to anyone who is not active staff, 400 to a malformed id", async () => {
    const route = await import("@/app/api/staff/clients/route");
    session.reader = null;
    session.admin = null;
    expect((await route.GET(req("/api/staff/clients"))).status).toBe(503);
    as(h.as(A));
    expect((await route.GET(req("/api/staff/clients"))).status).toBe(403);
    as(h.as(marta.userId));
    expect((await route.GET(req("/api/staff/clients?id=c07"))).status).toBe(400);
  });

  it("lists what the member's role lets the database show, and 404 for a client outside it", async () => {
    const route = await import("@/app/api/staff/clients/route");
    as(h.as(marta.userId));
    const list = await json(await route.GET(req("/api/staff/clients")));
    expect((list.body.clients as StaffClient[]).map((c) => c.id)).toEqual([A]);
    expect((await route.GET(req(`/api/staff/clients?id=${B}`))).status).toBe(404);
    as(h.as(admin.userId));
    expect(((await json(await route.GET(req("/api/staff/clients")))).body.clients as StaffClient[]).length).toBe(2);
  });
});

describe("POST /api/staff/case", () => {
  it("validates the body strictly", async () => {
    const route = await import("@/app/api/staff/case/route");
    as(h.as(marta.userId));
    expect((await route.POST(req("/api/staff/case", { action: "note", clientId: A, text: "" }))).status).toBe(400);
    expect((await route.POST(req("/api/staff/case", { action: "note", clientId: "c07", text: "x" }))).status).toBe(400);
    expect((await route.POST(req("/api/staff/case", { action: "note", clientId: A, text: "x", author: "otra" }))).status).toBe(400);
    expect((await route.POST(req("/api/staff/case", { action: "resolve", clientId: A, key: "Bad Key" }))).status).toBe(400);
    expect((await route.POST(req("/api/staff/case", undefined, "{not json"))).status).toBe(400);
    expect((await route.POST(req("/api/staff/case", undefined, JSON.stringify({ action: "note", clientId: A, text: "x".repeat(30_000) })))).status).toBe(413);
  });

  it("a note: signed with the member's own handle, only on a client they may see", async () => {
    const route = await import("@/app/api/staff/case/route");
    as(h.as(ana.userId));
    const ok = await json(await route.POST(req("/api/staff/case", { action: "note", clientId: A, text: "Le escribí por WhatsApp." })));
    expect(ok.status).toBe(200);
    expect(ok.body.note).toMatchObject({ author: "ana", text: "Le escribí por WhatsApp." });
    expect((await route.POST(req("/api/staff/case", { action: "note", clientId: B, text: "x" }))).status).toBe(404);
    as(h.as(A));
    expect((await route.POST(req("/api/staff/case", { action: "note", clientId: A, text: "x" }))).status).toBe(403);
  });

  it("a handled mark: a known notice, one the role attends, on a client they may see", async () => {
    const route = await import("@/app/api/staff/case/route");
    as(h.as(ana.userId));
    expect((await route.POST(req("/api/staff/case", { action: "resolve", clientId: A, key: "report_stale" }))).status).toBe(403);
    expect((await route.POST(req("/api/staff/case", { action: "resolve", clientId: A, key: "made_up_kind" }))).status).toBe(400);
    expect((await route.POST(req("/api/staff/case", { action: "resolve", clientId: A, key: "documents_missing" }))).status).toBe(200);
    as(h.as(marta.userId));
    expect((await route.POST(req("/api/staff/case", { action: "resolve", clientId: A, key: "furnisher_address_missing:Capital One" }))).status).toBe(200);
    expect((await route.POST(req("/api/staff/case", { action: "resolve", clientId: B, key: "report_stale" }))).status).toBe(404);
    const [client] = await loadStaffClients(h.as(marta.userId), { clientId: A });
    expect(Object.keys(client!.handled).sort()).toEqual(["documents_missing", "furnisher_address_missing:Capital One"]);
  });

  it("a reply: not for sales, refused when it breaks a claim rule, stored as the teammate's with their first name", async () => {
    const route = await import("@/app/api/staff/case/route");
    as(h.as(ana.userId));
    expect((await route.POST(req("/api/staff/case", { action: "reply", clientId: A, text: "Hola" }))).status).toBe(403);
    as(h.as(marta.userId));
    const banned = await json(await route.POST(req("/api/staff/case", { action: "reply", clientId: A, text: "Te garantizamos que borramos todo y te subimos 100 puntos." })));
    expect(banned.status).toBe(422);
    expect((banned.body.problems as unknown[]).length).toBeGreaterThan(0);
    const ok = await json(await route.POST(req("/api/staff/case", { action: "reply", clientId: A, text: "Hola Rosa, ya recibimos tus documentos." })));
    expect(ok.status).toBe(200);
    // The client reads it in their own thread, with the name.
    const rows = await h.as(A).from("chat_messages").select("source, author_name, body").eq("source", "human");
    expect(rows.data).toEqual([{ source: "human", author_name: "Marta", body: "Hola Rosa, ya recibimos tus documentos." }]);
    expect((await route.POST(req("/api/staff/case", { action: "reply", clientId: B, text: "Hola" }))).status).toBe(404);
  });
});

describe("POST /api/staff/reports", () => {
  it("keeps a sample untouched, for a known provider, on a case the member works", async () => {
    const route = await import("@/app/api/staff/reports/route");
    as(h.as(marta.userId));
    const saved = await json(await route.POST(req("/api/staff/reports", { action: "sample", clientId: A, provider: "identityiq", text: "<html>reporte</html>", fileName: "reporte.html" })));
    expect(saved.status).toBe(200);
    expect(saved.body.sample).toMatchObject({ provider: "identityiq", savedBy: "marta", text: "<html>reporte</html>" });
    expect((await route.POST(req("/api/staff/reports", { action: "sample", clientId: A, provider: "nobody", text: "x" }))).status).toBe(400);
    expect((await route.POST(req("/api/staff/reports", { action: "sample", clientId: B, provider: "identityiq", text: "x" }))).status).toBe(404);
    as(h.as(ana.userId));
    expect((await route.POST(req("/api/staff/reports", { action: "sample", clientId: A, provider: "identityiq", text: "x" }))).status).toBe(403);
  });
});

describe("POST /api/staff/rounds", () => {
  it("validates strictly and needs rounds.send", async () => {
    const route = await import("@/app/api/staff/rounds/route");
    as(h.as(marta.userId));
    expect((await route.POST(req("/api/staff/rounds", { rounds: [], via: "mail" }))).status).toBe(400);
    expect((await route.POST(req("/api/staff/rounds", { rounds: [{ clientId: A, roundNumber: 1 }], via: "fax" }))).status).toBe(400);
    expect((await route.POST(req("/api/staff/rounds", { rounds: [{ clientId: A, roundNumber: 1 }], via: "mail", plan: [] }))).status).toBe(400);
    const many = Array.from({ length: 51 }, () => ({ clientId: A, roundNumber: 1 }));
    expect((await route.POST(req("/api/staff/rounds", { rounds: many, via: "mail" }))).status).toBe(400);
    as(h.as(ana.userId));
    expect((await route.POST(req("/api/staff/rounds", { rounds: [{ clientId: A, roundNumber: 1 }], via: "mail" }))).status).toBe(403);
  });

  it("holds a round whose client is inside the cancellation window, or has no readable address, with the reason; mails nothing", async () => {
    const route = await import("@/app/api/staff/rounds/route");
    const inWindow = await addClient(h, { name: "Elena Ruiz" });
    const noAddress = await addClient(h, { name: "Pedro Sol", address: [] });
    for (const [client, options] of [[inWindow, { signedDaysAgo: 1, deadlineInDays: 3 }], [noAddress, {}]] as const) {
      await signAgreement(h, client, options);
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
    }
    as(h.as(admin.userId));
    const res = await json(await route.POST(req("/api/staff/rounds", { rounds: [{ clientId: inWindow, roundNumber: 1 }, { clientId: noAddress, roundNumber: 1 }], via: "print" })));
    const outcomes = res.body.outcomes as Array<{ clientId: string; sent: boolean; reason: string }>;
    expect(outcomes.find((o) => o.clientId === inWindow)).toMatchObject({ sent: false });
    expect(outcomes.find((o) => o.clientId === inWindow)!.reason).toMatch(/cancelaci/);
    expect(outcomes.find((o) => o.clientId === noAddress)).toMatchObject({ sent: false });
    expect(outcomes.find((o) => o.clientId === noAddress)!.reason).toMatch(/dirección del cliente/);
    expect(await h.sql(`select 1 from public.letters where user_id in ($1, $2)`, [inWindow, noAddress])).toEqual([]);
  });

  it("the shared mailing code refuses without an attestation, whoever calls it", async () => {
    const lone = await addClient(h, { name: "Sin Respuestas" });
    await signAgreement(h, lone);
    await importReportForUser(h.service, lone, sampleReport(2));
    // A flag row that says "attested" but has no attestation on record is not an answer.
    const { data: item } = await h.service.from("report_items").select("id").eq("user_id", lone).eq("category", "personal_info").limit(1).single();
    await h.service.from("item_flags").insert({ user_id: lone, item_id: (item as { id: string }).id, state: "attested", attested: true, attested_at: new Date().toISOString() });
    const result = await sendRound(h.service, { userId: lone, roundNumber: 1, sender: { kind: "staff", userId: admin.userId, name: "carmen" }, requireAgreement: true });
    expect(result).toMatchObject({ ok: false });
    expect(await h.sql(`select 1 from public.letters where user_id = $1`, [lone])).toEqual([]);
  });
});

describe("a report after the response window closes the round and the next one is prepared", () => {
  it("records what the report no longer lists, marks the round answered, and round 2 appears ready", async () => {
    const client = await addClient(h, { name: "Marta Cliente" });
    await signAgreement(h, client, { signedDaysAgo: 60 });
    await addDocuments(h, client);
    await assign(h, client, marta.userId);
    await importReportForUser(h.service, client, sampleReport(40));
    const { data: items } = await h.service.from("report_items").select("id, category, fingerprint, data").eq("user_id", client);
    const rows = (items ?? []) as Array<{ id: string; category: "personal_info" | "tradeline" | "inquiry"; fingerprint: string; data: { accountType?: string } }>;
    for (const item of rows) {
      // The old address (personal info) and the collection are disputed; the rest is correct.
      const attest = item.category === "personal_info" || item.data.accountType === "collection";
      await h.service.from("item_flags").insert({
        user_id: client,
        item_id: item.id,
        state: attest ? "attested" : "correct",
        attested: attest,
        attestation_text: attest ? "I believe this item is inaccurate." : null,
        attestation_version: attest ? "v1" : null,
        attested_at: attest ? new Date(Date.now() - 39 * DAY).toISOString() : null,
        reason_code: attest ? reasonsFor(item.category)[0]!.code : null,
      });
    }
    const mailedAt = new Date(Date.now() - 38 * DAY);
    // Round 1 went out 38 days ago (the report then was 2 days old).
    const sent = await sendRound(h.service, { userId: client, roundNumber: 1, sender: { kind: "staff", userId: marta.userId, name: "marta" }, requireAgreement: true, via: "print", now: mailedAt }).catch((e) => e);
    // The monitoring check reads today's clock: a report 40 days old is still current (45-day rule).
    expect(sent).toMatchObject({ ok: true, roundNumber: 1 });

    // Today's report no longer lists Equifax's old address.
    const today = sampleReport(1, (raw) => {
      raw.bureaus.equifax!.personalInfo = raw.bureaus.equifax!.personalInfo.filter((p) => p.field !== "address");
    });
    const result = await importStaffReport(h.service, h.as(marta.userId), marta, { clientId: client, readerKey: "credalti_json", source: JSON.stringify(today) });
    expect(result).toMatchObject({ ok: true });
    const [round] = await h.sql<{ status: string; responded_at: string | null; results: Array<{ outcome: string }> }>(
      `select status, responded_at, results from public.attack_rounds where user_id = $1 and round_number = 1`,
      [client],
    );
    expect(round!.status).toBe("complete");
    expect(round!.responded_at).not.toBeNull();
    expect(round!.results.map((r) => r.outcome)).toEqual(["removed"]);

    const [mapped] = await loadStaffClients(h.as(marta.userId), { clientId: client });
    expect(mapped!.rounds.map((r) => [r.number, r.status])).toEqual([
      [1, "responded"],
      [2, "ready"],
    ]);
    expect(mapped!.rounds[0]!.results?.length).toBe(1);
    expect(mapped!.rounds[0]!.sentBy).toBe("marta");
    expect(mapped!.reportImports?.[0]).toMatchObject({ by: "marta", readerKey: "credalti_json", removed: 1, closedRound: 1 });
    // Round 2's letters cover only attested items still on the report.
    const covered = mapped!.rounds[1]!.letters.flatMap((l) => l.items.map((i) => i.fingerprint));
    for (const fp of covered) expect(mapped!.answers[fp]?.status).toBe("inaccurate");
  });
});

describe("the other staff routes sign records with the member, never with the browser's name", () => {
  it("the furnisher address book, the billing pause, and the mail mode read", async () => {
    as(h.as(marta.userId));
    const furnishers = await import("@/app/api/furnishers/route");
    const [seeded] = await h.sql<{ id: string }>(`select id from public.furnishers where normalized_name = 'MIDLANDCREDITMANAGEMENT'`);
    const saved = await json(
      await furnishers.POST(
        req("/api/furnishers", { id: seeded!.id, name: "Midland Credit Management", addressLines: ["P.O. Box 939069", "San Diego, CA 92193"], source: "https://www.midlandcredit.com/", verifiedOn: new Date().toISOString().slice(0, 10), aliases: [], phone: "", notes: "Debt collector.", by: "Impostor" }),
      ),
    );
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const [change] = await h.sql<{ changed_by_name: string }>(`select changed_by_name from public.furnisher_changes order by changed_at desc limit 1`);
    expect(change!.changed_by_name).toBe("marta");

    const mail = await import("@/app/api/staff/mail/route");
    const book = await json(await mail.GET(req("/api/staff/mail")));
    expect(book.body.mode).toBe("simulated");
    const midland = (book.body.furnishers as Array<{ name: string; history: unknown[]; verifiedOn: string | null }>).find((f) => f.name === "Midland Credit Management")!;
    expect(midland.verifiedOn).toBeTruthy();
    expect(midland.history.length).toBeGreaterThanOrEqual(2);

    as(h.as(admin.userId));
    const pause = await import("@/app/api/billing/pause/route");
    expect((await pause.POST(req("/api/billing/pause", { userId: A, action: "pause", reason: "Revisando un reclamo", by: "Impostor" }))).status).toBe(200);
    const [row] = await h.sql<{ paused_by_name: string }>(`select paused_by_name from public.billing_pauses where user_id = $1`, [A]);
    expect(row!.paused_by_name).toBe("carmen");
  });

  it("GET /api/staff/me: an invited person becomes a member at first sign-in; a client is not staff", async () => {
    const me = await import("@/app/api/staff/me/route");
    await h.service.from("staff_invitations").insert({ display_name: "Jorge Paz", handle: "jorge", role: "specialist", phone_e164: "+12145550177", invited_by: admin.userId });
    const jorge = "00000000-0000-4000-8000-0000000000j0".replace("j", "a");
    await h.createUser(jorge, { phone: "+12145550177" });
    as(h.as(jorge, { phone: "+12145550177" }));
    expect((await json(await me.GET(req("/api/staff/me")))).body).toEqual({ staff: true, handle: "jorge", name: "Jorge Paz", role: "specialist" });
    as(h.as(A));
    expect((await json(await me.GET(req("/api/staff/me")))).body).toEqual({ staff: false });
  });
});

describe("GET /api/health against the real migrations", () => {
  it("finds every table the app needs, the 0014 columns, the private ID bucket and an administrator", async () => {
    const saved = { ...process.env };
    process.env.N8N_WEBHOOK_SECRET = "health-secret";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    try {
      as(null);
      const health = await import("@/app/api/health/route");
      const res = await json(await health.GET(new Request("https://app.test/api/health", { headers: { "x-webhook-secret": "health-secret" } })));
      const checks = res.body.checks as Array<{ name: string; ok: boolean; detail: string }>;
      const byName = (name: string) => checks.find((c) => c.name === name)!;
      expect(byName("Database and login (Supabase)").ok).toBe(true);
      expect(byName("Database tables"), byName("Database tables").detail).toMatchObject({ ok: true });
      expect(byName("ID photo storage").ok).toBe(true);
      expect(byName("Database: first administrator")).toMatchObject({ ok: true });
    } finally {
      for (const key of ["N8N_WEBHOOK_SECRET", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }
  });
});
