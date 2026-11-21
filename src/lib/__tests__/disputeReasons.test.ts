import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ATTESTATION_TEXT } from "@/lib/compliance/attestation";
import { checkMarketingCopy } from "@/lib/compliance/guardrails";
import { DEMO_REPORT } from "@/lib/demo";
import { PRIMARY_BUREAUS } from "@/lib/domain/bureaus";
import type { ItemCategory, UserProfile } from "@/lib/domain/types";
import { DICTS } from "@/lib/i18n/dictionaries";
import { DISPUTE_REASONS, getDisputeReason, reasonsFor } from "@/lib/letters/reasons";
import {
  letterPrintsReasons,
  renderLetter,
  TEMPLATES,
  TEMPLATES_WITHOUT_REASONS,
  type LetterContext,
} from "@/lib/letters/templates";
import { variationProblems } from "@/lib/letters/variation";
import { buildDemoClients } from "@/lib/staff/demoClients";
import { staffLetterText } from "@/lib/staff/letters";
import {
  canConfirmDispute,
  confirmBlockers,
  EMPTY_DRAFT,
  isDisputeReasonCode,
  itemReasonsFrom,
  reasonApplies,
  reasonChoices,
  reasonLabel,
  reasonSentence,
} from "@/lib/ux/disputeReason";
import { flagPutSchema, storedReasonCode } from "@/lib/ux/flagsApi";
import { normalizeFlags } from "@/lib/ux/flagsStore";
import { letterCoverageRows } from "@/lib/ux/roundCopy";
import { sessionPlan } from "@/lib/ux/sessionPlan";

// A stated reason for every disputed item: the customer picks a standard
// reason, the letter prints its sentence after the item, and an answer
// confirmed before reasons existed still counts and prints none.

const items = DEMO_REPORT.items;
const find = (name: string, bureau: string) => items.find((i) => i.name === name && i.bureau === bureau)!;
const personal = (field: string) => items.find((i) => i.category === "personal_info" && i.data.field === field)!;
const midland = find("Midland Credit Management", "equifax");
const capitalOne = find("Capital One", "equifax");
const AT = "2026-11-20T12:00:00.000Z";
const CATEGORIES: ItemCategory[] = ["tradeline", "inquiry", "public_record", "personal_info"];

const user: UserProfile = { id: "u1", fullName: "María Fernanda López", addressLines: ["456 Calle Real", "Houston, TX 77002"], locale: "es" };
const ctx: LetterContext = {
  user,
  target: PRIMARY_BUREAUS.equifax,
  items: [capitalOne, midland],
  date: "2026-07-02T12:00:00.000Z",
  roundNumber: 2,
  enclosures: ["Copy of government-issued photo ID"],
};
const NOT_MINE = "This account is not mine; I did not open it and did not authorize anyone to open it in my name.";
const itemLinesOf = (letter: string) => letter.split("\n").filter((l) => l.startsWith("- "));

