import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEMO_CHANNELS, DEMO_SETTINGS } from "../autopilot/demo";
import { followupStates, openSituations } from "../autopilot/followups";
import { workQueue } from "../autopilot/queue";
import { resolvedBetween } from "../autopilot/resolutions";
import { statusMessage } from "../autopilot/status";
import type { AutopilotEnv } from "../autopilot/types";
import { checkClaimGuardrails } from "../compliance/guardrails";
import { verifyWithLob } from "../integrations/lobVerify";
import { reuploadRequest } from "../intake/reupload";
import { seededBook } from "../mail/data";
import { demoClientsWithMail } from "../mail/demo";
import { nearFurnishers } from "../mail/furnishers";
import { addressSuggestions } from "../mail/gaps";
import { decideReturn, isAddressRelatedReturn } from "../mail/returns";
import { roundMailPlan } from "../mail/sendPlan";
import { demoVerify, interpretLobVerification, lobVerificationRequest, uncheckedAddress, VERIFICATION_COST_MILLS, verificationPasses, type VerifiedAddress } from "../mail/verify";
import { parseUsAddress } from "../mail/address";
import { buildDemoClients } from "../staff/demoClients";
import { clientExceptions, latestRound, sendBlockReason } from "../staff/stage";

// What fixes itself (docs/AUTOPILOT.md, "Lo que se arregla solo"): the pure
// rules. The database side is in db/selfHealing.test.ts.

const NOW = new Date("2026-11-22T18:00:00Z");
const ENV: AutopilotEnv = { settings: DEMO_SETTINGS, channels: DEMO_CHANNELS };

describe("Lob's US verification: the request and what the answer means", () => {
  const input = ["123 Main St", "Apt 4", "Houston, TX 77002"];
  const parsed = parseUsAddress(input);

  it("sends the fields Lob's schema names, never the attention line", () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(lobVerificationRequest(parsed.address)).toEqual({ primary_line: "123 Main St", secondary_line: "Apt 4", city: "Houston", state: "TX", zip_code: "77002" });
    const attn = parseUsAddress(["Attn: Disputes", "P.O. Box 740256", "Atlanta, GA 30374-0256"]);
    if (attn.ok) expect(lobVerificationRequest(attn.address)).toEqual({ primary_line: "P.O. Box 740256", city: "Atlanta", state: "GA", zip_code: "30374-0256" });
  });

  it("deliverable as written, corrected (ZIP+4), ambiguous (a unit), undeliverable", () => {
    const answer = (deliverability: string, extra: Record<string, unknown> = {}) => ({
      deliverability,
      primary_line: "123 MAIN ST APT 4",
      secondary_line: "",
      components: { city: "HOUSTON", state: "TX", zip_code: "77002", zip_code_plus_4: "1234" },
      ...extra,
    });
    expect(interpretLobVerification(answer("deliverable"), input)).toMatchObject({ result: "corrected", lines: ["123 MAIN ST APT 4", "HOUSTON, TX 77002-1234"] });
    const same = interpretLobVerification({ deliverability: "deliverable", primary_line: "123 Main St", secondary_line: "Apt 4", components: { city: "Houston", state: "TX", zip_code: "77002", zip_code_plus_4: "" } }, input);
    expect(same).toMatchObject({ result: "deliverable", lines: ["123 Main St", "Apt 4", "Houston, TX 77002"] });
    expect(interpretLobVerification(answer("deliverable_missing_unit"), input).result).toBe("ambiguous");
    expect(interpretLobVerification(answer("deliverable_incorrect_unit"), input).result).toBe("ambiguous");
    expect(interpretLobVerification(answer("undeliverable"), input).result).toBe("undeliverable");
    // An answer we do not know is never a pass.
    expect(interpretLobVerification(answer("something_new"), input).result).toBe("ambiguous");
    expect(verificationPasses("ambiguous")).toBe(false);
    expect(verificationPasses("undeliverable")).toBe(false);
    expect(verificationPasses("unchecked")).toBe(true);
  });

  it("without a key nothing is called: the address is 'unchecked' (and the mail service is simulated in that case too)", async () => {
    const saved = process.env.LOB_API_KEY;
    delete process.env.LOB_API_KEY;
    try {
      const result = await verifyWithLob(input, { fetchImpl: async () => { throw new Error("must not be called"); } });
      expect(result).toMatchObject({ result: "unchecked", provider: "stub", costMills: 0 });
    } finally {
      if (saved) process.env.LOB_API_KEY = saved;
    }
  });

  it("with a key: Basic auth, POST /v1/us_verifications, the cost of one verification", async () => {
    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const result = await verifyWithLob(input, {
      apiKey: "test_key",
      fetchImpl: async (url, init) => {
        calls.push({ url, headers: init.headers, body: init.body });
        return { ok: true, status: 200, json: async () => ({ deliverability: "deliverable", primary_line: "123 MAIN ST APT 4", components: { city: "HOUSTON", state: "TX", zip_code: "77002", zip_code_plus_4: "1234" } }), text: async () => "" };
      },
    });
    expect(calls[0]!.url).toBe("https://api.lob.com/v1/us_verifications");
    expect(calls[0]!.headers.Authorization).toBe(`Basic ${Buffer.from("test_key:").toString("base64")}`);
    expect(JSON.parse(calls[0]!.body)).toMatchObject({ primary_line: "123 Main St", zip_code: "77002" });
    expect(result).toMatchObject({ result: "corrected", provider: "lob", costMills: VERIFICATION_COST_MILLS });
  });

  it("the send screen shows the verifications' cost apart from the letters'", () => {
    const demo = demoClientsWithMail(buildDemoClients(NOW), NOW);
    const client = demo.find((c) => latestRound(c)?.status === "ready" && c.id === "c07")!;
    const plan = roundMailPlan(client, latestRound(client)!, seededBook(), NOW);
    expect(plan.verifications).toBe(1 + plan.letters.length);
    expect(plan.verificationMills).toBe(plan.verifications * VERIFICATION_COST_MILLS);
    expect(readFileSync("src/app/equipo/enviar/page.tsx", "utf8")).toMatch(/verification-cost/);
  });

  it("the demo's stand-in answers like the service: ZIP+4 corrected, a missing unit, an old address", () => {
    expect(demoVerify(["915 Calle Ejemplo", "Houston, TX 77009"]).result).toBe("corrected");
    expect(demoVerify(["915 Calle Ejemplo Interior", "Houston, TX 77009"])).toMatchObject({ result: "ambiguous" });
    expect(demoVerify(["100 Old Street Apt 2", "Houston, TX 77009"]).result).toBe("undeliverable");
    expect(uncheckedAddress(["915 Calle Ejemplo", "Houston, TX 77009"]).result).toBe("unchecked");
  });
});

