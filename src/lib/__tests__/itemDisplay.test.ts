import { createHash } from "crypto";
import { describe, expect, it } from "vitest";
import { ATTESTATION_TEXT } from "@/lib/compliance/attestation";
import { checkMarketingCopy } from "@/lib/compliance/guardrails";
import { DEMO_REPORT } from "@/lib/demo";
import { parseReport } from "@/lib/domain/parser";
import type { ReportItem } from "@/lib/domain/types";
import { DICTS } from "@/lib/i18n/dictionaries";
import { AFFILIATE_DISCLOSURE } from "@/lib/monitoring/offer";
import { messageText, type ChatMsg } from "@/lib/ux/chatStore";
import { HUMAN_HELP, humanHelpHref } from "@/lib/ux/humanHelp";
import {
  ITEM_KIND_LINES,
  itemFacts,
  itemKindLine,
  itemLabel,
  itemReadAloud,
  itemTitle,
  itemCheckHints,
  PERSONAL_INFO_HINT_LINES,
} from "@/lib/ux/itemDisplay";
import { nextAction, sessionJourneyState } from "@/lib/ux/journey";
import { sessionPlan } from "@/lib/ux/sessionPlan";
import { getCategoryExplainers } from "@/lib/ux/explainers";

const find = (name: string, bureau: string) =>
  DEMO_REPORT.items.find((i) => i.name === name && i.bureau === bureau)!;
const personal = (field: string) =>
  DEMO_REPORT.items.find((i) => i.category === "personal_info" && i.data.field === field)!;
const asMap = (item: ReportItem, locale: "es" | "en") =>
  Object.fromEntries(itemFacts(item, locale).map((f) => [f.label, f.value]));

const midland = find("Midland Credit Management", "equifax");
const capitalOne = find("Capital One", "equifax");
const inquiry = find("Auto Finance Corp", "equifax");