describe("a reason is required to confirm", () => {
  const ready = { reasonCode: "not_mine", note: "", attested: true };

  it("opens with nothing chosen, nothing written and the box unchecked", () => {
    expect(EMPTY_DRAFT).toEqual({ reasonCode: null, note: "", attested: false });
    for (const category of CATEGORIES) {
      expect(canConfirmDispute(category, EMPTY_DRAFT)).toBe(false);
      expect(confirmBlockers(category, EMPTY_DRAFT)).toEqual(["reason", "attestation"]);
    }
  });

  it("does not confirm without a reason, even with the attestation checked", () => {
    expect(canConfirmDispute("tradeline", { ...ready, reasonCode: null })).toBe(false);
    expect(confirmBlockers("tradeline", { ...ready, reasonCode: null })).toEqual(["reason"]);
    // Writing something is not picking a reason.
    expect(canConfirmDispute("tradeline", { reasonCode: null, note: "No la reconozco", attested: true })).toBe(false);
  });

  it("confirms with a reason and the attestation; the note stays optional", () => {
    expect(canConfirmDispute("tradeline", ready)).toBe(true);
    expect(confirmBlockers("tradeline", ready)).toEqual([]);
    expect(canConfirmDispute("tradeline", { ...ready, note: "El saldo no coincide" })).toBe(true);
  });

  it("the attestation checkbox still gates the button, whatever else is filled in", () => {
    for (const category of CATEGORIES) {
      for (const reason of reasonsFor(category)) {
        const draft = { reasonCode: reason.code, note: "con mis palabras", attested: false };
        expect(canConfirmDispute(category, draft)).toBe(false);
        expect(confirmBlockers(category, draft)).toEqual(["attestation"]);
        expect(canConfirmDispute(category, { ...draft, attested: true })).toBe(true);
      }
    }
  });

  it("'other' needs the customer's own words", () => {
    expect(confirmBlockers("inquiry", { reasonCode: "other", note: "", attested: true })).toEqual(["note"]);
    expect(confirmBlockers("inquiry", { reasonCode: "other", note: "   \n ", attested: true })).toEqual(["note"]);
    expect(canConfirmDispute("inquiry", { reasonCode: "other", note: "Esa fecha no existe", attested: true })).toBe(true);
    // Only "other": every other reason confirms with an empty note.
    for (const reason of DISPUTE_REASONS.filter((r) => r.code !== "other")) {
      expect(canConfirmDispute(reason.appliesTo[0]!, { reasonCode: reason.code, note: "", attested: true })).toBe(true);
    }
  });

  it("rejects a reason that is not offered for that kind of item, and anything that is not a reason", () => {
    expect(canConfirmDispute("inquiry", { ...ready, reasonCode: "never_late" })).toBe(false);
    expect(canConfirmDispute("tradeline", { ...ready, reasonCode: "unauthorized_inquiry" })).toBe(false);
    expect(canConfirmDispute("tradeline", { ...ready, reasonCode: "because" })).toBe(false);
    expect(reasonApplies("never_late", "tradeline")).toBe(true);
    expect(reasonApplies("never_late", "personal_info")).toBe(false);
    expect(isDisputeReasonCode("not_mine")).toBe(true);
    for (const junk of ["", "NOT_MINE", "nope", null, undefined, 3, {}]) expect(isDisputeReasonCode(junk)).toBe(false);
  });

  it("identity theft does not block: it confirms like any other reason", () => {
    for (const category of CATEGORIES) {
      expect(canConfirmDispute(category, { reasonCode: "identity_theft", note: "", attested: true })).toBe(true);
    }
  });
});

