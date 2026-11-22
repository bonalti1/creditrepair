import { beforeAll, describe, expect, it, vi } from "vitest";
import { followupStates } from "../../autopilot/followups";
import { workQueue } from "../../autopilot/queue";
import { runAutopilot, type Deliver } from "../../autopilot/server";
import { saveAutopilotSettings } from "../../autopilot/store";
import { DEFAULT_AUTOPILOT, type AutopilotEnv } from "../../autopilot/types";
import { createDemoGateway } from "../../billing/gateway";
import { chargeEligibility } from "../../billing/rules";
import { loadBilling, runBillingForUser } from "../../billing/server";
import { importReportForUser } from "../../domain/importReport";
import type { MailLetterParams, MailResult } from "../../integrations/lob";
import { reasonsFor } from "../../letters/reasons";
import { formatUsAddress, parseUsAddress } from "../../mail/address";
import { resolveFurnisherAddress } from "../../mail/furnishers";
import { handleReturnedLetters } from "../../mail/returnsServer";
import { furnisherFromRow } from "../../mail/server";
import { VERIFICATION_COST_MILLS, type VerifiedAddress } from "../../mail/verify";
import { verifyAddress, verifyRoundAddresses } from "../../mail/verifyServer";
import { sendRound } from "../../rounds/send";
import { clientsFromRows } from "../../staff/fromRows";
import { loadStaffRows } from "../../staff/load";
import { clientExceptions, sendBlockReason } from "../../staff/stage";
import { startHarness, type Harness } from "./pg";
import { addClient, addDocuments, addStaff, approveBuiltinLetters, DAY, sampleReport, signAgreement } from "./seed";

// What fixes itself (migration 0022), against the real migrations:
//
//   - the address check is a step before mailing: a correction is used and
//     logged; a client address the post office cannot confirm stops the round
//     and asks the client ONCE; a creditor address it does not deliver to
//     becomes a missing address for every client;
//   - a returned letter is re-mailed once, never twice (the database refuses
//     a second re-mail and a re-mail of a re-mail), in the same round;
//   - billing never charges twice for a re-mailed round, and a round whose
//     letters all came back is charged only once one is on its way again;
//   - a missing company is ONE queue item for every client waiting on it,
//     first seen once.
// The address verification service and Lob's mailing are stand-ins that
// record what they were asked (no Lob key in tests).

const session = vi.hoisted(() => ({ admin: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => session.admin }));

let h: Harness;

/** A verifier that answers from a table of address → result, and counts what it was asked. */
function fakeVerifier(answers: Array<{ match: RegExp; result: VerifiedAddress["result"]; lines?: string[]; suggestion?: string[] }>) {
  const asked: string[][] = [];
  const verify = async (lines: readonly string[]): Promise<VerifiedAddress> => {
    asked.push([...lines]);
    const parsed = parseUsAddress([...lines]);
    const given = parsed.ok ? formatUsAddress(parsed.address) : [...lines];
    const hit = answers.find((a) => a.match.test(lines.join(" ")));
    if (!hit) return { result: "deliverable", deliverability: "deliverable", lines: given, suggestion: [], provider: "lob", costMills: VERIFICATION_COST_MILLS };
    return {
      result: hit.result,
      deliverability: hit.result === "ambiguous" ? "deliverable_missing_unit" : hit.result === "undeliverable" ? "undeliverable" : "deliverable",
      lines: hit.lines ?? given,
      suggestion: hit.suggestion ?? [],
      provider: "lob",
      costMills: VERIFICATION_COST_MILLS,
    };
  };
  return { verify, asked };
}

function fakeMail() {
  const calls: MailLetterParams[] = [];
  const mailLetter = async (params: MailLetterParams): Promise<MailResult> => {
    calls.push(params);
    return { provider: "stub", externalId: `stub_${params.idempotencyKey}`, status: "queued", mailClass: params.mailClass ?? "first_class", trackingNumber: null, expectedDeliveryDate: null };
  };
  return { mailLetter, calls };
}