describe("the send path: a step added, none taken away", () => {
  const send = readFileSync("src/lib/rounds/send.ts", "utf8");
  it("verifies after the address book step and before the approved-letters step, and refuses what fails", () => {
    const step5 = send.indexOf('"furnisher_address_missing"');
    const step5b = send.indexOf("verifyRoundAddresses(");
    const step6 = send.indexOf("lettersMayBeMailed(");
    expect(step5).toBeGreaterThan(0);
    expect(step5b).toBeGreaterThan(step5);
    expect(step6).toBeGreaterThan(step5b);
    for (const gate of ['"attestation_missing"', '"client_address_missing"', '"furnisher_address_missing"', '"letters_not_approved"', '"billing_past_due"', '"monitoring_inactive"', '"already_sent"']) expect(send).toContain(gate);
    expect(send).toMatch(/if \(!verification\.ok\) return refuse/);
  });
});

describe("a returned letter: what the system does by itself", () => {
  const ok = (lines: string[], result: VerifiedAddress["result"] = "deliverable"): VerifiedAddress => ({ result, deliverability: result, lines, suggestion: [], provider: "lob", costMills: 50 });
  const base = {
    reason: "Returned to Sender",
    alreadyRemailed: false,
    recipientType: "bureau" as const,
    recipientName: "Equifax",
    sentTo: ["P.O. Box 740256", "Atlanta, GA 30374-0256"],
    target: ["P.O. Box 740256", "Atlanta, GA 30374-0256"],
    targetCheck: ok(["P.O. Box 740256", "Atlanta, GA 30374-0256"]),
    clientLines: ["123 Main St", "Houston, TX 77002"],
    clientCheck: ok(["123 Main St", "Houston, TX 77002"]),
    sentFrom: null,
  };

  it("only an address-related return is handled by itself", () => {
    expect(isAddressRelatedReturn("Returned to Sender")).toBe(true);
    expect(isAddressRelatedReturn("returned_to_sender")).toBe(true);
    expect(isAddressRelatedReturn("package_undeliverable")).toBe(true);
    for (const r of ["package_lost", "package_damaged", "package_unclaimed", "failed", null]) expect(isAddressRelatedReturn(r)).toBe(false);
    expect(decideReturn({ ...base, reason: "package_lost" }).action).toBe("person");
  });

  it("a correction re-mails; a re-mail never re-mails; the client's address asks the client; a creditor's bad address is marked", () => {
    // A case or punctuation change is not a correction; a ZIP+4 or a unit is.
    expect(decideReturn({ ...base, targetCheck: ok(["PO BOX 740256", "ATLANTA, GA 30374-0256"], "corrected") }).action).toBe("person");
    const corrected = decideReturn({ ...base, targetCheck: ok(["PO BOX 740256", "ATLANTA, GA 30374-0257"], "corrected") });
    expect(corrected).toMatchObject({ action: "remail", to: ["PO BOX 740256", "ATLANTA, GA 30374-0257"] });
    expect(decideReturn({ ...base, alreadyRemailed: true, targetCheck: ok(["X"], "corrected") }).action).toBe("person");
    expect(decideReturn({ ...base, clientCheck: { ...ok(base.clientLines, "ambiguous") } }).action).toBe("ask_client");
    expect(decideReturn({ ...base, recipientType: "furnisher", targetCheck: ok(base.target, "undeliverable") }).action).toBe("furnisher_bad");
    expect(decideReturn({ ...base, targetCheck: ok(base.target, "undeliverable") }).action).toBe("person");
    // Nothing to correct: a person.
    expect(decideReturn(base).action).toBe("person");
    // The client changed their address after the return: the same letter goes again from the new one.
    expect(decideReturn({ ...base, sentFrom: ["1 Old Rd", "Houston, TX 77002"] }).action).toBe("remail");
    // Without verification (no key) nothing is re-mailed by itself.
    expect(decideReturn({ ...base, targetCheck: ok(base.target, "unchecked") }).action).toBe("person");
  });
});