describe("itemFacts", () => {
  it("shows Midland as a collection with its balance, in Spanish", () => {
    expect(asMap(midland, "es")).toEqual({
      "Tipo de cuenta": "Cobranza",
      "Número de cuenta": "****8821",
      Estado: "En cobranza",
      "Estado de pago": "Dada de baja (charge-off)",
      Saldo: "$1,250",
      Notas: "Enviada a cobranza",
    });
  });

  it("shows Midland in readable English", () => {
    expect(asMap(midland, "en")).toEqual({
      "Account type": "Collection",
      "Account number": "****8821",
      Status: "In collection",
      "Payment status": "Charge-off",
      Balance: "$1,250",
      Remarks: "Placed for collection",
    });
  });

  it("shows Capital One's type, masked number and balance", () => {
    expect(asMap(capitalOne, "es")).toEqual({
      "Tipo de cuenta": "Tarjeta de crédito",
      "Número de cuenta": "****1234",
      Estado: "Abierta",
      "Estado de pago": "Al corriente",
      Saldo: "$480",
    });
    expect(asMap(capitalOne, "en")).toMatchObject({
      "Account type": "Credit card",
      "Account number": "****1234",
      Status: "Open",
      "Payment status": "Current",
      Balance: "$480",
    });
  });

  it("leaves out what the report does not say", () => {
    // Capital One has no opened date and an empty remarks list in the demo data.
    const labels = itemFacts(capitalOne, "es").map((f) => f.label);
    expect(labels).not.toContain("Fecha de apertura");
    expect(labels).not.toContain("Notas");
    // Midland on Experian has no remarks either.
    expect(itemFacts(find("Midland Credit Management", "experian"), "es").map((f) => f.label)).not.toContain("Notas");

    // A tradeline that arrives with only a creditor has no facts at all: nothing is invented.
    const bare = parseReport({
      source: "test",
      pulledAt: "2026-07-01T00:00:00.000Z",
      bureaus: { experian: { tradelines: [{ creditor: "Acme Bank" }] } },
    }).items[0]!;
    expect(itemFacts(bare, "es")).toEqual([]);
    expect(itemFacts(bare, "en")).toEqual([]);
  });

  it("keeps a zero balance, which is a fact, and formats cents and dates", () => {
    const item = parseReport({
      source: "test",
      pulledAt: "2026-07-01T00:00:00.000Z",
      bureaus: {
        equifax: {
          tradelines: [
            { creditor: "Zero Bank", balance: 0, openedAt: "2019-03-05" },
            { creditor: "Cents Bank", balance: 1250.5, openedAt: "2019-03" },
          ],
        },
      },
    }).items;
    expect(asMap(item[0]!, "es")).toEqual({ Saldo: "$0", "Fecha de apertura": "5 de marzo de 2019" });
    expect(asMap(item[0]!, "en")).toEqual({ Balance: "$0", Opened: "March 5, 2019" });
    expect(asMap(item[1]!, "en")).toEqual({ Balance: "$1,250.50", Opened: "March 2019" });
  });

  it("falls back to the report's own words for values it does not know", () => {
    const item = parseReport({
      source: "test",
      pulledAt: "2026-07-01T00:00:00.000Z",
      bureaus: {
        equifax: {
          tradelines: [
            {
              creditor: "Odd Bank",
              accountType: "timeshare",
              status: "60 days late",
              paymentStatus: "in_dispute",
              openedAt: "spring 2019",
              remarks: ["consumer statement on file"],
            },
          ],
        },
      },
    }).items[0]!;
    expect(asMap(item, "es")).toEqual({
      "Tipo de cuenta": "timeshare",
      Estado: "60 días de atraso",
      "Estado de pago": "in_dispute",
      "Fecha de apertura": "spring 2019",
      Notas: "consumer statement on file",
    });
    expect(asMap(item, "en")).toMatchObject({
      "Account type": "Timeshare",
      Status: "60 days late",
      "Payment status": "In dispute",
    });
  });

  it("shows an inquiry's date and type", () => {
    expect(asMap(inquiry, "es")).toEqual({ Fecha: "14 de marzo de 2026", "Tipo de consulta": "Dura" });
    expect(asMap(inquiry, "en")).toEqual({ Date: "March 14, 2026", "Inquiry type": "Hard" });
  });

  it("shows a public record's type, court, filed date and status", () => {
    const record = parseReport({
      source: "test",
      pulledAt: "2026-07-01T00:00:00.000Z",
      bureaus: {
        transunion: {
          publicRecords: [
            { recordType: "bankruptcy", court: "S.D. Texas", filedAt: "2021-02-10", status: "discharged" },
            { recordType: "lien" },
          ],
        },
      },
    }).items;
    expect(asMap(record[0]!, "es")).toEqual({
      "Tipo de registro": "Bancarrota",
      Tribunal: "S.D. Texas",
      "Fecha de registro": "10 de febrero de 2021",
      Estado: "Descargado",
    });
    expect(asMap(record[1]!, "en")).toEqual({ "Record type": "Lien" });
  });

  it("adds nothing to personal info beyond its title", () => {
    for (const item of DEMO_REPORT.items.filter((i) => i.category === "personal_info")) {
      expect(itemFacts(item, "es")).toEqual([]);
    }
  });
});