/** A client with everything in and the personal-information items confirmed: round 1 (bureaus) is ready. */
async function readyClient(name: string, address: string[]): Promise<string> {
  const id = await addClient(h, { name, address });
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
      attested_at: attested ? new Date(Date.now() - 60 * 60 * 1000).toISOString() : null,
    });
    if (error) throw new Error(error.message);
  }
  return id;
}

const send = (userId: string, deps: Parameters<typeof sendRound>[1]["deps"]) =>
  sendRound(h.service, { userId, roundNumber: 1, sender: { kind: "staff", name: "marta" }, requireAgreement: true, via: "mail", deps });

const ENV: AutopilotEnv = {
  settings: { ...DEFAULT_AUTOPILOT, followupsEnabled: true, roundsEnabled: true },
  channels: { whatsapp: true, email: false, approvedTemplates: "all", simulated: false },
};

let A: string; // round 1 mailed, the post office wrote her address its way
let B: string; // the post office could not confirm her address

beforeAll(async () => {
  h = await startHarness();
  session.admin = h.service;
  await approveBuiltinLetters(h);
  await addStaff(h, "admin", "carmen", "Carmen Ruiz");
  A = await readyClient("Rosa Martínez", ["123 Main St", "Houston, TX 77002"]);
  B = await readyClient("Luz Peña", ["88 Elm Street Interior", "Houston, TX 77003"]);
}, 60_000);