describe("documents the AI could not accept: a re-upload request with the plain reason", () => {
  it("asks for a new upload only when every doubt is one another photo fixes", () => {
    expect(reuploadRequest({ kind: "proof_of_address", status: "needs_person", reasons: ["Es un recibo de servicios.", "La foto está borrosa."] })?.motivo.es).toBe("la foto está borrosa");
    const old = reuploadRequest({ kind: "proof_of_address", status: "needs_person", reasons: ["Tiene más de 90 días (es del 3 de agosto). Se necesita uno más reciente."] });
    expect(old?.motivo.es).toMatch(/^tiene más de 90 días/);
    expect(reuploadRequest({ kind: "government_id", status: "needs_person", reasons: ["El documento parece modificado."] })).toBeNull();
    expect(reuploadRequest({ kind: "government_id", status: "needs_person", reasons: ["El nombre del documento no coincide con el de tu cuenta."] })).toBeNull();
    expect(reuploadRequest({ kind: "government_id", status: "needs_person", reasons: ["La revisión automática no está activa todavía. Una persona del equipo revisará tu documento."] })).toBeNull();
    expect(reuploadRequest({ kind: "government_id", status: "accepted", reasons: [] })).toBeNull();
  });

  it("the first failure is the system's (the client is asked); a second failure goes to a person", () => {
    const demo = buildDemoClients(NOW);
    const ramiro = demo.find((c) => c.id === "c09")!;
    const situation = openSituations(ramiro, NOW).find((s) => s.kind === "document_reupload");
    expect(situation?.exceptionKey).toMatch(/^document_check_needs_person:/);
    expect(situation?.values.es[1]).toMatch(/dirección del documento no coincide/);
    const twice = {
      ...ramiro,
      intake: [...(ramiro.intake ?? []), { id: "again", kind: "proof_of_address" as const, at: NOW.toISOString(), status: "needs_person" as const, simulated: true, reasons: ["La foto está borrosa."] }],
    };
    expect(openSituations(twice, NOW).some((s) => s.kind === "document_reupload")).toBe(false);
    const queue = workQueue([twice], new Date(NOW.getTime() + 60_000), { furnishers: seededBook(), autopilot: ENV });
    expect(queue.map((i) => i.exception.kind)).toContain("document_check_needs_person");
  });
});