describe("itemTitle", () => {
  it("labels personal info in the reader's language and keeps the value alone as the title", () => {
    expect(itemTitle(personal("address"), "es")).toEqual({
      kicker: "Dirección",
      title: "123 Old Street Apt 2, Houston, TX 77001",
    });
    expect(itemTitle(personal("address"), "en").kicker).toBe("Address");
    expect(itemTitle(personal("name"), "es")).toEqual({ kicker: "Nombre", title: "R. BONALTI JR" });
    expect(itemTitle(personal("employer"), "es")).toEqual({ kicker: "Empleador", title: "ACME LLC" });
    expect(itemTitle(personal("employer"), "en").kicker).toBe("Employer");
  });

  it("covers date of birth, SSN variants and fields it has never seen", () => {
    const items = parseReport({
      source: "test",
      pulledAt: "2026-07-01T00:00:00.000Z",
      bureaus: {
        equifax: {
          personalInfo: [
            { field: "dob", value: "1980-01-02" },
            { field: "ssn_variant", value: "***-**-1234" },
            { field: "phone_number", value: "713-555-0100" },
          ],
        },
      },
    }).items;
    expect(items.map((i) => itemTitle(i, "es").kicker)).toEqual([
      "Fecha de nacimiento",
      "Variante de Seguro Social",
      "Phone number",
    ]);
    expect(items.map((i) => itemTitle(i, "en").kicker)).toEqual(["Date of birth", "SSN variant", "Phone number"]);
    expect(items.map((i) => i.name)).toEqual([
      "Date of birth: 1980-01-02",
      "SSN variant: ***-**-1234",
      "Phone number: 713-555-0100",
    ]);
  });

  it("uses the creditor or inquirer as it is for everything else", () => {
    expect(itemTitle(midland, "es")).toEqual({ kicker: null, title: "Midland Credit Management" });
    expect(itemTitle(inquiry, "en")).toEqual({ kicker: null, title: "Auto Finance Corp" });
    expect(itemLabel(midland, "es")).toBe("Midland Credit Management");
    expect(itemLabel(personal("name"), "es")).toBe("Nombre: R. BONALTI JR");
  });
});

describe("itemKindLine", () => {
  it("calls a collection a collection", () => {
    expect(itemKindLine(midland, "es")).toBe("Una cobranza: una deuda que pasó a una agencia de cobro.");
    expect(itemKindLine(midland, "en")).toMatch(/^A collection:/);
  });

  it("is specific for cards, inquiries and personal info", () => {
    expect(itemKindLine(capitalOne, "es")).toBe("Una tarjeta de crédito a tu nombre.");
    expect(itemKindLine(inquiry, "es")).toMatch(/^Una consulta dura:/);
    expect(itemKindLine(personal("address"), "es")).toMatch(/^Una dirección/);
    expect(itemKindLine(personal("employer"), "en")).toMatch(/^An employer/);
  });

  it("falls back to the category explainer when the data does not say", () => {
    const bare = parseReport({
      source: "test",
      pulledAt: "2026-07-01T00:00:00.000Z",
      bureaus: { experian: { tradelines: [{ creditor: "Acme Bank" }] } },
    }).items[0]!;
    expect(itemKindLine(bare, "es")).toBe(getCategoryExplainers("es").tradeline.what);
    expect(itemKindLine(bare, "en")).toBe(getCategoryExplainers("en").tradeline.what);
  });

  it("reads the card aloud without spelling out the mask on the account number", () => {
    const spoken = itemReadAloud(midland, "es");
    expect(spoken).toContain("Una cobranza");
    expect(spoken).toContain("Saldo: $1,250.");
    expect(spoken).toContain("termina en 8821");
    expect(spoken).not.toContain("*");
  });
});

describe("personal-info names for the letter", () => {
  it("reads as English in a letter", () => {
    expect(DEMO_REPORT.items.filter((i) => i.category === "personal_info").map((i) => i.name)).toEqual([
      "Address: 123 Old Street Apt 2, Houston, TX 77001",
      "Name: R. BONALTI JR",
      "Employer: ACME LLC",
    ]);
  });

  it("keeps the fingerprint on the raw field and value", () => {
    const expected = createHash("sha256")
      .update("equifax|personal_info|address|123 old street apt 2, houston, tx 77001")
      .digest("hex")
      .slice(0, 24);
    expect(personal("address").fingerprint).toBe(expected);
  });
});