describe("address verification before mailing (a step added to the send, migration 0022)", () => {
  it("a correction is used as the post office writes it, and logged; the return address carries it", async () => {
    const verifier = fakeVerifier([{ match: /123 Main St/, result: "corrected", lines: ["123 MAIN ST", "HOUSTON, TX 77002-1234"] }]);
    const mail = fakeMail();
    const result = await send(A, { verifyAddress: verifier.verify, mailLetter: mail.mailLetter });
    expect(result.ok).toBe(true);
    expect(mail.calls.length).toBeGreaterThan(0);
    for (const call of mail.calls) expect(call.from.addressLines).toEqual(["123 MAIN ST", "HOUSTON, TX 77002-1234"]);
    // Every address was checked once: the client's and one per letter.
    const rows = await h.sql<{ subject: string; result: string; cost_mills: number }>(`select subject, result, cost_mills from public.address_verifications where user_id = $1`, [A]);
    expect(rows.length).toBe(1 + mail.calls.length);
    expect(rows.find((r) => r.subject === "client")).toMatchObject({ result: "corrected", cost_mills: VERIFICATION_COST_MILLS });
    const fixes = await h.sql<{ kind: string }>(`select kind from public.autopilot_resolutions where user_id = $1`, [A]);
    expect(fixes.map((f) => f.kind)).toEqual(["address_corrected"]);
  });

  it("a recent check of the same address is reused, not paid for twice", async () => {
    const verifier = fakeVerifier([]);
    const again = await verifyAddress(h.service, { lines: ["123 Main St", "Houston, TX 77002"], subject: "client", subjectKey: A, userId: A }, verifier.verify, new Date());
    expect(again).toMatchObject({ provider: "cache", costMills: 0, result: "corrected", lines: ["123 MAIN ST", "HOUSTON, TX 77002-1234"] });
    expect(verifier.asked).toHaveLength(0);
  });

  it("a client address the post office cannot confirm stops the round and asks the client once, by the automatic channel", async () => {
    const suggestion = ["88 ELM ST", "APT 2", "HOUSTON, TX 77003-0001"];
    const verifier = fakeVerifier([{ match: /88 Elm/, result: "ambiguous", suggestion }]);
    const mail = fakeMail();
    const first = await send(B, { verifyAddress: verifier.verify, mailLetter: mail.mailLetter });
    expect(first).toMatchObject({ ok: false, code: "client_address_unverified" });
    const second = await send(B, { verifyAddress: verifier.verify, mailLetter: mail.mailLetter });
    expect(second).toMatchObject({ ok: false, code: "client_address_unverified" });
    // Nothing went out, and nothing was half-sent.
    expect(mail.calls).toHaveLength(0);
    expect(await h.sql(`select 1 from public.letters where user_id = $1 and status <> 'draft'`, [B])).toHaveLength(0);
    expect((await h.sql<{ status: string }>(`select status from public.attack_rounds where user_id = $1`, [B]))[0]?.status ?? "draft").toBe("draft");
    // One open request, with the post office's suggestion.
    const requests = await h.sql<{ suggestion_lines: string[]; confirmed_at: string | null }>(`select suggestion_lines, confirmed_at from public.address_confirmations where user_id = $1`, [B]);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.suggestion_lines).toEqual(suggestion);

    // The console: not sendable, an exception that the automatic follow-up carries (not a person's yet).
    const now = new Date();
    const luz = clientsFromRows(await loadStaffRows(h.service)).find((c) => c.id === B)!;
    expect(luz.addressCheck).toMatchObject({ finding: "ambiguous", requests: 1, confirmedAt: null });
    expect(sendBlockReason(luz, now, { furnishers: [] })).toMatch(/confirmar/);
    expect(clientExceptions(luz, now).map((e) => e.kind)).toContain("client_address_unconfirmed");
    const state = followupStates(luz, now, ENV).find((s) => s.situation.kind === "address_unconfirmed");
    expect(state).toBeDefined();
    expect(state!.schedule.path).toBe("/confirmar-direccion");
    expect(workQueue([luz], now, { furnishers: [], autopilot: ENV }).map((i) => i.exception.kind)).not.toContain("client_address_unconfirmed");
  });

  it("the client's answer is recorded once and never rewritten", async () => {
    const [request] = await h.sql<{ id: string }>(`select id from public.address_confirmations where user_id = $1`, [B]);
    const confirm = await h.service
      .from("address_confirmations")
      .update({ confirmed_at: new Date().toISOString(), confirmed_lines: ["88 ELM ST", "APT 2", "HOUSTON, TX 77003-0001"] })
      .eq("id", request!.id);
    expect(confirm.error).toBeNull();
    const twice = await h.service.from("address_confirmations").update({ confirmed_lines: ["1 Other St", "Houston, TX 77003"] }).eq("id", request!.id);
    expect(twice.error).not.toBeNull();
  });

  it("a creditor address the post office does not deliver to stops counting as verified, for every client", async () => {
    const { data: entry } = await h.service
      .from("furnishers")
      .insert({ name: "Acme Collections", normalized_name: "ACMECOLLECTIONS", address_lines: ["1 Nowhere Rd", "Austin, TX 78701"], source: "https://acme.example/disputes", verified_on: "2026-11-01", updated_by_name: "carmen" })
      .select("id")
      .single();
    const id = (entry as { id: string }).id;
    const verifier = fakeVerifier([{ match: /Nowhere/, result: "undeliverable" }]);
    const check = await verifyRoundAddresses(
      h.service,
      { userId: A, roundNumber: 2, from: ["123 MAIN ST", "HOUSTON, TX 77002-1234"], recipients: [{ ref: "furnisher|Acme|furnisher_direct", type: "furnisher", key: "Acme Collections", name: "Acme Collections", lines: ["1 Nowhere Rd", "Austin, TX 78701"], entryId: id }] },
      verifier.verify,
      new Date(),
    );
    expect(check).toMatchObject({ ok: false, code: "furnisher_address_undeliverable" });
    const book = (await h.sql(`select * from public.furnishers where id = $1`, [id])).map((r) => furnisherFromRow(r as Record<string, unknown>));
    expect(book[0]!.verifiedOn).toBeNull();
    expect(resolveFurnisherAddress(book, "Acme Collections")).toMatchObject({ ok: false, reason: "not_verified" });
    const history = await h.sql<{ changed_by_name: string }>(`select changed_by_name from public.furnisher_changes where furnisher_id = $1 order by changed_at`, [id]);
    expect(history.at(-1)!.changed_by_name).toBe("sistema");
  });
});

