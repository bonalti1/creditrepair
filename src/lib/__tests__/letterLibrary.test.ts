import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ASSISTANT_NAME, BRAND, CAMEO_NAME } from "@/lib/brand";
import { DEMO_RAW_REPORT } from "@/lib/demo";
import { PRIMARY_BUREAUS } from "@/lib/domain/bureaus";
import { parseReport } from "@/lib/domain/parser";
import type { ItemCategory, UserProfile } from "@/lib/domain/types";
import {
  CATEGORY_LABELS,
  getLetterMeta,
  LETTER_CATALOGUE,
  lettersFor,
  ORIGINAL_TEMPLATE_KEYS,
  renderLetter,
  TEMPLATES,
  type LetterContext,
  type LetterMeta,
} from "@/lib/letters/library";
import { buildLetterPacket, DECISION_LINE, PACKET_PATH, packetEntries } from "@/lib/letters/packet";
import { DISPUTE_REASONS, getDisputeReason, reasonsFor, suggestedTemplateFor } from "@/lib/letters/reasons";
import { TEMPLATES as TEMPLATES_FROM_TEMPLATES, renderLetter as renderFromTemplates } from "@/lib/letters/templates";
import { variationProblems } from "@/lib/letters/variation";

// Names that never appear in a consumer's letter: the old company name, the
// assistant, the internal project name and this company.
const NOT_IN_A_LETTER = new RegExp(`\\bCreditCapi\\b|\\b${ASSISTANT_NAME}\\b|\\b${CAMEO_NAME}\\b|${BRAND.internalName}|\\b${BRAND.name}\\b|on behalf of`, "i");

// The same sample context the original letter tests use.
const report = parseReport(DEMO_RAW_REPORT);
const user: UserProfile = {
  id: "u1",
  fullName: "María Fernanda López",
  addressLines: ["456 Calle Real", "Houston, TX 77002"],
  locale: "es",
};
const ctx: LetterContext = {
  user,
  target: PRIMARY_BUREAUS.equifax,
  items: report.items.filter((i) => i.bureau === "equifax" && i.category === "tradeline"),
  date: "2026-07-02T12:00:00.000Z",
  roundNumber: 2,
  enclosures: ["Copy of government-issued photo ID"],
};

const KEYS = Object.keys(TEMPLATES);
const render = (key: string, overrides: Partial<LetterContext> = {}) => renderLetter(key, { ...ctx, ...overrides });
const metaOf = (key: string): LetterMeta => {
  const meta = getLetterMeta(key);
  if (!meta) throw new Error(`No catalogue entry for ${key}`);
  return meta;
};
/** The letter between the "Re:" line and the signature: what the template itself says. */
const bodyOf = (letter: string) => letter.slice(letter.indexOf("Re:"), letter.lastIndexOf("Sincerely,"));

const ORIGINAL_TEN = [
  "personal_info_cleanup",
  "dispute_611_accounts",
  "dispute_611_inquiries",
  "dispute_611_public_records",
  "mov_request",
  "furnisher_direct",
  "debt_validation",
  "identity_theft_block",
  "goodwill_adjustment",
  "secondary_bureau_request",
];

describe("letter library — one map, one renderer", () => {
  it("library.ts and templates.ts expose the same TEMPLATES and renderLetter", () => {
    expect(TEMPLATES).toBe(TEMPLATES_FROM_TEMPLATES);
    expect(renderLetter).toBe(renderFromTemplates);
  });

  it("keeps the ten original templates under their original keys", () => {
    expect([...ORIGINAL_TEMPLATE_KEYS].sort()).toEqual([...ORIGINAL_TEN].sort());
    for (const key of ORIGINAL_TEN) expect(KEYS).toContain(key);
  });

  it("has a library of roughly 30 to 45 templates", () => {
    expect(KEYS.length).toBeGreaterThanOrEqual(30);
    expect(KEYS.length).toBeLessThanOrEqual(45);
  });
});