describe("the reason picker is neutral", () => {
  it("offers the catalogue's reasons for the item's category, in the catalogue's order", () => {
    for (const category of CATEGORIES) {
      const expected = DISPUTE_REASONS.filter((r) => r.appliesTo.includes(category)).map((r) => r.code);
      expect(reasonChoices(category).map((r) => r.code)).toEqual(expected);
      expect(expected[expected.length - 1]).toBe("other");
    }
    expect(reasonChoices("inquiry").map((r) => r.code)).toEqual(["mixed_file", "unauthorized_inquiry", "identity_theft", "other"]);
  });

  it("selects nothing by default and draws every choice the same way", () => {
    const source = readFileSync("src/components/DisputeFields.tsx", "utf8");
    expect(source).not.toMatch(/defaultChecked|defaultValue|recommended|suggested|popular/i);
    // One class list for every choice: the only difference is the one the customer made (:checked).
    expect(source.match(/data-reason=\{choice\.code\}/g)).toHaveLength(1);
    expect(source).toContain("checked={draft.reasonCode === choice.code}");
    // The legal text is the attestation module's, shown as is.
    expect(source).toContain("{ATTESTATION_TEXT[locale]}");
  });

  it("uses the two review screens' one rule for the confirm button", () => {
    for (const file of ["src/app/(app)/asistente/page.tsx", "src/app/(app)/items/page.tsx"]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toContain("<DisputeFields category=");
      expect(source, file).toContain("canConfirmDispute(");
      expect(source, file).toContain("disabled={!canConfirm}");
    }
  });

  it("its wording asks, and never suggests disputing or promises anything", () => {
    for (const locale of ["es", "en"] as const) {
      const d = DICTS[locale].items;
      const lines = [
        d.reasonTitle,
        d.reasonHelp,
        d.reasonRequired,
        d.otherNeedsNote,
        d.identityTheftNote,
        d.detailsLabel,
        d.detailsLabelOther,
        d.detailsPlaceholder,
        d.detailsNote,
        d.reasonOf("x"),
        d.inLetter,
      ];
      for (const line of lines) {
        expect(checkMarketingCopy(line), line).toEqual([]);
        expect(line, line).not.toMatch(/disput|recomend|recommend|suger|suggest|conviene|should|deber[ií]as|mejor|best|elimin|remov|borra|delet/i);
      }
      expect(d.identityTheftNote).toMatch(/FTC/);
      expect(d.identityTheftNote).toMatch(locale === "es" ? /persona del equipo/ : /person from the team/);
    }
    for (const reason of DISPUTE_REASONS) {
      expect(checkMarketingCopy(reason.label.es), reason.code).toEqual([]);
      expect(checkMarketingCopy(reason.label.en), reason.code).toEqual([]);
    }
  });

  it("leaves the attestation text alone", () => {
    expect(ATTESTATION_TEXT.es).toBe("Creo que este elemento es inexacto, no verificable o está desactualizado.");
    expect(ATTESTATION_TEXT.en).toBe("I believe this item is inaccurate, unverifiable, or outdated.");
  });

  it("reads a stored code back as the label and the sentence, and nothing for no reason", () => {
    expect(reasonLabel("not_mine", "es")).toBe("Esta cuenta no es mía");
    expect(reasonLabel("not_mine", "en")).toBe("This account is not mine");
    expect(reasonSentence("not_mine")).toBe(NOT_MINE);
    for (const none of [undefined, null, "", "nope"]) {
      expect(reasonLabel(none, "es")).toBeNull();
      expect(reasonSentence(none)).toBeNull();
    }
  });
});