describe("a returned letter: re-mailed once, never twice; billing never charges twice", () => {
  const later = new Date(Date.now() + 2 * DAY);

  it("a round whose letters all came back is not charged", async () => {
    await h.sql(
      `update public.letters set mail_status = 'returned', returned_at = now(), return_reason = 'Returned to Sender' where user_id = $1 and status <> 'draft'`,
      [A],
    );
    const { data: method } = await h.service
      .from("payment_methods")
      .insert({ user_id: A, gateway: "demo", brand: "visa", last4: "4242", authorization_version: "test", authorization_locale: "es", authorization_hash: "c".repeat(64) })
      .select("id")
      .single();
    await h.service.from("payment_method_vault").insert({ payment_method_id: (method as { id: string }).id, customer_ref: "demo_cus_test", payment_method_ref: "demo_pm_visa_4242" });
    expect(chargeEligibility((await loadBilling(h.service, A)).context, later)).toMatchObject({ eligible: false, code: "all_letters_returned" });
    const [round] = await h.sql<{ id: string }>(`select id from public.attack_rounds where user_id = $1`, [A]);
    const refused = await h.service.from("charges").insert({ user_id: A, round_id: round!.id, amount_cents: 8900 });
    expect(refused.error).not.toBeNull();
  });

  it("the system re-mails each returned letter once, to the corrected address, in the same round; a second run mails nothing", async () => {
    await saveAutopilotSettings(h.service, { roundsEnabled: true }, { userId: (await h.sql<{ user_id: string }>(`select user_id from public.staff_members limit 1`))[0]!.user_id, handle: "carmen" });
    const returned = await h.sql<{ id: string; round_id: string; target_address_lines: string[] }>(`select id, round_id, target_address_lines from public.letters where user_id = $1 and mail_status = 'returned'`, [A]);
    expect(returned.length).toBeGreaterThan(0);
    // The post office's data writes each bureau's address with its ZIP+4: a correction.
    const verifier = fakeVerifier([{ match: /P\.?O\.? Box|Box/i, result: "corrected", lines: ["PO BOX 9999", "ATLANTA, GA 30374-9999"] }]);
    const mail = fakeMail();
    const run1 = await handleReturnedLetters(h.service, later, { roundsEnabled: true, heldUserIds: new Set() }, { verifier: verifier.verify, mailLetter: mail.mailLetter });
    expect(run1.remailed).toHaveLength(returned.length);
    expect(mail.calls).toHaveLength(returned.length);
    const remails = await h.sql<{ id: string; remail_of: string; round_id: string; status: string; mail_status: string; target_address_lines: string[] }>(
      `select id, remail_of, round_id, status, mail_status, target_address_lines from public.letters where user_id = $1 and remail_of is not null`,
      [A],
    );
    expect(remails).toHaveLength(returned.length);
    for (const r of remails) {
      expect(r.round_id).toBe(returned[0]!.round_id);
      expect(r).toMatchObject({ status: "queued", mail_status: "in_transit", target_address_lines: ["PO BOX 9999", "ATLANTA, GA 30374-9999"] });
    }
    // Idempotent: the same idempotency key is the re-mail's own id.
    expect(new Set(mail.calls.map((c) => c.idempotencyKey))).toEqual(new Set(remails.map((r) => r.id)));

    const run2 = await handleReturnedLetters(h.service, later, { roundsEnabled: true, heldUserIds: new Set() }, { verifier: verifier.verify, mailLetter: mail.mailLetter });
    expect(run2.remailed).toHaveLength(0);
    expect(mail.calls).toHaveLength(returned.length);

    // Recorded once each, and the client is told by the autopilot's outbound log.
    expect(await h.sql(`select 1 from public.autopilot_resolutions where user_id = $1 and kind = 'letter_remailed'`, [A])).toHaveLength(returned.length);
    expect(await h.sql(`select 1 from public.outbound_messages where user_id = $1 and topic = 'letter_remailed' and status = 'queued'`, [A])).toHaveLength(returned.length);

    // The console: the returned letters are settled, the re-mails are on their way.
    const rosa = clientsFromRows(await loadStaffRows(h.service)).find((c) => c.id === A)!;
    expect(clientExceptions(rosa, later).map((e) => e.kind)).not.toContain("letter_returned");
    expect(rosa.rounds[0]!.letters.filter((l) => l.remailOf)).toHaveLength(returned.length);
  });

  it("the database refuses a second re-mail, a re-mail of a re-mail, and a re-mail of a letter that did not come back", async () => {
    const [original] = await h.sql<Record<string, unknown>>(`select * from public.letters where user_id = $1 and mail_status = 'returned' limit 1`, [A]);
    const base = {
      user_id: A,
      round_id: original!.round_id,
      target_type: original!.target_type,
      target_key: original!.target_key,
      target_name: original!.target_name,
      template_key: original!.template_key,
      escalation_stage: original!.escalation_stage,
      body: "x",
      status: "draft",
    };
    const again = await h.service.from("letters").insert({ ...base, remail_of: original!.id });
    expect(again.error).not.toBeNull();
    const [remail] = await h.sql<{ id: string }>(`select id from public.letters where remail_of = $1`, [original!.id]);
    await h.sql(`update public.letters set mail_status = 'returned', returned_at = now(), return_reason = 'Returned to Sender' where id = $1`, [remail!.id]);
    const ofRemail = await h.service.from("letters").insert({ ...base, remail_of: remail!.id });
    expect(ofRemail.error?.message ?? "").toMatch(/not re-mailed again/);
    const [other] = await h.sql<{ id: string }>(`select id from public.letters where user_id = $1 and mail_status = 'in_transit' and remail_of is not null and id <> $2 limit 1`, [A, remail!.id]);
    if (other) {
      const notBack = await h.service.from("letters").insert({ ...base, remail_of: other.id });
      expect(notBack.error).not.toBeNull();
    }
    // The returned re-mail goes to a person: the system does not send it a third time.
    const mail = fakeMail();
    const run = await handleReturnedLetters(h.service, later, { roundsEnabled: true, heldUserIds: new Set() }, { verifier: fakeVerifier([]).verify, mailLetter: mail.mailLetter });
    expect(run.remailed).toHaveLength(0);
    expect(mail.calls).toHaveLength(0);
    const reviewed = await h.sql<{ payload: { action: string } }>(`select payload from public.events where user_id = $1 and kind = 'letter_return_reviewed'`, [A]);
    expect(reviewed.map((r) => r.payload.action)).toContain("person");
    // Put it back in transit for the billing check below (a re-mail on its way).
    await h.sql(`update public.letters set mail_status = 'in_transit', returned_at = null, return_reason = null where id = $1`, [remail!.id]);
  });

  it("the re-mailed round is charged exactly once, for the signed fee; running billing again charges nothing, and the database refuses a second", async () => {
    expect(chargeEligibility((await loadBilling(h.service, A)).context, later)).toMatchObject({ eligible: true, roundNumber: 1 });
    const first = await runBillingForUser(h.service, createDemoGateway(), A, later);
    expect(first.paid).toBe(1);
    expect((await runBillingForUser(h.service, createDemoGateway(), A, new Date(later.getTime() + 40 * DAY))).paid).toBe(0);
    const charges = await h.sql<{ round_number: number; amount_cents: number }>(`select round_number, amount_cents from public.charges where user_id = $1`, [A]);
    expect(charges).toEqual([{ round_number: 1, amount_cents: 8900 }]);
    const [round] = await h.sql<{ id: string }>(`select id from public.attack_rounds where user_id = $1`, [A]);
    const twice = await h.service.from("charges").insert({ user_id: A, round_id: round!.id, amount_cents: 8900 });
    expect(twice.error).not.toBeNull();
  });
});