describe("payments: one tap to fix, and the person's card shows exactly what the client was sent", () => {
  it("billing's notices carry the «Actualizar mi tarjeta» link and pass the claim rules", () => {
    for (const locale of ["es", "en"] as const) {
      const declined = statusMessage("u1", "Ana", locale, { kind: "payment_declined", chargeId: "ch1", attempts: 1, roundNumber: 2, amount: "$89.00", retryOn: { es: "25 de noviembre", en: "November 25" } }, "https://app.test");
      const paused = statusMessage("u1", "Ana", locale, { kind: "payment_declined", chargeId: "ch1", attempts: 3, roundNumber: 2, amount: "$89.00", retryOn: null }, "https://app.test");
      const missing = statusMessage("u1", "Ana", locale, { kind: "payment_method_needed", roundNumber: 2, workDate: { es: "1 de noviembre", en: "November 1" } }, "https://app.test");
      for (const m of [declined, paused, missing]) {
        expect(m.link).toBe("https://app.test/pagos/tarjeta");
        expect(m.body).toContain("https://app.test/pagos/tarjeta");
        expect(checkClaimGuardrails(m.body)).toEqual([]);
      }
      expect(declined.dedupeKey).not.toBe(paused.dedupeKey);
    }
  });

  it("the past-due item lists billing's notices word for word", () => {
    const demo = demoClientsWithMail(buildDemoClients(NOW), NOW);
    const queue = workQueue(demo, new Date(NOW.getTime() + 60_000), { furnishers: seededBook(), autopilot: ENV });
    const noemi = queue.find((i) => i.exception.kind === "payment_past_due")!;
    expect(noemi.messages?.length).toBe(3);
    expect(noemi.messages!.every((m) => m.body.includes("/pagos/tarjeta"))).toBe(true);
    expect(noemi.triedSummary).toMatch(/actualizar su tarjeta/);
  });

  it("the missing-method reminders link to the card page", () => {
    const demo = buildDemoClients(NOW);
    const baltazar = demo.find((c) => c.id === "c23")!;
    const state = followupStates(baltazar, NOW, ENV).find((s) => s.situation.kind === "payment_method_missing");
    expect(state?.schedule.path).toBe("/pagos/tarjeta");
  });
});

describe("one shared directory of creditors", () => {
  it("suggests the address the reports print, from every client, as unverified", () => {
    const demo = demoClientsWithMail(buildDemoClients(NOW), NOW);
    const suggestions = addressSuggestions(demo, "MIDLAND CREDIT MGMT", seededBook());
    expect(suggestions[0]).toMatchObject({ addressLines: ["350 Camino De La Reina", "San Diego, CA 92108"] });
    expect(suggestions[0]!.clients).toBeGreaterThanOrEqual(3);
  });

  it("offers a near name in the book as a possible same company, never as a match", () => {
    expect(nearFurnishers(seededBook(), "Midland Credit").map((e) => e.name)).toContain("Midland Credit Management");
    expect(nearFurnishers(seededBook(), "Midland Credit Management")).toHaveLength(0);
  });
});

describe("the client's address: confirmed by the client first", () => {
  it("an open request holds the round and is carried by the automatic follow-up, not a person", () => {
    const demo = buildDemoClients(NOW);
    const ramiro = demo.find((c) => c.id === "c09")!;
    expect(clientExceptions(ramiro, NOW).map((e) => e.kind)).toContain("client_address_unconfirmed");
    expect(sendBlockReason({ ...ramiro, report: { ...ramiro.report!, pulledAt: NOW.toISOString() } }, NOW)).toMatch(/confirmar/);
    const state = followupStates(ramiro, NOW, ENV).find((s) => s.situation.kind === "address_unconfirmed");
    expect(state).toMatchObject({ block: null, exhausted: false });
    expect(state!.sent.length).toBeGreaterThan(0);
    // Asked twice (the confirmed address failed too): a person at once.
    const again = { ...ramiro, addressCheck: { ...ramiro.addressCheck!, requests: 2 } };
    expect(followupStates(again, NOW, ENV).some((s) => s.situation.kind === "address_unconfirmed")).toBe(false);
  });

  it("'Resuelto solo' counts what the system settled this week", () => {
    const demo = demoClientsWithMail(buildDemoClients(NOW), NOW);
    const week = resolvedBetween(demo, new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000), NOW);
    expect(week.total).toBeGreaterThanOrEqual(5);
    expect(week.byKind.map((k) => k.kind)).toEqual(expect.arrayContaining(["address_confirmed", "letter_remailed", "document_reuploaded", "address_corrected"]));
  });
});