describe("the reason is printed on the item's line", () => {
  const reasons = { [midland.fingerprint]: "not_mine", [capitalOne.fingerprint]: "never_late" };

  it("ends the item's line with the reason's sentence, on the same line", () => {
    const letter = renderLetter("dispute_611_accounts", { ...ctx, itemReasons: reasons });
    expect(itemLinesOf(letter)).toEqual([
      "- Capital One (****1234 · open): I made my payments on this account on time, and the late payments reported are not accurate.",
      `- Midland Credit Management (****8821 · collection): ${NOT_MINE}`,
      "- Copy of government-issued photo ID",
    ]);
  });

  it("an item without a reason is listed exactly as before", () => {
    const plain = renderLetter("dispute_611_accounts", ctx);
    expect(renderLetter("dispute_611_accounts", { ...ctx, itemReasons: {} })).toBe(plain);
    expect(renderLetter("dispute_611_accounts", { ...ctx, itemReasons: undefined })).toBe(plain);
    // A reason for one item changes that line and no other.
    const one = renderLetter("dispute_611_accounts", { ...ctx, itemReasons: { [midland.fingerprint]: "not_mine" } });
    expect(itemLinesOf(one)[0]).toBe("- Capital One (****1234 · open)");
    expect(itemLinesOf(one)[1]).toBe(`- Midland Credit Management (****8821 · collection): ${NOT_MINE}`);
    expect(one.replace(`: ${NOT_MINE}`, "")).toBe(plain);
  });

  it("ignores a code that is not in the catalogue, and a reason for an item the letter does not list", () => {
    const plain = renderLetter("dispute_611_accounts", ctx);
    expect(renderLetter("dispute_611_accounts", { ...ctx, itemReasons: { [midland.fingerprint]: "made_up" } })).toBe(plain);
    expect(renderLetter("dispute_611_accounts", { ...ctx, itemReasons: { "some-other-item": "not_mine" } })).toBe(plain);
  });

  it.each(Object.keys(TEMPLATES))("%s: reasons add no line, drop no line, and change nothing else", (key) => {
    const plain = renderLetter(key, ctx);
    const withReasons = renderLetter(key, { ...ctx, itemReasons: reasons });
    const before = itemLinesOf(plain);
    const after = itemLinesOf(withReasons);
    expect(after).toHaveLength(before.length);
    expect(withReasons.split("\n")).toHaveLength(plain.split("\n").length);
    after.forEach((line, index) => expect(line.startsWith(before[index]!)).toBe(true));
    const stripped = Object.values(reasons).reduce((text, code) => text.replace(`: ${reasonSentence(code)}`, ""), withReasons);
    expect(stripped).toBe(plain);
    if (!letterPrintsReasons(key)) expect(withReasons).toBe(plain);
  });

  it("prints reasons in the letters the round engine sends to bureaus and furnishers", () => {
    for (const key of ["personal_info_cleanup", "dispute_611_accounts", "dispute_611_inquiries", "dispute_611_public_records", "mov_request", "furnisher_direct"]) {
      expect(letterPrintsReasons(key), key).toBe(true);
      expect(renderLetter(key, { ...ctx, itemReasons: reasons }), key).toContain(`: ${NOT_MINE}`);
    }
  });

  it("never prints a reason in a goodwill request, a letter that disputes nothing, or a letter to a debt collector", () => {
    expect([...TEMPLATES_WITHOUT_REASONS].sort()).toEqual(
      [
        "collector_cease_communication",
        "collector_dispute_while_validation_pending",
        "collector_validation_30_day",
        "collector_validation_follow_up",
        "creditor_authorized_user_removal",
        "creditor_settlement_offer",
        "debt_validation",
        "goodwill_adjustment",
      ].sort(),
    );
    for (const key of TEMPLATES_WITHOUT_REASONS) {
      expect(Object.keys(TEMPLATES), key).toContain(key);
      const letter = renderLetter(key, { ...ctx, itemReasons: reasons });
      expect(letter, key).toBe(renderLetter(key, ctx));
      for (const reason of DISPUTE_REASONS) expect(letter, key).not.toContain(reason.sentence);
    }
    expect(renderLetter("goodwill_adjustment", { ...ctx, itemReasons: reasons })).toContain("I am not disputing the accuracy");
  });

  it("the customer's own words never reach a letter", () => {
    const note = "NO ES MÍA, NUNCA TUVE ESA CUENTA";
    const flags = { [midland.fingerprint]: { state: "attested", reason: note, reasonCode: "other", attestedAt: AT } };
    const session = sessionPlan(items, flags);
    expect(session.attestedFlags[0]!.reason).toBe(note);
    for (const planned of session.plan.letters) {
      const letter = renderLetter(planned.templateKey, {
        ...ctx,
        target: planned.target,
        items: items.filter((i) => planned.itemFingerprints.includes(i.fingerprint)),
        itemReasons: session.itemReasons,
      });
      expect(letter).not.toContain(note);
      if (planned.itemFingerprints.length > 0) {
        expect(letter).toContain("(****8821 · collection): I believe this information is not accurate or not complete.");
      }
    }
  });
});

describe("a letter with reasons survives the wording-variation checks", () => {
  const reasons = { [midland.fingerprint]: "not_mine", [capitalOne.fingerprint]: "wrong_balance" };
  const original = renderLetter("dispute_611_accounts", { ...ctx, itemReasons: reasons });

  it("is clean against itself and against a rewrite of the prose only", () => {
    expect(variationProblems(original, original)).toEqual([]);
    const varied = original.replace("I am exercising my right", "I am writing to exercise my right");
    expect(varied).not.toBe(original);
    expect(variationProblems(original, varied)).toEqual([]);
  });

  it("keeps each item and its reason as one protected '- ' line", () => {
    expect(itemLinesOf(original).filter((l) => l.includes("): "))).toHaveLength(2);
    // Rewording the reason, dropping it, or moving it to its own line is rejected.
    const reworded = original.replace("This account is not mine;", "This is not my account;");
    expect(variationProblems(original, reworded)).toContain("item lines changed");
    expect(variationProblems(original, original.replace(`: ${NOT_MINE}`, ""))).toContain("item lines changed");
    expect(variationProblems(original, original.replace(`: ${NOT_MINE}`, `\n${NOT_MINE}`))).toContain("item lines changed");
  });

  it.each(Object.keys(TEMPLATES))("%s with reasons is clean", (key) => {
    const letter = renderLetter(key, { ...ctx, itemReasons: reasons });
    expect(variationProblems(letter, letter)).toEqual([]);
  });
});