describe("one shared directory: a missing company is one queue item for every client waiting on it", () => {
  /** A client whose round 1 asked the bureaus for verification (mov) on her accounts: round 2 goes to the creditors directly. */
  async function waitingOnCreditors(name: string): Promise<string> {
    const id = await addClient(h, { name });
    await signAgreement(h, id, { signedDaysAgo: 80 });
    await addDocuments(h, id);
    await importReportForUser(h.service, id, sampleReport(2));
    const items = await h.sql<{ id: string; category: string; furnisher: unknown }>(`select id, category, furnisher from public.report_items where user_id = $1`, [id]);
    for (const item of items) {
      const attested = item.category === "tradeline" && Boolean(item.furnisher);
      const { error } = await h.service.from("item_flags").insert({
        user_id: id,
        item_id: item.id,
        state: attested ? "attested" : "correct",
        attested,
        reason: attested ? "No la reconozco." : "",
        reason_code: attested ? reasonsFor("tradeline")[0]!.code : null,
        attestation_text: attested ? "I believe this item is inaccurate." : null,
        attestation_version: attested ? "v1" : null,
        attested_at: attested ? new Date(Date.now() - 70 * DAY).toISOString() : null,
      });
      if (error) throw new Error(error.message);
    }
    const mailedAt = new Date(Date.now() - 60 * DAY).toISOString();
    const { data: round } = await h.service.from("attack_rounds").insert({ user_id: id, round_number: 1, status: "complete", approved_at: mailedAt, mailed_at: mailedAt }).select("id").single();
    const roundId = (round as { id: string }).id;
    for (const item of items.filter((i) => i.category === "tradeline" && i.furnisher)) {
      const { data: letter, error } = await h.service
        .from("letters")
        .insert({ user_id: id, round_id: roundId, target_type: "bureau", target_key: "equifax", target_name: "Equifax", template_key: "mov_request", escalation_stage: "mov", body: "x", status: "mailed", mailed_at: mailedAt, mail_status: "delivered", delivered_at: mailedAt })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      await h.service.from("letter_items").insert({ letter_id: (letter as { id: string }).id, item_id: item.id, escalation_stage: "mov" });
    }
    return id;
  }

  it("three clients wait on the same companies: one item per company, listing all three, and each company is first seen once", async () => {
    const ids = [await waitingOnCreditors("Ana Ruiz"), await waitingOnCreditors("Bea Soto"), await waitingOnCreditors("Celia Vera")];
    const now = new Date();
    const clients = clientsFromRows(await loadStaffRows(h.service)).filter((c) => ids.includes(c.id));
    expect(clients).toHaveLength(3);
    for (const c of clients) expect(clientExceptions(c, now, { furnishers: [] }).filter((e) => e.kind === "furnisher_address_missing").length).toBeGreaterThan(0);

    const queue = workQueue(clients, now, { furnishers: [], autopilot: ENV }).filter((i) => i.exception.kind === "furnisher_address_missing");
    const companies = new Set(queue.map((i) => i.group!.company));
    expect(queue).toHaveLength(companies.size);
    for (const item of queue) {
      expect(item.group!.waiting.map((w) => w.client.id).sort()).toEqual([...ids].sort());
      // The report prints an address for the company: offered as an unverified suggestion, never used to mail.
      expect(item.group!.suggestions.length).toBeGreaterThan(0);
      expect(item.action.href).toMatch(/direccion=/);
    }

    const deliver: Deliver = async () => ({ ok: true, providerRef: null });
    await runAutopilot(h.service, now, { deliver, channels: ENV.channels });
    const gaps = await h.sql<{ normalized_name: string; waiting_clients: number; first_seen_at: string }>(`select normalized_name, waiting_clients, first_seen_at from public.furnisher_gaps order by normalized_name`);
    expect(gaps.length).toBe(companies.size);
    for (const gap of gaps) expect(gap.waiting_clients).toBe(3);

    await runAutopilot(h.service, new Date(now.getTime() + 2 * 60 * 60 * 1000), { deliver, channels: ENV.channels });
    const again = await h.sql<{ first_seen_at: string }>(`select first_seen_at from public.furnisher_gaps order by normalized_name`);
    expect(again.map((g) => String(g.first_seen_at))).toEqual(gaps.map((g) => String(g.first_seen_at)));
    const rewrite = await h.service.from("furnisher_gaps").update({ first_seen_at: new Date(0).toISOString() }).eq("normalized_name", gaps[0]!.normalized_name);
    expect(rewrite.error).not.toBeNull();
  });
});