describe("the same next step on every screen", () => {
  const items = DEMO_REPORT.items;
  const all = (state: string) =>
    Object.fromEntries(items.map((i) => [i.fingerprint, { state, attestedAt: "2026-11-19T12:00:00.000Z" }]));

  it("counts only decisions about items on the current report", () => {
    const flags = { ...all("correct"), "left-over-from-an-older-report": { state: "attested" } };
    const state = sessionJourneyState(items, flags, false);
    expect(state.reviewedCount).toBe(items.length);
    expect(state.attestedCount).toBe(0);
    expect(nextAction(state, "es").key).toBe("review-empty");
  });

  it("says the letters are on their way once the round is approved", () => {
    const step = nextAction(sessionJourneyState(items, all("attested"), true), "es");
    expect(step.key).toBe("waiting");
    expect(step.href).toBe("/rounds");
  });

  it("builds one plan from the confirmed items and ignores unconfirmed ones", () => {
    const flags = {
      [midland.fingerprint]: { state: "attested", attestedAt: "2026-11-19T12:00:00.000Z" },
      [capitalOne.fingerprint]: { state: "correct" },
      [inquiry.fingerprint]: { state: "attested" }, // no timestamp: not a confirmation
      "left-over-from-an-older-report": { state: "attested", attestedAt: "2026-11-19T12:00:00.000Z" },
    };
    const { attestedFlags, roundNumber, plan } = sessionPlan(items, flags);
    expect(attestedFlags.map((f) => f.fingerprint)).toEqual([midland.fingerprint]);
    expect(roundNumber).toBe(2);
    expect(plan.letters.flatMap((l) => l.itemFingerprints)).toEqual([midland.fingerprint]);

    const withPersonal = sessionPlan(items, {
      ...flags,
      [personal("address").fingerprint]: { state: "attested", attestedAt: "2026-11-19T12:00:00.000Z" },
    });
    expect(withPersonal.roundNumber).toBe(1);
    expect(sessionPlan(items, {}).plan.letters).toEqual([]);
  });
});

describe("chat thread in two languages", () => {
  it("shows the other-language version of a scripted line after the switch", () => {
    const scripted: ChatMsg = { role: "assistant", text: "Anotado. Quedan 6.", lang: "es", alt: "Noted. 6 left." };
    expect(messageText(scripted, "es")).toBe("Anotado. Quedan 6.");
    expect(messageText(scripted, "en")).toBe("Noted. 6 left.");
  });

  it("leaves typed questions, coach replies and older saved messages as written", () => {
    const typed: ChatMsg = { role: "user", text: "¿Cuánto tardan los burós?" };
    expect(messageText(typed, "en")).toBe("¿Cuánto tardan los burós?");
    expect(messageText({ role: "assistant", text: "Hola", lang: "es" }, "en")).toBe("Hola");
  });
});

describe("talk to a person", () => {
  it("has no link in the demo, where no WhatsApp number is set", () => {
    // No NEXT_PUBLIC_WHATSAPP_NUMBER in the test environment.
    expect(humanHelpHref("es")).toBeNull();
    expect(HUMAN_HELP.demoRow.es).toMatch(/En esta demo no hay personas conectadas/);
    expect(HUMAN_HELP.demoChat.en).toMatch(/No one is online in this demo/);
  });
});