describe("every template renders a complete first-person letter", () => {
  it.each(KEYS)("%s", (key) => {
    const letter = render(key);
    expect(letter).toContain(user.fullName);
    expect(letter).toContain("456 Calle Real");
    expect(letter).toContain(PRIMARY_BUREAUS.equifax.name);
    expect(letter).toContain("July 2, 2026");
    expect(letter).toContain("Sincerely,");
    expect(letter).toContain("- Copy of government-issued photo ID");
    // No unfilled merge fields and no company speaking for the consumer.
    expect(letter).not.toMatch(/\{\{|\}\}|undefined|\[object/);
    expect(letter).not.toMatch(NOT_IN_A_LETTER);

    // The shape the wording checks rely on: header, "Re:" line, salutation, signature.
    const lines = letter.split("\n");
    expect(lines[0]).toBe(user.fullName);
    expect(lines.filter((l) => l.startsWith("Re: "))).toHaveLength(1);
    expect(letter).toContain("To Whom It May Concern:");
    expect(letter.indexOf("Re: ")).toBeLessThan(letter.indexOf("To Whom It May Concern:"));
    expect(letter.indexOf("To Whom It May Concern:")).toBeLessThan(letter.lastIndexOf("Sincerely,"));
    // First person, and English only.
    expect(bodyOf(letter)).toMatch(/\bI\b|\bmy\b/);
    expect(bodyOf(letter)).not.toMatch(/[¿¡ñáéíóú]/i);
    // No blank paragraphs left behind by an omitted optional part.
    expect(letter).not.toMatch(/\n{3,}/);
  });

  it.each(KEYS)("%s renders without enclosures, without items and with the client's own details", (key) => {
    const bare = render(key, { enclosures: undefined, items: [] });
    expect(bare).toContain("Sincerely,");
    expect(bare).not.toContain("Enclosures:");
    expect(bare).not.toContain("undefined");
    // The originals always receive items; the library letters also close up cleanly without any.
    if (!ORIGINAL_TEN.includes(key)) expect(bare).not.toMatch(/\n{3,}/);

    const words = "The balance shown is $1,240; my statement of May 2026 shows $310.";
    const detailed = render(key, { details: `  ${words}  ` });
    expect(detailed).not.toMatch(/undefined|\n{3,}/);
    // Details are either printed once, trimmed, as their own paragraph, or not at all.
    if (detailed.includes(words)) {
      expect(detailed.split(words)).toHaveLength(2);
      expect(detailed).toMatch(new RegExp(`\\n\\n[^\\n]*: ${words.replace(/[$.]/g, "\\$&")}\\n\\n`));
    } else {
      expect(detailed).toBe(render(key));
    }
  });

  it("lists exactly the items it was given, for every template that lists items", () => {
    for (const key of KEYS) {
      const itemLines = render(key)
        .split("\n")
        .filter((l) => l.startsWith("- ") && !l.includes("Copy of"));
      if (metaOf(key).appliesTo.length === 0) {
        expect(itemLines, key).toEqual([]);
      } else {
        expect(itemLines, key).toEqual(["- Capital One (****1234 · open)", "- Midland Credit Management (****8821 · collection)"]);
      }
    }
  });

  it("prints the client's own details only where a template supports them, and never invents them", () => {
    const marker = "ZZ-CLIENT-WORDS-ZZ";
    const supporting = KEYS.filter((key) => render(key, { details: marker }).includes(marker));
    // The originals are unchanged, so none of them prints details.
    for (const key of ORIGINAL_TEN) expect(supporting).not.toContain(key);
    expect(supporting).toContain("bureau_wrong_balance");
    expect(supporting).toContain("bureau_consumer_statement");
    expect(supporting).toContain("creditor_settlement_offer");
    for (const key of KEYS) expect(render(key)).not.toContain(marker);
  });
});

describe("catalogue — metadata for every template and nothing else", () => {
  it("has exactly one entry per template", () => {
    const catalogueKeys = LETTER_CATALOGUE.map((m) => m.key);
    expect(new Set(catalogueKeys).size).toBe(catalogueKeys.length);
    expect([...catalogueKeys].sort()).toEqual([...KEYS].sort());
    for (const key of KEYS) expect(getLetterMeta(key)?.key).toBe(key);
    expect(getLetterMeta("nope")).toBeUndefined();
  });

  it.each(LETTER_CATALOGUE.map((m) => [m.key, m] as const))("%s is complete and pending attorney review", (_key, meta) => {
    expect(meta.reviewStatus).toBe("attorney_pending");
    for (const text of [meta.title.es, meta.title.en, meta.useWhen.es, meta.useWhen.en]) expect(text.trim().length).toBeGreaterThan(5);
    // useWhen is one plain sentence in each language.
    for (const sentence of [meta.useWhen.es, meta.useWhen.en]) {
      expect(sentence.endsWith(".")).toBe(true);
      expect(sentence.slice(0, -1)).not.toMatch(/[.!?]\s/);
    }
    expect(Object.keys(CATEGORY_LABELS)).toContain(meta.category);
    expect(["bureau", "secondary_bureau", "furnisher", "collector"]).toContain(meta.recipient);
    expect(meta.requiresFacts.length).toBeGreaterThan(0);
    for (const fact of meta.requiresFacts) expect(fact).toMatch(/^Client |^The |^Proof /);
    if (meta.stageHint) expect(["dispute", "mov", "furnisher_direct", "follow_up"]).toContain(meta.stageHint);
    if (meta.attorneyAttention !== undefined) expect(meta.attorneyAttention.length).toBeGreaterThan(40);
    // Staff-facing text never promises a result.
    const staffText = [meta.useWhen.es, meta.useWhen.en, meta.staffNote ?? "", ...meta.requiresFacts].join(" ");
    expect(staffText).not.toMatch(/guarantee|garantiz|will be (deleted|removed)|será eliminad/i);
  });

  it("filters by recipient and by category", () => {
    expect(lettersFor()).toEqual(LETTER_CATALOGUE);
    for (const recipient of ["bureau", "secondary_bureau", "furnisher", "collector"] as const) {
      const found = lettersFor({ recipient });
      expect(found.length).toBeGreaterThan(0);
      expect(found.every((m) => m.recipient === recipient)).toBe(true);
    }
    for (const category of Object.keys(CATEGORY_LABELS) as Array<keyof typeof CATEGORY_LABELS>) {
      const found = lettersFor({ category });
      expect(found.length).toBeGreaterThan(0);
      expect(found.every((m) => m.category === category)).toBe(true);
    }
    expect(lettersFor({ recipient: "collector", category: "collector" }).map((m) => m.key)).toContain("collector_cease_communication");
    expect(lettersFor({ recipient: "collector", category: "file_access" })).toEqual([]);
  });

  it("covers the situations the library is meant to cover", () => {
    const required = [
      // Bureau, by reason
      "bureau_not_my_account",
      "bureau_never_late",
      "bureau_wrong_balance",
      "bureau_wrong_dates",
      "bureau_duplicate_account",
      "bureau_paid_or_settled",
      "bureau_closed_by_consumer",
      "bureau_included_in_bankruptcy",
      "bureau_obsolete_item",
      "bureau_mixed_file",
      "bureau_unauthorized_inquiry",
      "bureau_incorrect_public_record",
      // Bureau follow-ups
      "bureau_no_response",
      "bureau_frivolous_response",
      "bureau_consumer_statement",
      "bureau_reinsertion_notice",
      // Creditor / furnisher
      "furnisher_after_bureau_verified",
      "furnisher_date_of_first_delinquency",
      "creditor_authorized_user_removal",
      "creditor_settlement_offer",
      // Collector
      "collector_validation_follow_up",
      "collector_cease_communication",
      "collector_dispute_while_validation_pending",
      // Identity theft
      "identity_fraud_alert",
      "identity_theft_furnisher_notice",
      // File and access
      "file_disclosure_609",
      "free_annual_disclosure_612",
      "free_disclosure_adverse_action_612",
      "prescreen_opt_out",
    ];
    for (const key of [...required, ...ORIGINAL_TEN]) expect(KEYS, key).toContain(key);
  });
});

describe("citations", () => {
  // Kept separate from the table in library.ts on purpose: a wrong pairing there fails here.
  const FCRA_TO_USC: Record<string, string> = {
    "604": "1681b",
    "605": "1681c",
    "605A": "1681c-1",
    "605B": "1681c-2",
    "609": "1681g",
    "611": "1681i",
    "612": "1681j",
    "623": "1681s-2",
  };
  const FDCPA_TO_USC: Record<string, string> = { "805": "1692c", "809": "1692g" };
  const SUB = String.raw`((?:\([A-Za-z0-9]+\))*)`;
  const FCRA = new RegExp(String.raw`^FCRA § (\d{3}[A-Z]?)${SUB} \(15 U\.S\.C\. § (1681[a-z](?:-\d)?)${SUB}\)$`);
  const FDCPA = new RegExp(String.raw`^FDCPA § (\d{3})${SUB} \(15 U\.S\.C\. § (1692[a-z])${SUB}\)$`);
  const CFR = /^12 C\.F\.R\. § 1022\.\d+$/;

  it("every statute string is a known citation with the right U.S. Code cross-reference", () => {
    for (const meta of LETTER_CATALOGUE) {
      for (const statute of meta.statutes) {
        if (CFR.test(statute)) continue;
        const fcra = FCRA.exec(statute);
        const fdcpa = FDCPA.exec(statute);
        expect(fcra ?? fdcpa, `${meta.key}: ${statute}`).not.toBeNull();
        const [, section, sectionSub, usc, uscSub] = (fcra ?? fdcpa)!;
        expect((fcra ? FCRA_TO_USC : FDCPA_TO_USC)[section], `${meta.key}: ${statute}`).toBe(usc);
        expect(uscSub, `${meta.key}: ${statute}`).toBe(sectionSub);
      }
    }
  });

  it("every section a letter cites is in its catalogue entry, with the right U.S. Code section", () => {
    for (const key of KEYS) {
      const letter = render(key);
      const listed = metaOf(key).statutes.join(" | ");
      for (const [, section] of letter.matchAll(/Sections? (\d{3}[A-Z]?)/g)) {
        expect(listed, `${key} cites Section ${section}`).toMatch(new RegExp(`(FCRA|FDCPA) § ${section}(?![0-9A-Z])`));
      }
      for (const [, section] of letter.matchAll(/and (\d{3}[A-Z]?)\b/g)) {
        expect(listed, `${key} cites ${section}`).toContain(`§ ${section}`);
      }
      for (const [, usc] of letter.matchAll(/15 U\.S\.C\. § (\d{4}[a-z](?:-\d)?)/g)) {
        expect(listed, `${key} cites 15 U.S.C. § ${usc}`).toContain(`15 U.S.C. § ${usc}`);
      }
      if (letter.includes("C.F.R.")) expect(listed, key).toContain("12 C.F.R. § 1022.43");
    }
  });

  it("pairs each section with its own U.S. Code section inside the letters", () => {
    const pairs: Array<[RegExp, string]> = [
      [/Section 604(?:\([a-z0-9]+\))* of the Fair Credit Reporting Act \(15 U\.S\.C\. § ([\w-]+)/g, "1681b"],
      [/Section 605 of the Fair Credit Reporting Act \(15 U\.S\.C\. § ([\w-]+)/g, "1681c"],
      [/Section 605A(?:\([a-z0-9]+\))* of the Fair Credit Reporting Act \(15 U\.S\.C\. § ([\w-]+)/g, "1681c-1"],
      [/Section 609(?:\([a-z0-9]+\))* of the (?:Fair Credit Reporting )?Act \(15 U\.S\.C\. § ([\w-]+)/g, "1681g"],
      [/Section 611(?:\([A-Za-z0-9]+\))* of the (?:Fair Credit Reporting )?Act \(15 U\.S\.C\. § ([\w-]+)/g, "1681i"],
      [/Section 612(?:\([a-z0-9]+\))* of the Fair Credit Reporting Act \(15 U\.S\.C\. § ([\w-]+)/g, "1681j"],
      [/Section 623(?:\([A-Za-z0-9]+\))* of the Fair Credit Reporting Act \(15 U\.S\.C\. § ([\w-]+)/g, "1681s-2"],
      [/Section 805(?:\([a-z0-9]+\))* of the Fair Debt Collection Practices Act \(15 U\.S\.C\. § ([\w-]+)/g, "1692c"],
      [/Section 809(?:\([a-z0-9]+\))* of the Fair Debt Collection Practices Act \(15 U\.S\.C\. § ([\w-]+)/g, "1692g"],
    ];
    let checked = 0;
    for (const key of KEYS) {
      const letter = render(key);
      for (const [pattern, usc] of pairs) {
        for (const match of letter.matchAll(pattern)) {
          expect(match[1], `${key}: ${match[0]}`).toBe(usc);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(30);
  });
});

describe("what a letter may never say", () => {
  const BANNED: Array<[string, RegExp]> = [
    ["Credalti", /credalti/i],
    ["CreditCapi", /creditcapi/i],
    ["on behalf of", /on behalf of/i],
    ["lawsuit", /lawsuit/i],
    ["sue", /\b(sue|sues|sued|suing)\b/i],
    ["attorney", /attorney|lawyer/i],
    ["guarantee", /guarantee/i],
    ["must delete", /must delete|must remove/i],
    ["violat", /violat/i],
    // Pressure tactics and promises in other words.
    ["legal action", /legal action|litigation|court action|damages/i],
    ["or else", /or else|failure to comply|fail to comply|demand/i],
    ["credit repair", /credit repair/i],
  ];

  it.each(KEYS)("%s contains no company name, threat, accusation or promise", (key) => {
    for (const details of [undefined, "My records show a different amount."]) {
      const letter = render(key, { details });
      for (const [name, pattern] of BANNED) expect(letter, `${key} contains "${name}"`).not.toMatch(pattern);
    }
  });

  it("mentions a regulator complaint only in follow-up letters", () => {
    for (const key of KEYS) {
      if (/Consumer Financial Protection Bureau|CFPB|complaint/i.test(render(key))) {
        expect(metaOf(key).stageHint, key).toBe("follow_up");
      }
    }
  });

  it("only the new letters ask; none of them tells the recipient what it must do", () => {
    for (const key of KEYS.filter((k) => !ORIGINAL_TEN.includes(k))) {
      expect(bodyOf(render(key)), key).not.toMatch(/\byou must\b|\byou are required\b|\bimmediately\b|\bwithin \d+ days or\b/i);
    }
  });
});

describe("a letter states a fact only when its required facts include it", () => {
  // What the letter says  →  what the catalogue entry's requiresFacts must say.
  const CLAIMS: Array<{ claim: string; inLetter: RegExp; inFacts: RegExp }> = [
    { claim: "identity theft", inLetter: /identity theft/i, inFacts: /identity theft/i },
    { claim: "fraud", inLetter: /fraud/i, inFacts: /fraud/i },
    { claim: "bankruptcy", inLetter: /bankruptcy|bankrupt/i, inFacts: /bankruptcy/i },
    {
      claim: "not mine / not my account",
      inLetter: /not mine|not my account|do(es)? not belong to me|did not open/i,
      inFacts: /not theirs|does not belong to them|did not open/i,
    },
    {
      claim: "payment",
      inLetter: /\bI paid\b|\bwas paid\b|\bwere paid\b|made (those|my|the|each) payments?|paid (it|them) /i,
      inFacts: /\bpaid\b|made on time/i,
    },
    {
      claim: "a prior dispute",
      inLetter: /I (previously )?disputed|dispute I (mailed|sent)|I sent you a written dispute|request for verification that I sent|my dispute of the item/i,
      inFacts: /disputed|sent a written dispute|mailed a written dispute|the dispute was determined/i,
    },
    { claim: "the debt is medical", inLetter: /medical|health insurance/i, inFacts: /medical/i },
    { claim: "authorized user", inLetter: /authorized user/i, inFacts: /authorized user/i },
    { claim: "sent within thirty days", inLetter: /within thirty days/i, inFacts: /within 30 days/i },
    { claim: "an adverse action notice", inLetter: /denial of credit|adverse action/i, inFacts: /adverse action notice/i },
  ];

  it.each(CLAIMS)("$claim", ({ inLetter, inFacts }) => {
    const making: string[] = [];
    for (const key of KEYS) {
      if (!inLetter.test(bodyOf(render(key)))) continue;
      making.push(key);
      expect(metaOf(key).requiresFacts.join(" "), `${key} makes this claim without a required fact`).toMatch(inFacts);
    }
    expect(making.length).toBeGreaterThan(0);
  });

  it("limits each sensitive claim to the templates written for it", () => {
    const keysSaying = (pattern: RegExp) => KEYS.filter((key) => pattern.test(bodyOf(render(key)))).sort();
    expect(keysSaying(/identity theft/i)).toEqual(["identity_fraud_alert", "identity_theft_block", "identity_theft_furnisher_notice"]);
    expect(keysSaying(/fraud/i)).toEqual(["identity_fraud_alert"]);
    expect(keysSaying(/bankruptcy/i)).toEqual(["bureau_included_in_bankruptcy"]);
    expect(keysSaying(/not mine|not my account|do(es)? not belong to me/i)).toEqual(["bureau_mixed_file", "bureau_not_my_account"]);
  });
});

describe("Section 609 is a right to see the file, not to have anything taken off it", () => {
  const citing609 = KEYS.filter((key) => /Section 609|1681g/.test(render(key)) || metaOf(key).statutes.some((s) => s.includes("§ 609")));

  it("finds the Section 609 letters", () => {
    expect(citing609.sort()).toEqual(
      ["file_disclosure_609", "free_annual_disclosure_612", "free_disclosure_adverse_action_612", "secondary_bureau_request"].sort(),
    );
  });

  it.each(citing609)("%s asks for disclosure only", (key) => {
    const body = bodyOf(render(key, { enclosures: undefined }));
    expect(body).not.toMatch(/delet|remov|eras|block|original (signed )?(contract|agreement)|wet ink/i);
    expect(body).toMatch(/disclosure|copy of my consumer file/i);
  });

  it("no letter anywhere ties deletion to a missing signed contract, except the flagged original", () => {
    for (const key of KEYS) {
      if (/signed (contract|agreement)|original contract/i.test(render(key))) {
        expect(key).toBe("debt_validation");
        expect(metaOf(key).attorneyAttention).toMatch(/original signed agreement/);
      }
    }
  });
});

describe("the rules for collectors and sensitive templates are recorded in the metadata", () => {
  it("flags the sensitive templates for the attorney", () => {
    for (const key of [
      "creditor_settlement_offer",
      "goodwill_adjustment",
      "collector_cease_communication",
      "identity_theft_block",
      "identity_theft_furnisher_notice",
      "bureau_medical_collection",
    ]) {
      expect(metaOf(key).attorneyAttention, key).toBeTruthy();
    }
    // Anything that says "medical" anywhere is flagged.
    for (const meta of LETTER_CATALOGUE) {
      if (/medical/i.test(JSON.stringify(meta)) || /medical/i.test(render(meta.key))) expect(meta.attorneyAttention, meta.key).toBeTruthy();
    }
  });

  it("validation letters are framed as within-30-days requests and their notes say so", () => {
    for (const key of KEYS.filter((k) => metaOf(k).statutes.some((s) => s.startsWith("FDCPA § 809")))) {
      const meta = metaOf(key);
      const notes = [meta.useWhen.en, meta.staffNote ?? "", meta.attorneyAttention ?? "", ...meta.requiresFacts].join(" ");
      expect(notes, key).toMatch(/within 30 days|30 days/);
      expect(meta.staffNote, key).toMatch(/within 30 days/);
      // Every new validation letter says so in the letter itself.
      if (!ORIGINAL_TEN.includes(key)) expect(render(key), key).toMatch(/within thirty days/);
    }
  });

  it("the cease-communication letter is for the client's explicit request only", () => {
    const meta = metaOf("collector_cease_communication");
    const notes = `${meta.attorneyAttention} ${meta.staffNote} ${meta.requiresFacts.join(" ")}`;
    expect(notes).toMatch(/does not erase the debt/);
    expect(notes).toMatch(/lawsuit/);
    expect(notes).toMatch(/explicit request|explicitly asked/);
    // The letter itself only asks for contact to stop: no refusal to pay, no admission.
    const letter = render("collector_cease_communication");
    expect(letter).not.toMatch(/refuse to pay|will not pay/i);
    expect(letter).toContain("not an acknowledgment that I owe this debt");
  });

  it("the settlement offer asks and does not demand", () => {
    const letter = render("creditor_settlement_offer", { details: "I can pay $400 in one payment." });
    expect(letter).toContain("My offer is as follows: I can pay $400 in one payment.");
    expect(letter).toMatch(/I ask that you consider/);
    expect(letter).toMatch(/this is your decision/);
    expect(letter).toMatch(/not an acknowledgment/);
    expect(letter).not.toMatch(/in exchange for|on condition|only if you|you agree to delete/i);
    // Without an amount from the client the letter invents none.
    expect(render("creditor_settlement_offer")).not.toMatch(/\$\s?\d/);
  });

  it("no collector letter acknowledges the debt", () => {
    for (const meta of lettersFor({ recipient: "collector" })) {
      expect(render(meta.key), meta.key).not.toMatch(/\bmy debt\b|\bI owe (you|this|the)\b(?! debt\.)|the debt I owe/i);
    }
  });
});

describe("every template survives the wording-variation checks", () => {
  it.each(KEYS)("%s", (key) => {
    for (const overrides of [{}, { details: "The date shown is March 2021; my records show June 2019." }, { enclosures: undefined }]) {
      const original = render(key, overrides);
      expect(variationProblems(original, original)).toEqual([]);
      // The checks have something to hold on to: a header above "Re:" and a signature.
      const head = original.slice(0, original.indexOf("Re:"));
      expect(head).toContain(user.fullName);
      expect(head).toContain(PRIMARY_BUREAUS.equifax.name);
      expect(variationProblems(original, original.replace(user.fullName, "Someone Else"))).toContain("header block changed");
      expect(variationProblems(original, original.replace(/Sincerely,\n\n.*/, "Sincerely,\n\nSomeone Else"))).toContain(
        "signature block changed",
      );
    }
  });

  it("a reworded letter that drops a citation or an item is rejected", () => {
    const original = render("bureau_reinsertion_notice");
    expect(variationProblems(original, original.replaceAll("15 U.S.C. § 1681i", "federal law")).join(" ")).toMatch(/citation missing/);
    expect(variationProblems(original, original.replaceAll("Section 611(a)(5)(B)", "the law")).join(" ")).toMatch(/citation missing/);
    expect(variationProblems(original, original.replace("- Capital One (****1234 · open)\n", ""))).toContain("item lines changed");
    // Rewording prose alone is accepted.
    expect(variationProblems(original, original.replace("I am writing about", "I am contacting you about"))).toEqual([]);
  });
});

describe("dispute reasons", () => {
  const CODES = [
    "not_mine",
    "never_late",
    "wrong_balance",
    "wrong_dates",
    "duplicate",
    "paid_or_settled",
    "closed_by_me",
    "in_bankruptcy",
    "obsolete",
    "mixed_file",
    "unauthorized_inquiry",
    "identity_theft",
    "wrong_personal_info",
    "other",
  ];
  const ITEM_CATEGORIES: ItemCategory[] = ["tradeline", "inquiry", "public_record", "personal_info"];

  it("has exactly the standard reasons, each once", () => {
    expect(DISPUTE_REASONS.map((r) => r.code)).toEqual(CODES);
    for (const code of CODES) expect(getDisputeReason(code)?.code).toBe(code);
    expect(getDisputeReason("nope")).toBeUndefined();
  });

  it.each(DISPUTE_REASONS.map((r) => [r.code, r] as const))("%s is complete and points at a real template", (_code, reason) => {
    expect(reason.label.es.trim().length).toBeGreaterThan(3);
    expect(reason.label.en.trim().length).toBeGreaterThan(3);
    expect(reason.appliesTo.length).toBeGreaterThan(0);
    for (const category of reason.appliesTo) expect(ITEM_CATEGORIES).toContain(category);

    // One English sentence in the first person, with nothing a letter may not say.
    expect(reason.sentence).toMatch(/^[A-Z].*\.$/);
    expect(reason.sentence.slice(0, -1)).not.toMatch(/[.!?]\s/);
    expect(reason.sentence).toMatch(/\bI\b|\bmy\b|\bme\b/);
    expect(reason.sentence).not.toMatch(/[¿¡ñáéíóú]|credalti|lawsuit|attorney|guarantee|must delete|violat/i);

    expect(Object.keys(TEMPLATES)).toContain(reason.suggestedTemplate);
    for (const template of Object.values(reason.templateByCategory ?? {})) expect(Object.keys(TEMPLATES)).toContain(template);
    // For each kind of item the reason applies to, the suggested letter can list that kind of item.
    for (const category of reason.appliesTo) {
      const template = suggestedTemplateFor(reason, category);
      expect(metaOf(template).appliesTo, `${reason.code}/${category} → ${template}`).toContain(category);
    }
  });

  it("a reason asserts only what its suggested letter asserts", () => {
    expect(getDisputeReason("identity_theft")?.suggestedTemplate).toBe("identity_theft_block");
    expect(getDisputeReason("in_bankruptcy")?.suggestedTemplate).toBe("bureau_included_in_bankruptcy");
    for (const reason of DISPUTE_REASONS) {
      if (/identity theft/i.test(reason.sentence)) expect(reason.code).toBe("identity_theft");
      if (/bankruptcy/i.test(reason.sentence)) expect(reason.code).toBe("in_bankruptcy");
      if (/fraud/i.test(reason.sentence)) expect(reason.code).toBe("identity_theft");
    }
  });

  it("offers every kind of item at least a specific reason and 'other'", () => {
    for (const category of ITEM_CATEGORIES) {
      const codes = reasonsFor(category).map((r) => r.code);
      expect(codes).toContain("other");
      expect(codes.length).toBeGreaterThan(2);
    }
  });
});

describe("attorney review packet", () => {
  const packet = buildLetterPacket();

  it("the committed docs/LETTER-LIBRARY.md is exactly what the script writes", () => {
    const committed = readFileSync(resolve(process.cwd(), PACKET_PATH), "utf8");
    expect(committed, "docs/LETTER-LIBRARY.md is stale: run `npm run letters:packet` and commit the result").toBe(packet);
  });

  it("is deterministic", () => {
    expect(buildLetterPacket()).toBe(packet);
  });

  it("has a cover note and one entry, one letter and one decision line per template", () => {
    expect(packet).toMatch(/drafts pending attorney review/i);
    expect(packet).toContain("in the consumer's own name");
    expect(packet).toContain("What we are asking you to check");
    const entries = packetEntries();
    expect(entries.map((e) => e.meta.key).sort()).toEqual([...KEYS].sort());
    expect(entries.map((e) => e.number)).toEqual(entries.map((_, i) => i + 1));
    expect(packet.split(DECISION_LINE).length - 1).toBe(KEYS.length + 1); // each entry, plus the cover note's mention
    expect(packet.split("```text").length - 1).toBe(KEYS.length);
    for (const entry of entries) {
      expect(packet).toContain(`\`${entry.meta.key}\``);
      expect(packet).toContain(entry.letter);
      expect(packet).toContain(entry.meta.useWhen.en);
      for (const fact of entry.meta.requiresFacts) expect(packet).toContain(fact);
      if (entry.meta.attorneyAttention) expect(packet).toContain(entry.meta.attorneyAttention);
      // The sample letters obey the same rules as any other letter.
      expect(entry.letter).toContain("Elena Marisol Vargas");
      expect(entry.letter).toContain("January 15, 2026");
      expect(entry.letter).not.toMatch(/undefined|\{\{|credalti|on behalf of/i);
      expect(variationProblems(entry.letter, entry.letter)).toEqual([]);
    }
  });
});