describe("the flags route validates the reason against the catalogue", () => {
  const base = { fingerprint: midland.fingerprint, state: "attested", reasonCode: "not_mine" };

  it("accepts every reason in the catalogue", () => {
    for (const reason of DISPUTE_REASONS) {
      const parsed = flagPutSchema.safeParse({ ...base, reasonCode: reason.code, reason: "con mis palabras" });
      expect(parsed.success, reason.code).toBe(true);
      if (parsed.success) expect(parsed.data.reasonCode).toBe(reason.code);
    }
  });

  it("rejects a code that is not in the catalogue", () => {
    for (const reasonCode of ["nope", "NOT_MINE", "not mine", "", 7, "not_mine; drop table"]) {
      const parsed = flagPutSchema.safeParse({ ...base, reasonCode });
      expect(parsed.success, String(reasonCode)).toBe(false);
    }
  });

  it("a confirmed answer needs a reason; 'other' needs the customer's words", () => {
    expect(flagPutSchema.safeParse({ fingerprint: "f", state: "attested" }).success).toBe(false);
    expect(flagPutSchema.safeParse({ ...base, reasonCode: "other" }).success).toBe(false);
    expect(flagPutSchema.safeParse({ ...base, reasonCode: "other", reason: "  " }).success).toBe(false);
    expect(flagPutSchema.safeParse({ ...base, reasonCode: "other", reason: "Esa fecha no existe" }).success).toBe(true);
    expect(flagPutSchema.safeParse({ ...base, reason: "x".repeat(501) }).success).toBe(false);
  });

  it("'looks correct' and clearing an answer need no reason, and store none", () => {
    const correct = flagPutSchema.parse({ fingerprint: "f", state: "correct" });
    expect(storedReasonCode(correct)).toBeNull();
    expect(storedReasonCode(flagPutSchema.parse({ fingerprint: "f", state: "correct", reasonCode: "not_mine" }))).toBeNull();
    expect(flagPutSchema.safeParse({ fingerprint: "f", state: null }).success).toBe(true);
    expect(storedReasonCode(flagPutSchema.parse(base))).toBe("not_mine");
    expect(storedReasonCode(flagPutSchema.parse({ fingerprint: "f", state: "flagged" }))).toBeNull();
  });

  it("the route uses that schema, checks the reason fits the item, and reads and writes reason_code", () => {
    const route = readFileSync("src/app/api/flags/route.ts", "utf8");
    expect(route).toContain("flagPutSchema.safeParse(");
    expect(route).toContain("reasonApplies(reasonCode, item.category)");
    expect(route).toContain("reason_code: reasonCode");
    expect(route).toMatch(/select\("state, reason, reason_code, attested_at/);
    // The approval route reads the code from item_flags and hands it to the letters.
    const approve = readFileSync("src/app/api/attacks/approve/route.ts", "utf8");
    expect(approve).toContain("f.reason_code");
    expect(approve).toMatch(/enclosures,\s+itemReasons,/);
  });

  it("migration 0008 adds a nullable reason_code with a shape check every catalogue code passes", () => {
    const sql = readFileSync("supabase/migrations/0008_dispute_reason.sql", "utf8").replace(/--.*$/gm, "");
    expect(sql).toMatch(/alter table public\.item_flags\s+add column reason_code text\s+check \(reason_code ~ '\^\[a-z_\]\{2,40\}\$'\);/);
    expect(sql).not.toMatch(/not null|default|drop|update /i);
    for (const reason of DISPUTE_REASONS) expect(reason.code).toMatch(/^[a-z_]{2,40}$/);
  });
});

describe("answers saved before reasons existed", () => {
  // Exactly what the app wrote to localStorage before this change.
  const stored = JSON.stringify({
    [midland.fingerprint]: { state: "attested", reason: "No la reconozco", attestedAt: AT },
    [capitalOne.fingerprint]: { state: "correct" },
    [personal("name").fingerprint]: { state: "flagged", reason: "" },
  });

  it("load unchanged, with no reason code", () => {
    const flags = normalizeFlags(JSON.parse(stored));
    expect(flags).toEqual(JSON.parse(stored));
    expect(flags[midland.fingerprint]!.reasonCode).toBeUndefined();
  });

  it("still count, and their letter line has no reason", () => {
    const session = sessionPlan(items, normalizeFlags(JSON.parse(stored)));
    expect(session.attestedFlags.map((f) => f.fingerprint)).toEqual([midland.fingerprint]);
    expect(session.itemReasons).toEqual({});
    const planned = session.plan.letters.find((l) => l.itemFingerprints.includes(midland.fingerprint))!;
    const letter = renderLetter(planned.templateKey, { ...ctx, items: [midland], itemReasons: session.itemReasons });
    expect(itemLinesOf(letter)[0]).toBe("- Midland Credit Management (****8821 · collection)");
    expect(letterCoverageRows(planned, items, session.itemReasons, "es")).toEqual([
      { key: midland.fingerprint, label: "Midland Credit Management", reasonLabel: null, sentence: null },
    ]);
  });

  it("the new shape round-trips, and only adds a field to the old one", () => {
    const next = {
      [midland.fingerprint]: { state: "attested", reason: "", reasonCode: "not_mine", attestedAt: AT },
    };
    const flags = normalizeFlags(JSON.parse(JSON.stringify(next)));
    expect(flags).toEqual(next);
    const session = sessionPlan(items, flags);
    expect(session.itemReasons).toEqual({ [midland.fingerprint]: "not_mine" });
  });

  it("a code that is not in the catalogue is dropped and the answer kept; junk is not an answer", () => {
    const flags = normalizeFlags({
      a: { state: "attested", reasonCode: "retired_reason", attestedAt: AT },
      b: { state: "nonsense" },
      c: "attested",
      d: null,
    });
    expect(flags).toEqual({ a: { state: "attested", attestedAt: AT } });
    for (const junk of [null, undefined, "x", 3, []]) expect(normalizeFlags(junk)).toEqual({});
    expect(itemReasonsFrom({ a: { reasonCode: "retired_reason" }, b: { reasonCode: null }, c: undefined, d: { reasonCode: "obsolete" } })).toEqual({ d: "obsolete" });
  });
});

describe("the reason follows the item through the plan, the previews and the staff console", () => {
  const address = personal("address");
  const flags = {
    [address.fingerprint]: { state: "attested", reasonCode: "wrong_personal_info", attestedAt: AT },
    [midland.fingerprint]: { state: "attested", reasonCode: "not_mine", attestedAt: AT },
    // Not confirmed: its reason goes nowhere.
    [capitalOne.fingerprint]: { state: "flagged", reasonCode: "never_late" },
  };

  it("the session plan carries the reasons of confirmed items only", () => {
    const session = sessionPlan(items, flags);
    expect(session.itemReasons).toEqual({ [address.fingerprint]: "wrong_personal_info", [midland.fingerprint]: "not_mine" });
  });

  it("the approve card shows, per item, the reason and the sentence the letter prints", () => {
    const session = sessionPlan(items, flags);
    const letter = session.plan.letters[0]!;
    expect(letterCoverageRows(letter, items, session.itemReasons, "es")).toEqual([
      {
        key: address.fingerprint,
        label: "Dirección: 123 Old Street Apt 2, Houston, TX 77001",
        reasonLabel: "Este dato personal está mal o ya no es mío",
        sentence: "This personal information is not accurate or no longer applies to me.",
      },
    ]);
    expect(letterCoverageRows(letter, items, session.itemReasons, "en")[0]!.reasonLabel).toBe(
      "This personal detail is wrong or no longer mine",
    );
    // A file request lists no item and no reason.
    const fileRequest = { ...letter, templateKey: "secondary_bureau_request", itemFingerprints: [] };
    expect(letterCoverageRows(fileRequest, items, session.itemReasons, "es")).toEqual([
      { key: "file-request", label: "solicitud de expediente", reasonLabel: null, sentence: null },
    ]);
    // A letter that prints no reasons shows the customer's reason and no sentence.
    const collector = { ...letter, templateKey: "debt_validation", itemFingerprints: [midland.fingerprint] };
    expect(letterCoverageRows(collector, items, session.itemReasons, "es")[0]).toMatchObject({
      reasonLabel: "Esta cuenta no es mía",
      sentence: null,
    });
  });

  const now = new Date("2026-12-05T18:00:00.000Z");
  const clients = buildDemoClients(now);
  const byId = (id: string) => clients.find((c) => c.id === id)!;

  it("demo clients give a reason that fits each item; two answered before reasons existed", () => {
    const withCodes = clients.filter((c) => !["c12", "c13"].includes(c.id));
    let seen = 0;
    for (const client of withCodes) {
      for (const item of client.report?.items ?? []) {
        const answer = client.answers[item.fingerprint];
        if (answer?.status !== "inaccurate") continue;
        seen += 1;
        expect(reasonApplies(answer.reasonCode, item.category), `${client.id} ${item.name}`).toBe(true);
      }
    }
    expect(seen).toBeGreaterThan(20);
    for (const id of ["c12", "c13"]) {
      const answers = Object.values(byId(id).answers).filter((a) => a.status === "inaccurate");
      expect(answers.length).toBeGreaterThan(0);
      for (const answer of answers) {
        expect(answer.status === "inaccurate" && answer.reasonCode).toBeUndefined();
        expect(answer.status === "inaccurate" && answer.reason.length).toBeGreaterThan(5);
      }
    }
  });

  it("a staff letter prints the reason sentences, and none for an old answer", () => {
    const anselmo = byId("c07");
    const round = anselmo.rounds[0]!;
    const text = staffLetterText(anselmo, round, round.letters[0]!, now);
    const lines = itemLinesOf(text).filter((l) => !/Copy of|Proof of/.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toMatch(/: This personal information is not accurate or no longer applies to me\.$/);
    // The client's own Spanish words are on file for staff and are not in the letter.
    for (const answer of Object.values(anselmo.answers)) {
      if (answer.status === "inaccurate") expect(text).not.toContain(answer.reason);
    }

    const heriberto = byId("c12");
    const old = heriberto.rounds[0]!;
    for (const letter of old.letters) {
      expect(letter.itemReasons).toEqual({});
      const body = staffLetterText(heriberto, old, letter, now);
      for (const reason of DISPUTE_REASONS) expect(body).not.toContain(reason.sentence);
    }
  });

  it("staff see the reason and cannot set it", () => {
    const page = readFileSync("src/app/equipo/clientes/[id]/page.tsx", "utf8");
    expect(page).toContain("sin motivo");
    expect(page).toContain('reasonLabel(answer.reasonCode, "es")');
    expect(page).not.toMatch(/<select|type="radio"|DisputeFields|reasonCode:\s|setReason/);
    // The staff data layer still has no operation that writes an answer or a reason.
    const data = readFileSync("src/lib/staff/data.ts", "utf8");
    const api = data.slice(data.indexOf("export interface StaffData"), data.indexOf("// ── Demo implementation"));
    const methods = [...api.matchAll(/^  (\w+)\(/gm)].map((m) => m[1]);
    expect(methods).toEqual(["listClients", "getClient", "markRoundsSent", "addNote", "resolveException"]);
  });

  it("every catalogue reason has a label and a sentence the screens can show", () => {
    for (const reason of DISPUTE_REASONS) {
      expect(reasonLabel(reason.code, "es")).toBe(getDisputeReason(reason.code)!.label.es);
      expect(reasonSentence(reason.code)).toBe(reason.sentence);
    }
  });
});