describe("new customer-facing copy stays within the claim rules", () => {
  const clean = (text: string) => expect(checkMarketingCopy(text), text).toEqual([]);

  it("item descriptions", () => {
    for (const pair of ITEM_KIND_LINES) {
      clean(pair.es);
      clean(pair.en);
    }
  });

  it("help, disclosure and journey lines", () => {
    for (const group of Object.values(HUMAN_HELP)) {
      clean(group.es);
      clean(group.en);
    }
    clean(AFFILIATE_DISCLOSURE.es);
    clean(AFFILIATE_DISCLOSURE.en);
    const items = DEMO_REPORT.items;
    const some = { [midland.fingerprint]: { state: "attested" } };
    const every = Object.fromEntries(items.map((i) => [i.fingerprint, { state: "attested" }]));
    for (const locale of ["es", "en"] as const) {
      for (const state of [
        sessionJourneyState(items, {}, false),
        sessionJourneyState(items, some, false),
        sessionJourneyState(items, every, false),
        sessionJourneyState(items, every, true),
      ]) {
        const step = nextAction(state, locale);
        clean(`${step.title} ${step.description} ${step.cta}`);
      }
    }
  });

  it("dictionary lines, with one and with several", () => {
    for (const d of Object.values(DICTS)) {
      for (const n of [1, 3]) {
        clean(d.items.attestationRequired);
        clean(d.items.reportSays);
        clean(d.items.attestedOn("19/11/2026"));
        clean(d.items.flaggedPending);
        clean(d.attack.subtitle(n, n));
        clean(d.attack.emptyBody);
        clean(d.attack.emptyFlagged(n));
        clean(d.attack.itemCount(n));
        clean(d.attack.approveNote);
        clean(d.attack.approveButton(n));
        clean(d.rounds.waitDays(n));
        clean(d.rounds.lettersSent(n));
        clean(d.rounds.emptyTitle);
        clean(d.rounds.emptyBody);
        clean(d.dashboard.items(n));
        clean(d.dashboard.negatives(n));
        clean(d.responses.verified);
      }
    }
  });

  it("writes real singulars and plurals, with no (s) or (a) left", () => {
    const es = DICTS.es;
    expect(es.attack.itemCount(1)).toBe("1 elemento");
    expect(es.attack.itemCount(2)).toBe("2 elementos");
    expect(es.attack.subtitle(1, 1)).toMatch(/^1 carta generada con tu elemento confirmado\./);
    expect(es.attack.subtitle(5, 2)).toMatch(/^5 cartas generadas con tus 2 elementos confirmados\./);
    expect(es.rounds.waitDays(1)).toMatch(/~1 día más/);
    expect(es.rounds.waitDays(30)).toMatch(/~30 días más/);
    expect(DICTS.en.attack.subtitle(1, 1)).toMatch(/^1 letter generated from your confirmed item\./);
    const sample = [
      es.attack.subtitle(2, 2),
      es.attack.emptyFlagged(2),
      es.rounds.waitDays(2),
      es.items.attestationRequired,
      es.items.flaggedPending,
      es.attack.approveNote,
      nextAction(sessionJourneyState(DEMO_REPORT.items, { [midland.fingerprint]: { state: "attested" } }, false), "es")
        .description,
    ].join(" ");
    expect(sample).not.toMatch(/\((s|a|es)\)/);
    expect(sample).not.toMatch(/atestigu/i);
  });

  it("does not touch the attestation text", () => {
    expect(ATTESTATION_TEXT.es).toBe("Creo que este elemento es inexacto, no verificable o está desactualizado.");
    expect(ATTESTATION_TEXT.en).toBe("I believe this item is inaccurate, unverifiable, or outdated.");
  });
});

describe("check-before-you-decide questions", () => {
  const find = (field: string) =>
    DEMO_REPORT.items.find((i) => i.category === "personal_info" && (i.data as { field: string }).field === field)!;

  it("asks an address card about the address, not about an employer or a name", () => {
    const hints = itemCheckHints(find("address"), "es").join(" ");
    expect(hints).toMatch(/dirección/);
    expect(hints).not.toMatch(/empleo|empleador|apellido/);
  });

  it("asks a name card about the name and an employer card about the employer", () => {
    expect(itemCheckHints(find("name"), "es").join(" ")).toMatch(/nombre/);
    expect(itemCheckHints(find("employer"), "en").join(" ")).toMatch(/employer/);
  });

  it("keeps the category questions for accounts, and respects the limit", () => {
    const account = DEMO_REPORT.items.find((i) => i.category === "tradeline")!;
    expect(itemCheckHints(account, "es", 3)).toHaveLength(3);
    expect(itemCheckHints(account, "es").length).toBeGreaterThanOrEqual(3);
  });

  it("stays neutral and inside the claim rules", () => {
    for (const line of PERSONAL_INFO_HINT_LINES) {
      expect(checkMarketingCopy(line), line).toEqual([]);
      // Each one is a question for the customer to answer, not a suggestion.
      expect(line, line).toContain("?");
    }
  });
});
