import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createDemoGateway } from "../../billing/gateway";
import { loadBilling, runBillingForUser } from "../../billing/server";
import { chargeEligibility } from "../../billing/rules";
import type { ClientReportPayload, ClientRoundPayload } from "../../clientCase/server";
import { reasonsFor } from "../../letters/reasons";
import { buildInvitePath, parseInvite } from "../../sales/invite";
import { signLobPayload } from "../../security/signatures";
import { sendableRound, clientStage } from "../../staff/stage";
import type { StaffClient } from "../../staff/types";
import { startHarness, type Harness } from "./pg";
import { addStaff, DAY, signAgreement } from "./seed";

// The whole path against the real migrations, through the real routes:
//
//   sales adds a prospect → an administrator assigns it → the invite link →
//   the client signs in (Supabase Auth stands in) and onboarding saves the
//   invite's data → the client writes their address and uploads documents →
//   the agreement is signed → a specialist imports the report → the client
//   answers every item, with a reason and the attestation → the console shows
//   round 1 ready → the specialist sends it (no Lob key: the simulated mail
//   service) → Lob's tracking webhook says delivered → the round is billable,
//   and the billing run charges it once.
//
// What is NOT real here, said plainly:
//   - Supabase Auth: no phone OTP, no cookies. "Signed in" means the route's
//     cookie client is this person's connection (pg.ts runs it as the
//     authenticated role with auth.uid() set), exactly what RLS sees.
//   - The agreement is recorded with the service role the way
//     /api/agreement/sign records it, backdated past the 3-business-day
//     window: the real sign route refuses until an attorney-approved text is
//     configured (agreementReadiness), which a test cannot honestly fake.
//   - The mail service is Lob's simulated path (no LOB_API_KEY); the payment
//     processor is the demo gateway.
//   - PostgREST: see pg.ts for what the adapter does not emulate.

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
const signIn = (who: SupabaseClient | null) => {
  session.reader = who;
  session.admin = h.service;
};
const call = (path: string, init: { method?: string; body?: unknown } = {}) =>
  new Request(`https://app.test${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: { "content-type": "application/json", "x-forwarded-for": `10.0.${Math.floor(++ip / 250)}.${ip % 250}` },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, unknown> });

beforeAll(async () => {
  h = await startHarness();
}, 60_000);

describe("invite → sign → import → answers → round → send → tracking → charge", () => {
  const PHONE = "+17135550188";
  const CLIENT = "00000000-0000-4000-8000-0000000c11e7";
  let admin: Awaited<ReturnType<typeof addStaff>>;
  let marta: Awaited<ReturnType<typeof addStaff>>;
  let ana: Awaited<ReturnType<typeof addStaff>>;
  let prospectId = "";
  let roundLetters: StaffClient["rounds"][number]["letters"] = [];

  it("sales adds the person and an administrator assigns them", async () => {
    admin = await addStaff(h, "admin", "carmen", "Carmen Ruiz");
    marta = await addStaff(h, "specialist", "marta", "Marta Leal");
    ana = await addStaff(h, "sales", "ana", "Ana Prieto");
    const clients = await import("@/app/api/staff/clients/route");

    signIn(h.as(ana.userId));
    const added = await json(
      await clients.POST(call("/api/staff/clients", { body: { action: "add_prospect", firstName: "Rosa", lastName: "Martínez", phone: "(713) 555-0188", state: "TX", goal: "mortgage" } })),
    );
    expect(added.status).toBe(200);
    prospectId = (added.body.client as StaffClient).id;
    // A salesperson cannot assign.
    expect((await clients.POST(call("/api/staff/clients", { body: { action: "assign", clientIds: [prospectId], to: "marta" } }))).status).toBe(403);

    signIn(h.as(admin.userId));
    const assigned = await json(await clients.POST(call("/api/staff/clients", { body: { action: "assign", clientIds: [prospectId], to: "marta" } })));
    expect(assigned.body).toMatchObject({ ok: true, count: 1 });

    // Marta now sees the prospect in her list; it is a lead.
    signIn(h.as(marta.userId));
    const list = await json(await clients.GET(call("/api/staff/clients")));
    const lead = (list.body.clients as StaffClient[]).find((c) => c.id === prospectId)!;
    expect(lead.assignedTo).toBe("marta");
    expect(clientStage(lead, new Date())).toBe("lead");
  });

  it("the client opens the invite, signs in, and onboarding saves the invite's data", async () => {
    const path = buildInvitePath({ name: "Rosa", goal: "mortgage", state: "TX", ref: "ana", refName: "Ana" });
    const invite = parseInvite(new URL(`https://app.test${path}`).searchParams)!;
    expect(invite).toMatchObject({ ref: "ana", goal: "mortgage", state: "TX" });

    // Supabase Auth verified the phone by text message and created the account.
    await h.createUser(CLIENT, { phone: PHONE });
    const client = h.as(CLIENT, { phone: PHONE });
    signIn(client);
    // The login page: not staff, so a client profile with the verified phone.
    const me = await json(await (await import("@/app/api/staff/me/route")).GET(call("/api/staff/me")));
    expect(me.body).toEqual({ staff: false });
    expect((await client.from("profiles").upsert({ id: CLIENT, phone_e164: PHONE }, { onConflict: "id" })).error).toBeNull();

    // OnboardingSync sends what the invite and onboarding established.
    const onboarding = await import("@/app/api/profile/onboarding/route");
    const saved = await json(await onboarding.POST(call("/api/profile/onboarding", { body: { goal: invite.goal, state: invite.state, assisted: false, referredBy: invite.ref } })));
    expect(saved.body).toMatchObject({ ok: true, referredBy: "ana" });
    // A later link does not change who brought them in.
    await onboarding.POST(call("/api/profile/onboarding", { body: { referredBy: "luis" } }));
    const [profile] = await h.sql<{ referred_by: string; goal: string; state: string }>(`select referred_by, goal, state from public.profiles where id = $1`, [CLIENT]);
    expect(profile).toMatchObject({ referred_by: "ana", goal: "mortgage", state: "TX" });

    // The prospect became this client, and the client kept Marta.
    const [prospect] = await h.sql<{ converted_user_id: string }>(`select converted_user_id from public.prospects where id = $1`, [prospectId]);
    expect(prospect!.converted_user_id).toBe(CLIENT);
    const [assignment] = await h.sql<{ staff_user_id: string }>(`select staff_user_id from public.client_assignments where user_id = $1`, [CLIENT]);
    expect(assignment!.staff_user_id).toBe(marta.userId);

    // Before any report, the client app reads "your team is importing your report".
    const report = await json(await (await import("@/app/api/report/route")).GET(call("/api/report")));
    expect(report.body).toMatchObject({ authenticated: true, report: null });
  });

  it("the client writes their address and uploads their documents; the agreement is signed", async () => {
    const client = h.as(CLIENT, { phone: PHONE });
    signIn(client);
    const address = await import("@/app/api/profile/address/route");
    expect((await address.POST(call("/api/profile/address", { body: { line1: "1 Calle Falsa", city: "Houston", state: "TX", zip: "123" } }))).status).toBe(400);
    const ok = await json(await address.POST(call("/api/profile/address", { body: { line1: "4521 Westheimer Rd", line2: "Apt 12", city: "Houston", state: "Texas", zip: "77027" } })));
    expect(ok.body.addressLines).toEqual(["4521 Westheimer Rd", "Apt 12", "Houston, TX 77027"]);
    // Documents: the client's own rows (IdentityDocs uploads, then records them under "own documents").
    const docs = await client.from("identity_documents").insert([
      { user_id: CLIENT, kind: "government_id", storage_path: `${CLIENT}/id.jpg` },
      { user_id: CLIENT, kind: "proof_of_address", storage_path: `${CLIENT}/bill.jpg` },
    ]);
    expect(docs.error).toBeNull();
    await h.service.from("profiles").update({ full_name: "Rosa Martínez" }).eq("id", CLIENT);
    await signAgreement(h, CLIENT, { signedDaysAgo: 12, fee: "89.00" });
  });

  it("the specialist imports the report: read again on the server, never an answer written", async () => {
    const reports = await import("@/app/api/staff/reports/route");
    const { sampleReport } = await import("./seed");
    const source = JSON.stringify(sampleReport(2));

    // Sales cannot import; a specialist who does not work this client cannot either.
    signIn(h.as(ana.userId));
    expect((await reports.POST(call("/api/staff/reports", { body: { action: "import", clientId: CLIENT, readerKey: "credalti_json", source } }))).status).toBe(403);
    const other = await addStaff(h, "specialist", "jorge");
    signIn(h.as(other.userId));
    expect((await reports.POST(call("/api/staff/reports", { body: { action: "import", clientId: CLIENT, readerKey: "credalti_json", source } }))).status).toBe(404);

    signIn(h.as(marta.userId));
    // A reader with no samples refuses; text that is not a report is refused with the reasons.
    const noReader = await json(await reports.POST(call("/api/staff/reports", { body: { action: "import", clientId: CLIENT, readerKey: "identityiq", source } })));
    expect(noReader.status).toBe(422);
    const garbage = await json(await reports.POST(call("/api/staff/reports", { body: { action: "import", clientId: CLIENT, readerKey: "credalti_json", source: "{\"hola\": 1}" } })));
    expect(garbage.status).toBe(422);

    const imported = await json(await reports.POST(call("/api/staff/reports", { body: { action: "import", clientId: CLIENT, readerKey: "credalti_json", source } })));
    expect(imported.status).toBe(200);
    // An older report is refused, as the preview says.
    const older = await json(await reports.POST(call("/api/staff/reports", { body: { action: "import", clientId: CLIENT, readerKey: "credalti_json", source: JSON.stringify(sampleReport(20)) } })));
    expect(older.status).toBe(409);

    const [pull] = await h.sql<{ imported_by_name: string; reader_key: string }>(`select imported_by_name, reader_key from public.report_pulls where user_id = $1`, [CLIENT]);
    expect(pull).toMatchObject({ imported_by_name: "marta", reader_key: "credalti_json" });
    expect((await h.sql(`select 1 from public.item_flags where user_id = $1`, [CLIENT])).length).toBe(0);
  });

  it("the client answers every item through /api/flags, with a reason and the attestation text", async () => {
    const client = h.as(CLIENT, { phone: PHONE });
    signIn(client);
    const report = (await json(await (await import("@/app/api/report/route")).GET(call("/api/report")))).body as unknown as ClientReportPayload;
    expect(report.report!.items.length).toBeGreaterThan(5);
    expect(report.profile.addressLines).toEqual(["4521 Westheimer Rd", "Apt 12", "Houston, TX 77027"]);

    const flags = await import("@/app/api/flags/route");
    // A confirmed answer needs a reason.
    const first = report.report!.items[0]!;
    expect((await flags.PUT(call("/api/flags", { method: "PUT", body: { fingerprint: first.fingerprint, state: "attested" } }))).status).toBe(400);
    for (const item of report.report!.items) {
      const inaccurate = item.category === "personal_info";
      const body = inaccurate
        ? { fingerprint: item.fingerprint, state: "attested", reasonCode: reasonsFor(item.category)[0]!.code, reason: "No es mío.", locale: "es" }
        : { fingerprint: item.fingerprint, state: "correct" };
      const res = await flags.PUT(call("/api/flags", { method: "PUT", body }));
      expect(res.status, item.fingerprint).toBe(200);
    }
    const stored = await h.sql<{ state: string; attestation_text: string | null; reason_code: string | null }>(`select state, attestation_text, reason_code from public.item_flags where user_id = $1`, [CLIENT]);
    const attested = stored.filter((f) => f.state === "attested");
    expect(attested.length).toBeGreaterThan(0);
    for (const f of attested) {
      expect(f.attestation_text).toMatch(/inaccurate|inexact/i);
      expect(f.reason_code).toBeTruthy();
    }
    // The client app reads the same answers back.
    const back = await json(await flags.GET());
    expect(Object.keys(back.body.flags as object).length).toBe(report.report!.items.length);
  });

  it("the console shows round 1 ready for the specialist, and sales cannot send it", async () => {
    const clients = await import("@/app/api/staff/clients/route");
    signIn(h.as(marta.userId));
    const one = await json(await clients.GET(call(`/api/staff/clients?id=${CLIENT}`)));
    const rosa = one.body.client as StaffClient;
    expect(rosa.firstName).toBe("Rosa");
    expect(rosa.salesperson).toBe("ana");
    expect(clientStage(rosa, new Date())).toBe("ready_to_send");
    const { data: book } = await h.as(marta.userId).from("furnishers").select("*");
    const { furnisherFromRow } = await import("../../mail/server");
    const round = sendableRound(rosa, new Date(), { furnishers: ((book as Array<Record<string, unknown>>) ?? []).map(furnisherFromRow) });
    expect(round?.number).toBe(1);
    expect(round!.letters.every((l) => l.templateKey === "personal_info_cleanup")).toBe(true);
    roundLetters = round!.letters;

    const rounds = await import("@/app/api/staff/rounds/route");
    signIn(h.as(ana.userId));
    expect((await rounds.POST(call("/api/staff/rounds", { body: { rounds: [{ clientId: CLIENT, roundNumber: 1 }], via: "mail" } }))).status).toBe(403);
    // The client approval route refuses under full service: letters leave only from staff.
    signIn(h.as(CLIENT));
    const approve = await import("@/app/api/attacks/approve/route");
    expect((await approve.POST(call("/api/attacks/approve", { body: { roundNumber: 1 } }))).status).toBe(409);
  });

  it("the specialist sends it: every gate checked again on the server, one letter per bureau, each once", async () => {
    const rounds = await import("@/app/api/staff/rounds/route");
    signIn(h.as(marta.userId));
    // A round that is not the next one is refused, not mailed.
    const wrong = await json(await rounds.POST(call("/api/staff/rounds", { body: { rounds: [{ clientId: CLIENT, roundNumber: 3 }], via: "mail" } })));
    expect((wrong.body.outcomes as Array<{ sent: boolean }>)[0]!.sent).toBe(false);

    const classes = Object.fromEntries(roundLetters.map((l) => [l.id, "certified"]));
    const sent = await json(await rounds.POST(call("/api/staff/rounds", { body: { rounds: [{ clientId: CLIENT, roundNumber: 1 }], via: "mail", mailClasses: classes } })));
    expect(sent.status).toBe(200);
    expect(sent.body.outcomes).toEqual([{ clientId: CLIENT, roundNumber: 1, sent: true, letters: roundLetters.length }]);

    const letters = await h.sql<{ id: string; status: string; mail_class: string; mail_provider: string; lob_id: string; target_type: string }>(
      `select id, status, mail_class, mail_provider, lob_id, target_type from public.letters where user_id = $1`,
      [CLIENT],
    );
    expect(letters.length).toBe(roundLetters.length);
    for (const l of letters) expect(l).toMatchObject({ status: "queued", mail_class: "certified", mail_provider: "simulated", target_type: "bureau" });
    const [round] = await h.sql<{ status: string; sent_by_name: string; mail_via: string }>(`select status, sent_by_name, mail_via from public.attack_rounds where user_id = $1`, [CLIENT]);
    expect(round).toMatchObject({ status: "mailed", sent_by_name: "marta", mail_via: "mail" });
    // Every letter item was attested by the client.
    const unattested = await h.sql(
      `select 1 from public.letter_items li join public.letters l on l.id = li.letter_id
         left join public.item_flags f on f.item_id = li.item_id and f.user_id = l.user_id
        where l.user_id = $1 and (f.attested is not true or f.attestation_text is null)`,
      [CLIENT],
    );
    expect(unattested).toEqual([]);

    // Sending again mails nothing twice.
    const again = await json(await rounds.POST(call("/api/staff/rounds", { body: { rounds: [{ clientId: CLIENT, roundNumber: 1 }], via: "mail" } })));
    expect((again.body.outcomes as Array<{ sent: boolean }>)[0]!.sent).toBe(false);
    expect((await h.sql(`select 1 from public.letters where user_id = $1`, [CLIENT])).length).toBe(roundLetters.length);

    // The client sees the round as mailed, with each letter on its way.
    signIn(h.as(CLIENT));
    const mine = (await json(await (await import("@/app/api/rounds/route")).GET(call("/api/rounds")))).body as unknown as ClientRoundPayload;
    expect(mine.round?.number).toBe(1);
    expect(mine.round?.letters.every((l) => l.mail.status === "in_transit" && l.mail.mailClass === "certified")).toBe(true);
    expect(mine.round?.fingerprints.length).toBeGreaterThan(0);
  });

  it("Lob's signed tracking webhook records a delivery once", async () => {
    process.env.LOB_WEBHOOK_SECRET = "whsec_test";
    try {
      const [letter] = await h.sql<{ id: string; lob_id: string }>(`select id, lob_id from public.letters where user_id = $1 order by created_at limit 1`, [CLIENT]);
      const payload = JSON.stringify({
        id: "evt_e2e_1",
        event_type: { id: "letter.certified.delivered" },
        reference_id: letter!.lob_id,
        date_created: new Date().toISOString(),
        body: { id: letter!.lob_id, tracking_number: "9407111899223197428490", tracking_events: [{ name: "Delivered", time: new Date().toISOString(), location: "77027" }] },
      });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const webhook = await import("@/app/api/webhooks/lob/route");
      const post = () =>
        webhook.POST(
          new Request("https://app.test/api/webhooks/lob", {
            method: "POST",
            headers: { "content-type": "application/json", "lob-signature": signLobPayload(payload, timestamp, "whsec_test"), "lob-signature-timestamp": timestamp },
            body: payload,
          }),
        );
      expect((await json(await post())).body).toMatchObject({ ok: true, duplicate: false, status: "delivered" });
      expect((await json(await post())).body).toMatchObject({ ok: true, duplicate: true });
      const [row] = await h.sql<{ mail_status: string; tracking_number: string }>(`select mail_status, tracking_number from public.letters where id = $1`, [letter!.id]);
      expect(row).toMatchObject({ mail_status: "delivered", tracking_number: "9407111899223197428490" });
      expect((await h.sql(`select 1 from public.mail_events where letter_id = $1`, [letter!.id])).length).toBe(1);

      // The specialist's console shows the delivery on the letter.
      const clients = await import("@/app/api/staff/clients/route");
      signIn(h.as(marta.userId));
      const rosa = (await json(await clients.GET(call(`/api/staff/clients?id=${CLIENT}`)))).body.client as StaffClient;
      const shown = rosa.rounds.find((r) => r.number === 1)!.letters.find((l) => l.id === letter!.id)!;
      expect(shown.mailStatus).toBe("delivered");
      expect(shown.mail?.events.map((e) => e.kind)).toEqual(["delivered"]);
      expect(rosa.rounds.find((r) => r.number === 1)!.sentBy).toBe("marta");
    } finally {
      delete process.env.LOB_WEBHOOK_SECRET;
    }
  });

  it("the mailed round is billable: the billing run charges it once, for the signed fee, and the database refuses a second", async () => {
    const later = new Date(Date.now() + 2 * DAY);
    // Mailed today: not yet (the correction delay). Two days later the only thing missing is a card on file.
    const before = await loadBilling(h.service, CLIENT);
    expect(chargeEligibility(before.context, new Date())).toMatchObject({ eligible: false, code: "too_soon_after_mailing" });
    expect(chargeEligibility(before.context, later)).toMatchObject({ eligible: false, code: "no_payment_method" });

    // The client put a card on file (as /api/billing/payment-method records it, demo processor).
    const { data: method } = await h.service
      .from("payment_methods")
      .insert({ user_id: CLIENT, gateway: "demo", brand: "visa", last4: "4242", authorization_version: "test", authorization_locale: "es", authorization_hash: "c".repeat(64) })
      .select("id")
      .single();
    await h.service.from("payment_method_vault").insert({ payment_method_id: (method as { id: string }).id, customer_ref: "demo_cus_test", payment_method_ref: "demo_pm_visa_4242" });

    expect(chargeEligibility((await loadBilling(h.service, CLIENT)).context, later)).toMatchObject({ eligible: true, roundNumber: 1 });
    const summary = await runBillingForUser(h.service, createDemoGateway(), CLIENT, later);
    expect(summary.paid).toBe(1);
    const charges = await h.sql<{ amount_cents: number; status: string; round_number: number }>(`select amount_cents, status, round_number from public.charges where user_id = $1`, [CLIENT]);
    expect(charges).toEqual([{ amount_cents: 8900, status: "succeeded", round_number: 1 }]);

    const [round] = await h.sql<{ id: string }>(`select id from public.attack_rounds where user_id = $1`, [CLIENT]);
    const twice = await h.service.from("charges").insert({ user_id: CLIENT, round_id: round!.id, amount_cents: 8900 });
    expect(twice.error).not.toBeNull();
    // Running billing again charges nothing more.
    expect((await runBillingForUser(h.service, createDemoGateway(), CLIENT, later)).paid).toBe(0);
  });
});
