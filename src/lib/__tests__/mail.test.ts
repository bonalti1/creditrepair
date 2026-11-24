import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as lobWebhook } from "@/app/api/webhooks/lob/route";
import { checkClaimGuardrails } from "../compliance/guardrails";
import { chargeEligibility } from "../billing/rules";
import { billableRoundFromRows } from "../billing/server";
import {
  DEFAULT_COLOR,
  DEFAULT_DOUBLE_SIDED,
  fitLobName,
  lobLetterRequest,
  LOB_HTML_MAX_CHARS,
  MailAddressError,
  mailLetter,
} from "../integrations/lob";
import { formatUsAddress, parseUsAddress, stateCode } from "../mail/address";
import { defaultMailClass, isCertified } from "../mail/classes";
import { clientLetterMail, clientResponseWindowStart, letterMailLine } from "../mail/clientView";
import { applyDemoSends, saveToBook, seededBook } from "../mail/data";
import { demoClientsWithMail, demoRosario, withDemoMail } from "../mail/demo";
import {
  checkFurnisherInput,
  findFurnisher,
  furnisherChanges,
  normalizeCompanyName,
  resolveFurnisherAddress,
  type FurnisherEntry,
} from "../mail/furnishers";
import { batchCost, estimatePages, formatMills, letterCost, LOB_PRICES } from "../mail/pricing";
import { buildSendBatch } from "../mail/sendBatch";
import { missingFurnisherAddresses, roundMailPlan } from "../mail/sendPlan";
import { recordLobEvent, type LetterMailUpdate, type MailEventRow, type MailStore, type TrackedLetter } from "../mail/server";
import {
  letterDeliveredAt,
  mailState,
  mapLobEventType,
  parseLobEvent,
  responseWindowStart,
  returnReasonEs,
  uspsTrackingUrl,
} from "../mail/tracking";
import type { MailEventRecord } from "../mail/types";
import { lobTimestampMs, signLobPayload, verifyLobSignature } from "../security/signatures";
import { applyDemoActions, EMPTY_ACTIONS } from "../staff/data";
import { buildDemoClients } from "../staff/demoClients";
import { exceptionMessage } from "../staff/messages";
import { clientBilling, clientExceptions, clientStage, nextAutomaticStep, sendableRound, sendBlockReason } from "../staff/stage";
import type { StaffClient } from "../staff/types";
import { setStaffLocaleFallback } from "../staff/i18n/locale";

// Written against the Spanish console: the sentences these tests pin are the Spanish ones.
setStaffLocaleFallback("es");

// Noon in Texas on 5 December 2026, so calendar dates are unambiguous.
const NOW = new Date("2026-12-05T18:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const later = new Date(NOW.getTime() + 5 * 60 * 1000);

// ── Addresses ───────────────────────────────────────────────────────────

describe("mail: reading US addresses", () => {
  const read = (lines: string[]) => {
    const parsed = parseUsAddress(lines);
    if (!parsed.ok) throw new Error(parsed.message);
    return parsed.address;
  };

  it("reads a P.O. box with ZIP+4", () => {
    expect(read(["P.O. Box 740256", "Atlanta, GA 30374-0256"])).toEqual({
      line1: "P.O. Box 740256",
      line2: null,
      city: "Atlanta",
      state: "GA",
      zip: "30374-0256",
      attention: null,
    });
  });

  it("keeps a unit on its own line, and splits one off the end of the street line", () => {
    expect(read(["123 Main St", "Apt 4B", "Houston, TX 77002"])).toMatchObject({ line1: "123 Main St", line2: "Apt 4B" });
    expect(read(["123 Main St Apt 4B", "Houston, TX 77002"])).toMatchObject({ line1: "123 Main St", line2: "Apt 4B" });
    expect(read(["123 Main St, Suite 200", "Houston, TX 77002"])).toMatchObject({ line1: "123 Main St", line2: "Suite 200" });
    expect(read(["500 Elm Ave Ste. 12", "Dallas, TX 75201"])).toMatchObject({ line1: "500 Elm Ave", line2: "Ste. 12" });
    expect(read(["77 Oak Rd #5", "Dallas, TX 75201"])).toMatchObject({ line1: "77 Oak Rd", line2: "#5" });
    expect(read(["9 Pine St Unit C", "Dallas, TX 75201"])).toMatchObject({ line1: "9 Pine St", line2: "Unit C" });
    // A unit written first is put back after the street.
    expect(read(["Apt 4", "123 Main St", "Houston, TX 77002"])).toMatchObject({ line1: "123 Main St", line2: "Apt 4" });
  });

  it("does not mistake a street name for a unit", () => {
    expect(read(["123 Parking Lot Rd", "Austin, TX 78701"])).toMatchObject({ line1: "123 Parking Lot Rd", line2: null });
    expect(read(["P.O. Box 105108", "Atlanta, GA 30348-5108"])).toMatchObject({ line1: "P.O. Box 105108", line2: null });
  });

  it("reads ZIP+4 written with a hyphen, a space or nothing", () => {
    expect(read(["1 Elm St", "Houston, TX 77021-1234"]).zip).toBe("77021-1234");
    expect(read(["1 Elm St", "Houston, TX 77021 1234"]).zip).toBe("77021-1234");
    expect(read(["1 Elm St", "Houston, TX 770211234"]).zip).toBe("77021-1234");
    expect(read(["1 Elm St", "Houston, TX 77021"]).zip).toBe("77021");
  });

  it("reads the state as a code in any case, or by name, with or without a comma", () => {
    expect(read(["1 Elm St", "Houston tx 77002"])).toMatchObject({ city: "Houston", state: "TX" });
    expect(read(["1 Elm St", "Austin, Texas 78701"])).toMatchObject({ city: "Austin", state: "TX" });
    expect(read(["1 Elm St", "New York, New York 10001"])).toMatchObject({ city: "New York", state: "NY" });
    expect(read(["1 Elm St", "Charleston, West Virginia 25301"])).toMatchObject({ city: "Charleston", state: "WV" });
    expect(read(["1 Elm St", "Virginia Beach, VA 23451"])).toMatchObject({ city: "Virginia Beach", state: "VA" });
    expect(read(["1 Elm St", "Salt Lake City, UT 84131-1293"])).toMatchObject({ city: "Salt Lake City", state: "UT" });
    expect(stateCode("dc")).toBe("DC");
    expect(stateCode("XX")).toBeNull();
  });

  it("reads an address on one line, an attention line and a trailing country", () => {
    expect(read(["123 Main St, Apt 4, Houston, TX 77002"])).toMatchObject({ line1: "123 Main St", line2: "Apt 4", city: "Houston", state: "TX" });
    expect(read(["123 Main St, Houston TX 77002"])).toMatchObject({ line1: "123 Main St", city: "Houston", state: "TX" });
    expect(read(["Attn: Credit Disputes", "P.O. Box 1", "Dallas, TX 75201"])).toMatchObject({ attention: "Attn: Credit Disputes", line1: "P.O. Box 1" });
    expect(read(["P.O. Box 1", "Dallas, TX 75201", "USA"])).toMatchObject({ line1: "P.O. Box 1", zip: "75201" });
    expect(read(["  P.O.   Box 1 ", "", " Dallas ,  TX   75201 "])).toMatchObject({ line1: "P.O. Box 1", city: "Dallas" });
  });

  it("refuses what it cannot read for certain, and says why", () => {
    const problem = (lines: string[]) => {
      const parsed = parseUsAddress(lines);
      return parsed.ok ? null : parsed.problem;
    };
    expect(problem([])).toBe("empty");
    expect(problem(["123 Main St"])).toBe("no_zip");
    expect(problem(["123 Main St", "Houston, TX 7700"])).toBe("no_zip");
    expect(problem(["Houston, TX 77002"])).toBe("no_street");
    expect(problem(["123 Main St Houston TX 77002"])).toBe("no_street");
    expect(problem(["123 Main St", "Houston, XX 77002"])).toBe("bad_state");
    expect(problem(["123 Main St", "TX 77002"])).toBe("no_city");
    expect(problem(["Bldg 5", "123 Main", "Floor 2", "Dallas, TX 75201"])).toBe("too_many_lines");
    expect(problem(["Apt 4", "Dallas, TX 75201"])).toBe("no_street");
    expect(problem([`${"9".repeat(5)} ${"Long Street Name ".repeat(4)}`, "Dallas, TX 75201"])).toBe("line_too_long");
    const parsed = parseUsAddress(["Houston, TX 77002"]);
    expect(parsed.ok ? "" : parsed.message).toMatch(/calle/);
  });

  it("writes an address back as envelope lines", () => {
    expect(formatUsAddress(read(["123 main st apt 4", "houston tx 770021234"]))).toEqual(["123 main st", "apt 4", "houston, TX 77002-1234"]);
    expect(formatUsAddress(read(["Attn: Disputes", "P.O. Box 1", "Dallas, TX 75201"]))).toEqual(["Attn: Disputes", "P.O. Box 1", "Dallas, TX 75201"]);
  });
});

// ── Classes and costs ───────────────────────────────────────────────────

describe("mail: classes by kind of letter", () => {
  it("sends first disputes first class, and follow-ups, furnishers, collectors and identity theft certified", () => {
    expect(defaultMailClass("dispute_611_accounts")).toBe("first_class");
    expect(defaultMailClass("dispute_611_inquiries")).toBe("first_class");
    expect(defaultMailClass("personal_info_cleanup")).toBe("first_class");
    expect(defaultMailClass("secondary_bureau_request", "secondary_bureau")).toBe("first_class");
    expect(defaultMailClass("mov_request")).toBe("certified");
    expect(defaultMailClass("bureau_no_response")).toBe("certified");
    expect(defaultMailClass("furnisher_direct", "furnisher")).toBe("certified");
    expect(defaultMailClass("debt_validation", "furnisher")).toBe("certified");
    expect(defaultMailClass("collector_validation_30_day")).toBe("certified");
    expect(defaultMailClass("identity_theft_block")).toBe("certified");
    // Whatever the template, a letter to a furnisher goes certified.
    expect(defaultMailClass("dispute_611_accounts", "furnisher")).toBe("certified");
    expect(defaultMailClass("no_such_template")).toBe("first_class");
    expect(isCertified("certified_return_receipt")).toBe(true);
    expect(isCertified("first_class")).toBe(false);
  });
});

describe("mail: cost preview", () => {
  it("prices a letter from the table: first page, extra pages, certified and the return receipt", () => {
    expect(letterCost({ mailClass: "first_class", pages: 1 }).mills).toBe(LOB_PRICES.letterBlackWhite);
    expect(letterCost({ mailClass: "certified", pages: 3 }).mills).toBe(1060 + 2 * 100 + 6950);
    expect(letterCost({ mailClass: "certified_return_receipt", pages: 3 }).mills).toBe(1060 + 200 + 6950 + 2910);
    expect(letterCost({ mailClass: "first_class", pages: 2, color: true }).mills).toBe(1140 + 200);
    expect(letterCost({ mailClass: "first_class", pages: 0 }).pages).toBe(1);
    const parts = letterCost({ mailClass: "certified_return_receipt", pages: 2 }).parts.map((p) => p.label);
    expect(parts).toEqual(["Carta en blanco y negro, primera clase", "1 página adicional", "Correo certificado", "Acuse de recibo electrónico"]);
  });

  it("adds up a batch and writes dollars rounded to the cent", () => {
    const costs = [letterCost({ mailClass: "first_class", pages: 4 }), letterCost({ mailClass: "certified", pages: 4 })];
    expect(batchCost(costs)).toBe(1360 + 8310);
    expect(formatMills(9670)).toBe("$9.67");
    expect(formatMills(1065)).toBe("$1.07");
    expect(formatMills(1060)).toBe("$1.06");
    expect(formatMills(1_234_560)).toBe("$1,234.56");
  });

  it("counts pages: the letter, one per enclosure, and the address page", () => {
    expect(estimatePages("short letter", 2)).toBe(4);
    expect(estimatePages("short letter", 0, { addressPage: false })).toBe(1);
    expect(estimatePages(Array.from({ length: 100 }, () => "line").join("\n"), 0)).toBe(4);
    // A long line wraps.
    expect(estimatePages("x".repeat(85 * 47), 0, { addressPage: false })).toBe(2);
  });

  it("marks the price table as unverified, with where and when it was read", () => {
    const source = readFileSync("src/lib/mail/pricing.ts", "utf8");
    expect(source).toMatch(/UNVERIFIED/);
    expect(LOB_PRICES.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(LOB_PRICES.source).toMatch(/lob\.com/);
  });
});

// ── Furnisher address book ──────────────────────────────────────────────

describe("mail: furnisher names and aliases", () => {
  const book = seededBook();

  it("normalizes case, accents, punctuation, abbreviations and legal suffixes", () => {
    expect(normalizeCompanyName("Midland Credit Mgmt., Inc.")).toBe("MIDLANDCREDITMANAGEMENT");
    expect(normalizeCompanyName("MIDLAND CR MGMT")).toBe("MIDLANDCREDITMANAGEMENT");
    expect(normalizeCompanyName("The Midland Credit Management Company")).toBe("MIDLANDCREDITMANAGEMENT");
    expect(normalizeCompanyName("CAPITAL ONE BANK USA N.A.")).toBe(normalizeCompanyName("Capital One Bank (USA), NA"));
    expect(normalizeCompanyName("Crédito Fácil S&L")).toBe("CREDITOFACILSANDL");
    expect(normalizeCompanyName("  ")).toBe("");
  });

  it("finds a company by its name or any alias, and nothing else", () => {
    const found = (name: string) => {
      const match = findFurnisher(book, name);
      return match.status === "found" ? match.entry.name : match.status;
    };
    expect(found("MIDLAND CREDIT MGMT")).toBe("Midland Credit Management");
    expect(found("mcm")).toBe("Midland Credit Management");
    expect(found("Midland Credit Management, Inc.")).toBe("Midland Credit Management");
    expect(found("CAP ONE")).toBe("Capital One");
    expect(found("Capital One N.A.")).toBe("Capital One");
    // Close is not the same: a different company is never matched.
    expect(found("MIDLAND FUNDING LLC")).toBe("none");
    expect(found("Capital One Auto Finance")).toBe("none");
    expect(found("")).toBe("none");
  });

  it("refuses to choose when two entries answer to the same name", () => {
    const twice: FurnisherEntry[] = [...book, { ...book[1]!, id: "dup", name: "Midland Copy", aliases: ["MCM"] }];
    expect(findFurnisher(twice, "MCM").status).toBe("ambiguous");
    const resolved = resolveFurnisherAddress(twice, "MCM");
    expect(resolved.ok ? null : resolved.reason).toBe("ambiguous");
  });

  it("uses only a complete address that a person dated against a source", () => {
    const capital = resolveFurnisherAddress(book, "CAPITAL ONE BANK USA NA");
    expect(capital.ok && capital.addressLines).toEqual(["P.O. Box 31293", "Salt Lake City, UT 84131-1293"]);
    const reason = (b: FurnisherEntry[], name: string) => {
      const r = resolveFurnisherAddress(b, name);
      return r.ok ? "ok" : r.reason;
    };
    expect(reason(book, "MIDLAND CREDIT MGMT")).toBe("no_address");
    expect(reason(book, "ACME COLLECTIONS")).toBe("unknown");
    const midland = book.find((f) => f.id === "f-midland")!;
    const unchecked = [{ ...midland, addressLines: ["P.O. Box 1", "San Diego, CA 92108"] }];
    expect(reason(unchecked, "MCM")).toBe("not_verified");
    expect(reason([{ ...unchecked[0]!, verifiedOn: "2026-11-01" }], "MCM")).toBe("not_verified"); // no source
    expect(reason([{ ...unchecked[0]!, verifiedOn: "2026-11-01", source: "letter" , addressLines: ["somewhere"] }], "MCM")).toBe("bad_address");
    const message = resolveFurnisherAddress(book, "MCM");
    expect(message.ok ? "" : message.message).toMatch(/Midland Credit Management/);
  });

  it("seeds names only, except an address read from the company's own site, with its source and date", () => {
    for (const entry of book) {
      if (entry.addressLines.length > 0) {
        expect(entry.source).toMatch(/^https:\/\/www\.capitalone\.com\//);
        expect(entry.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      } else {
        expect(entry.verifiedOn).toBeNull();
      }
      expect(entry.history).toHaveLength(1);
    }
    // The address a credit report prints for Midland is never in the book.
    expect(JSON.stringify(book)).not.toMatch(/Camino De La Reina|30285/);
  });
});

describe("mail: saving to the address book", () => {
  const book = seededBook();
  const input = {
    name: "Ejemplo Cobranzas LLC",
    aliases: ["EJEMPLO COBRANZAS", "EJ COB", "Ejemplo Cobranzas", "ejemplo cobranzas llc"],
    addressLines: ["P.O. Box 4242", "dallas tx 75201"],
    phone: "",
    notes: "",
    source: "https://example.com/disputes",
    verifiedOn: "2026-12-01",
  };

  it("accepts a complete entry, formats its address and keeps every spelling once, dropping exact repeats of the name", () => {
    const check = checkFurnisherInput(input, book, NOW);
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.value.addressLines).toEqual(["P.O. Box 4242", "dallas, TX 75201"]);
    expect(check.value.aliases).toEqual(["EJEMPLO COBRANZAS", "EJ COB"]);
    expect(check.value.phone).toBeNull();
  });

  it("refuses a name another company already answers to, an unreadable address, and an unsourced or future verification", () => {
    const problems = (patch: Partial<typeof input>) => {
      const check = checkFurnisherInput({ ...input, ...patch }, book, NOW);
      return check.ok ? [] : check.problems;
    };
    expect(problems({ name: "Midland Credit Mgmt" }).join(" ")).toMatch(/ya corresponde a Midland Credit Management/);
    expect(problems({ aliases: ["CAP ONE"] }).join(" ")).toMatch(/ya corresponde a Capital One/);
    expect(problems({ addressLines: ["somewhere in Dallas"] }).join(" ")).toMatch(/no se puede leer/);
    expect(problems({ source: "" }).join(" ")).toMatch(/fuente/);
    expect(problems({ addressLines: [] }).join(" ")).toMatch(/necesita la dirección/);
    expect(problems({ verifiedOn: "2026-12-25" }).join(" ")).toMatch(/futura/);
    expect(problems({ name: "" }).join(" ")).toMatch(/nombre/);
    // Without a date it may be saved with no source: it is simply not used yet.
    expect(problems({ source: "", verifiedOn: "" })).toEqual([]);
  });

  it("keeps history: every save adds who, when and what changed; a save that changes nothing adds nothing", () => {
    const first = saveToBook(book, input, "ana", NOW);
    expect(first.result.ok).toBe(true);
    if (!first.result.ok) return;
    const entry = first.result.entry;
    expect(entry.history).toHaveLength(1);
    expect(entry.history[0]!.by).toBe("ana");
    expect(entry.history[0]!.changes.map((c) => c.field)).toEqual(["name", "aliases", "addressLines", "source", "verifiedOn"]);

    const edit = saveToBook(first.book, { ...input, id: entry.id, addressLines: ["P.O. Box 9999", "Dallas, TX 75201"] }, "carmen", later);
    if (!edit.result.ok) throw new Error("edit refused");
    const history = edit.result.entry.history;
    expect(history).toHaveLength(2);
    expect(history[1]).toMatchObject({ by: "carmen", at: later.toISOString() });
    expect(history[1]!.changes).toEqual([{ field: "addressLines", from: "P.O. Box 4242 · dallas, TX 75201", to: "P.O. Box 9999 · Dallas, TX 75201" }]);
    // The first line is untouched.
    expect(history[0]).toEqual(entry.history[0]);

    const again = saveToBook(edit.book, { ...input, id: entry.id, addressLines: ["P.O. Box 9999", "Dallas, TX 75201"] }, "carmen", later);
    expect(again.result.ok && again.result.entry.history).toHaveLength(2);
    expect(saveToBook(book, { ...input, id: "nope" }, "x", NOW).result.ok).toBe(false);
    expect(furnisherChanges(entry, entry)).toEqual([]);
  });
});

// ── Lob ─────────────────────────────────────────────────────────────────

describe("mail: the Lob request", () => {
  const to = { name: "Equifax Information Services LLC", addressLines: ["P.O. Box 740256", "Atlanta, GA 30374-0256"] };
  const from = { name: "Rosario Villalobos", addressLines: ["4802 Calle Ejemplo", "Apt 12", "Houston, TX 77021"] };

  it("asks for certified mail with extra_service, and sends first class without it", () => {
    const first = lobLetterRequest({ to, from, bodyHtml: "<p>x</p>", idempotencyKey: "l1" });
    expect(first.extra_service).toBeUndefined();
    expect(lobLetterRequest({ to, from, bodyHtml: "x", idempotencyKey: "l1", mailClass: "certified" }).extra_service).toBe("certified");
    expect(lobLetterRequest({ to, from, bodyHtml: "x", idempotencyKey: "l1", mailClass: "certified_return_receipt" }).extra_service).toBe("certified_return_receipt");
    expect(first).toMatchObject({
      mail_type: "usps_first_class",
      use_type: "operational",
      address_placement: "insert_blank_page",
      color: DEFAULT_COLOR,
      double_sided: DEFAULT_DOUBLE_SIDED,
      file: "<p>x</p>",
    });
    expect(lobLetterRequest({ to, from, bodyHtml: "x", idempotencyKey: "l1", color: true, doubleSided: true })).toMatchObject({ color: true, double_sided: true });
  });

  it("splits both addresses into Lob's fields, with the unit on line 2 and ZIP+4", () => {
    const body = lobLetterRequest({ to, from, bodyHtml: "x", idempotencyKey: "l1" });
    expect(body.to).toEqual({
      name: "Equifax Information Services LLC",
      address_line1: "P.O. Box 740256",
      address_city: "Atlanta",
      address_state: "GA",
      address_zip: "30374-0256",
      address_country: "US",
    });
    expect(body.from).toMatchObject({ name: "Rosario Villalobos", address_line1: "4802 Calle Ejemplo", address_line2: "Apt 12", address_zip: "77021" });
  });

  it("refuses an address it cannot read, before anything is sent", () => {
    expect(() => lobLetterRequest({ to, from: { name: "X", addressLines: ["Tu dirección", "Houston, TX 77002"] }, bodyHtml: "x", idempotencyKey: "l" })).not.toThrow();
    expect(() => lobLetterRequest({ to: { name: "X", addressLines: ["Somewhere"] }, from, bodyHtml: "x", idempotencyKey: "l" })).toThrow(MailAddressError);
    expect(() => lobLetterRequest({ to, from, bodyHtml: "x".repeat(LOB_HTML_MAX_CHARS + 1), idempotencyKey: "l" })).toThrow(/at most/);
  });

  it("fits a long name: drops a note in parentheses first, then words from the end", () => {
    expect(fitLobName("LexisNexis Risk Solutions Consumer Center (including SageStream)")).toBe("LexisNexis Risk Solutions Consumer");
    expect(fitLobName("Equifax Information Services LLC")).toBe("Equifax Information Services LLC");
    expect(fitLobName("Clarity Services, Inc. (Experian)")).toBe("Clarity Services, Inc. (Experian)");
    expect(fitLobName("A".repeat(50))).toHaveLength(40);
  });

  describe("sending", () => {
    const original = process.env.LOB_API_KEY;
    afterEach(() => {
      if (original === undefined) delete process.env.LOB_API_KEY;
      else process.env.LOB_API_KEY = original;
      vi.unstubAllGlobals();
    });

    it("without a key: a simulated result, and the addresses are still checked", async () => {
      delete process.env.LOB_API_KEY;
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const result = await mailLetter({ to, from, bodyHtml: "x", idempotencyKey: "abc", mailClass: "certified" });
      expect(result).toEqual({ provider: "stub", externalId: "stub_abc", status: "queued", mailClass: "certified", trackingNumber: null, expectedDeliveryDate: null });
      expect(fetchSpy).not.toHaveBeenCalled();
      await expect(mailLetter({ to: { name: "X", addressLines: [] }, from, bodyHtml: "x", idempotencyKey: "abc" })).rejects.toThrow(MailAddressError);
    });

    it("with a key: JSON, basic auth and the letter's id as the idempotency key", async () => {
      process.env.LOB_API_KEY = "test_key";
      const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ id: "ltr_1", tracking_number: null, expected_delivery_date: "2026-12-09" }), { status: 200 }));
      vi.stubGlobal("fetch", fetchSpy);
      const result = await mailLetter({ to, from, bodyHtml: "x", idempotencyKey: "letter-uuid", mailClass: "certified" });
      expect(result).toMatchObject({ provider: "lob", externalId: "ltr_1", status: "submitted", expectedDeliveryDate: "2026-12-09" });
      const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://api.lob.com/v1/letters");
      const headers = init.headers as Record<string, string>;
      expect(headers["Idempotency-Key"]).toBe("letter-uuid");
      expect(headers["Content-Type"]).toBe("application/json");
      expect(headers.Authorization).toBe(`Basic ${Buffer.from("test_key:").toString("base64")}`);
      expect(JSON.parse(init.body as string)).toMatchObject({ extra_service: "certified", to: { address_city: "Atlanta" } });
    });

    it("with a key: a refusal from Lob is an error, so the caller keeps the letter as a draft", async () => {
      process.env.LOB_API_KEY = "test_key";
      vi.stubGlobal("fetch", vi.fn(async () => new Response("bad address", { status: 422 })));
      await expect(mailLetter({ to, from, bodyHtml: "x", idempotencyKey: "k" })).rejects.toThrow(/Lob error 422/);
    });
  });

  it("marks every detail it could not confirm", () => {
    const source = readFileSync("src/lib/integrations/lob.ts", "utf8");
    expect(source).toMatch(/UNVERIFIED {2}`file` as an inline HTML string/);
    expect(source).toMatch(/UNVERIFIED: the longest `name`/);
  });
});

// ── Tracking ────────────────────────────────────────────────────────────

describe("mail: tracking events", () => {
  it("maps Lob's events to the letter's status", () => {
    const status = (type: string, detail?: string) => mapLobEventType(type, detail)?.status;
    expect(status("letter.created")).toBeNull();
    expect(status("letter.rendered_pdf")).toBeNull();
    expect(status("letter.mailed")).toBe("in_transit");
    expect(status("letter.certified.mailed")).toBe("in_transit");
    expect(status("letter.in_transit")).toBe("in_transit");
    expect(status("letter.in_local_area")).toBe("in_transit");
    expect(status("letter.processed_for_delivery")).toBe("in_transit");
    expect(status("letter.certified.pickup_available")).toBe("in_transit");
    expect(status("letter.re-routed")).toBe("in_transit");
    expect(status("letter.delivered")).toBe("delivered");
    expect(status("letter.certified.delivered")).toBe("delivered");
    expect(status("letter.returned_to_sender")).toBe("returned");
    expect(status("letter.certified.returned_to_sender")).toBe("returned");
    expect(status("letter.certified.issue", "package_undeliverable")).toBe("undeliverable");
    expect(status("letter.certified.issue", "package_lost")).toBe("undeliverable");
    expect(status("letter.certified.issue", "returned_to_sender")).toBe("returned");
    expect(status("letter.certified.issue", "delayed")).toBeNull();
    expect(status("letter.something_new")).toBeNull();
    expect(mapLobEventType("letter.something_new")?.kind).toBe("other");
    expect(mapLobEventType("postcard.delivered")).toBeNull();
  });

  const payload = (eventType: string, extra: Record<string, unknown> = {}) => ({
    id: "evt_123",
    object: "event",
    date_created: "2026-11-10T15:00:00.000Z",
    reference_id: "ltr_abc",
    event_type: { id: eventType, resource: "letters", object: "event_type", enabled_for_test: true },
    body: {
      id: "ltr_abc",
      tracking_number: "9407100000000000000000",
      tracking_events: [
        { id: "evnt_1", type: "certified", name: "In Transit", time: "2026-11-06T10:00:00.000Z", location: "75201" },
        { id: "evnt_2", type: "certified", name: "Delivered", time: "2026-11-08T13:00:00.000Z", location: "30374", details: { event: "delivered", description: "Package has been delivered.", action_required: false } },
        { id: "evnt_3", type: "certified", name: "Issue", time: "2026-11-07T09:00:00.000Z", location: "30374", details: { event: "notice_left", action_required: true } },
      ],
      ...extra,
    },
  });

  it("reads a webhook event: the scan time and place from the matching tracking event, and the tracking number", () => {
    expect(parseLobEvent(payload("letter.certified.delivered"))).toEqual({
      eventId: "evt_123",
      eventType: "letter.certified.delivered",
      letterId: "ltr_abc",
      at: "2026-11-08T13:00:00.000Z",
      trackingNumber: "9407100000000000000000",
      location: "30374",
      detail: "delivered",
    });
    expect(parseLobEvent(payload("letter.certified.issue"))).toMatchObject({ detail: "notice_left", at: "2026-11-07T09:00:00.000Z" });
    // No matching tracking event: the event's own date.
    expect(parseLobEvent(payload("letter.mailed", { tracking_events: [] }))).toMatchObject({ at: "2026-11-10T15:00:00.000Z", location: null });
    expect(parseLobEvent({ ...payload("letter.mailed"), id: undefined })).toBeNull();
    expect(parseLobEvent(payload("postcard.mailed"))).toBeNull();
    expect(parseLobEvent("nonsense")).toBeNull();
    expect(parseLobEvent({ ...payload("letter.mailed", { tracking_events: [] }), date_created: "not a date" })).toBeNull();
  });

  const ev = (id: string, day: number, kind: MailEventRecord["kind"], status: MailEventRecord["status"], detail: string | null = null): MailEventRecord => ({
    id,
    at: new Date(Date.UTC(2026, 10, day, 15)).toISOString(),
    kind,
    status,
    detail,
  });

  it("adds events up to one status, whatever order they arrived in, each event once", () => {
    const events = [ev("e3", 8, "delivered", "delivered"), ev("e1", 3, "mailed", "in_transit"), ev("e2", 5, "in_transit", "in_transit"), ev("e3", 8, "delivered", "delivered")];
    const state = mailState(events, true);
    expect(state.status).toBe("delivered");
    expect(state.deliveredAt).toBe(new Date(Date.UTC(2026, 10, 8, 15)).toISOString());
    expect(state.events.map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
    // A late route scan after the delivery does not undo it.
    expect(mailState([...events, ev("e4", 9, "in_transit", "in_transit")], true).status).toBe("delivered");
    expect(mailState([], true).status).toBe("in_transit");
    expect(mailState([], false).status).toBe("not_sent");
  });

  it("a letter that came back stays back: the 'Delivered' scan of the trip back to the sender is not a delivery", () => {
    const state = mailState([ev("e1", 3, "mailed", "in_transit"), ev("e2", 6, "returned_to_sender", "returned", "Returned to Sender"), ev("e3", 9, "delivered", "delivered")], true);
    expect(state).toMatchObject({ status: "returned", deliveredAt: null, returnReason: "Returned to Sender" });
    expect(state.returnedAt).toBe(new Date(Date.UTC(2026, 10, 6, 15)).toISOString());
    expect(mailState([ev("e1", 3, "issue", "undeliverable", "package_undeliverable")], true).status).toBe("undeliverable");
    expect(returnReasonEs("Returned to Sender")).toBe("devuelta al remitente");
    expect(returnReasonEs("package_undeliverable")).toBe("no se pudo entregar");
    expect(returnReasonEs("something odd")).toBe("something odd");
  });

  it("links a tracking number to USPS", () => {
    expect(uspsTrackingUrl("9407 1000 0000")).toBe("https://tools.usps.com/go/TrackConfirmAction?tLabels=940710000000");
  });
});

// ── Signatures ──────────────────────────────────────────────────────────

describe("mail: Lob webhook signatures", () => {
  const secret = "whsec_test_secret";
  const body = JSON.stringify({ id: "evt_1", event_type: { id: "letter.mailed" } });
  const now = new Date("2026-11-21T12:00:00.000Z");
  const seconds = String(Math.floor(now.getTime() / 1000));

  it("accepts a fresh delivery signed over the timestamp and the exact body", () => {
    expect(verifyLobSignature({ rawBody: body, signature: signLobPayload(body, seconds, secret), timestamp: seconds, secret, now })).toEqual({ ok: true });
    const ms = String(now.getTime());
    expect(verifyLobSignature({ rawBody: body, signature: signLobPayload(body, ms, secret), timestamp: ms, secret, now }).ok).toBe(true);
    const iso = now.toISOString();
    expect(verifyLobSignature({ rawBody: body, signature: signLobPayload(body, iso, secret), timestamp: iso, secret, now }).ok).toBe(true);
    expect(verifyLobSignature({ rawBody: body, signature: signLobPayload(body, seconds, secret).toUpperCase(), timestamp: seconds, secret, now }).ok).toBe(true);
  });

  it("refuses a changed body, a changed timestamp, or another secret", () => {
    const signature = signLobPayload(body, seconds, secret);
    expect(verifyLobSignature({ rawBody: body.replace("mailed", "delivered"), signature, timestamp: seconds, secret, now })).toEqual({ ok: false, reason: "mismatch" });
    expect(verifyLobSignature({ rawBody: `${body} `, signature, timestamp: seconds, secret, now })).toEqual({ ok: false, reason: "mismatch" });
    expect(verifyLobSignature({ rawBody: body, signature, timestamp: String(Number(seconds) - 1), secret, now })).toEqual({ ok: false, reason: "mismatch" });
    expect(verifyLobSignature({ rawBody: body, signature, timestamp: seconds, secret: "other", now })).toEqual({ ok: false, reason: "mismatch" });
  });

  it("refuses a replay: a delivery older or newer than five minutes", () => {
    const old = String(Math.floor(now.getTime() / 1000) - 6 * 60);
    expect(verifyLobSignature({ rawBody: body, signature: signLobPayload(body, old, secret), timestamp: old, secret, now })).toEqual({ ok: false, reason: "stale" });
    const ahead = String(Math.floor(now.getTime() / 1000) + 6 * 60);
    expect(verifyLobSignature({ rawBody: body, signature: signLobPayload(body, ahead, secret), timestamp: ahead, secret, now })).toEqual({ ok: false, reason: "stale" });
    const edge = String(Math.floor(now.getTime() / 1000) - 4 * 60);
    expect(verifyLobSignature({ rawBody: body, signature: signLobPayload(body, edge, secret), timestamp: edge, secret, now }).ok).toBe(true);
  });

  it("refuses missing or malformed headers", () => {
    const signature = signLobPayload(body, seconds, secret);
    expect(verifyLobSignature({ rawBody: body, signature: null, timestamp: seconds, secret, now })).toEqual({ ok: false, reason: "missing" });
    expect(verifyLobSignature({ rawBody: body, signature, timestamp: null, secret, now })).toEqual({ ok: false, reason: "missing" });
    expect(verifyLobSignature({ rawBody: body, signature, timestamp: seconds, secret: "", now })).toEqual({ ok: false, reason: "missing" });
    expect(verifyLobSignature({ rawBody: body, signature: "sha256=abc", timestamp: seconds, secret, now })).toEqual({ ok: false, reason: "malformed" });
    expect(verifyLobSignature({ rawBody: body, signature, timestamp: "yesterday", secret, now })).toEqual({ ok: false, reason: "malformed" });
    expect(lobTimestampMs("1763726400")).toBe(1763726400000);
    expect(lobTimestampMs("1763726400000")).toBe(1763726400000);
  });

  it("compares in constant time and marks the unconfirmed timestamp unit", () => {
    const source = readFileSync("src/lib/security/signatures.ts", "utf8");
    const fn = source.slice(source.indexOf("export function verifyLobSignature"));
    expect(fn).toMatch(/safeEqual\(presented, expected\)/);
    expect(source).toMatch(/UNVERIFIED: the timestamp's unit/);
  });
});

// ── The webhook route ───────────────────────────────────────────────────

describe("mail: POST /api/webhooks/lob", () => {
  const secret = "whsec_route_test";
  const saved = { secret: process.env.LOB_WEBHOOK_SECRET, url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.LOB_API_KEY };
  beforeEach(() => {
    process.env.LOB_WEBHOOK_SECRET = secret;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.LOB_API_KEY;
  });
  afterEach(() => {
    for (const [name, value] of [["LOB_WEBHOOK_SECRET", saved.secret], ["NEXT_PUBLIC_SUPABASE_URL", saved.url], ["LOB_API_KEY", saved.key]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const deliver = (body: string, options: { sign?: boolean; timestamp?: string; headers?: Record<string, string> } = {}) => {
    const timestamp = options.timestamp ?? String(Math.floor(Date.now() / 1000));
    return lobWebhook(
      new Request("http://localhost/api/webhooks/lob", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "lob-signature-timestamp": timestamp,
          "lob-signature": options.sign === false ? "0".repeat(64) : signLobPayload(body, timestamp, secret),
          ...options.headers,
        },
        body,
      }),
    );
  };
  const event = (id: string, type = "letter.certified.delivered") =>
    JSON.stringify({ id, date_created: new Date().toISOString(), reference_id: "ltr_route", event_type: { id: type }, body: { id: "ltr_route" } });

  it("records a signed letter event once: the same event again is a duplicate", async () => {
    const first = await deliver(event("evt_route_1"));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ok: true, duplicate: false });
    const again = await deliver(event("evt_route_1"));
    expect(await again.json()).toMatchObject({ ok: true, duplicate: true });
  });

  it("refuses a bad signature, a stale one, and every request when no secret is configured", async () => {
    expect((await deliver(event("evt_route_2"), { sign: false })).status).toBe(401);
    expect((await deliver(event("evt_route_3"), { timestamp: String(Math.floor(Date.now() / 1000) - 3600) })).status).toBe(401);
    delete process.env.LOB_WEBHOOK_SECRET;
    expect((await deliver(event("evt_route_4"))).status).toBe(503);
  });

  it("refuses a body over the limit before reading it, and acknowledges events that are not about a letter", async () => {
    expect((await deliver(event("evt_route_5"), { headers: { "content-length": String(10 * 1024 * 1024) } })).status).toBe(413);
    const big = JSON.stringify({ pad: "x".repeat(300 * 1024) });
    expect((await deliver(big)).status).toBe(413);
    const other = await deliver(event("evt_route_6", "postcard.delivered"));
    expect(other.status).toBe(200);
    expect(await other.json()).toMatchObject({ ignored: "not a letter event" });
    expect((await deliver("{not json")).status).toBe(400);
  });
});

// ── Recording events ────────────────────────────────────────────────────

describe("mail: recording an event", () => {
  function memoryStore(letter: TrackedLetter | null) {
    const rows: MailEventRow[] = [];
    const updates: LetterMailUpdate[] = [];
    const returned: LetterMailUpdate[] = [];
    let current = letter;
    const store: MailStore = {
      async findLetter(lobId) {
        return current && lobId === "ltr_1" ? current : null;
      },
      async insertEvent(row) {
        if (rows.some((r) => r.provider === row.provider && r.providerEventId === row.providerEventId)) return "duplicate";
        rows.push(row);
        return "inserted";
      },
      async listEvents() {
        return rows.map((r) => ({ id: r.providerEventId, at: r.occurredAt, kind: r.kind, status: r.mailStatus, detail: r.detail }));
      },
      async updateLetter(_id, update) {
        updates.push(update);
        if (current) current = { ...current, mailStatus: update.mailStatus };
      },
      async recordReturned(_letter, update) {
        returned.push(update);
      },
    };
    return { store, rows, updates, returned };
  }
  const letter: TrackedLetter = { id: "l1", userId: "u1", mailClass: "certified", mailStatus: "in_transit", mailedAt: "2026-11-03T15:00:00.000Z" };
  const lobEvent = (eventId: string, eventType: string, at: string, detail: string | null = null) => ({
    eventId,
    eventType,
    letterId: "ltr_1",
    at,
    trackingNumber: "9407100000000000000000",
    location: null,
    detail,
  });

  it("stores each event once and recomputes the letter's status from all of them", async () => {
    const { store, rows, updates } = memoryStore(letter);
    expect(await recordLobEvent(store, lobEvent("evt_1", "letter.certified.in_transit", "2026-11-04T10:00:00.000Z"))).toEqual({ outcome: "recorded", status: "in_transit", returnedNow: false });
    expect(await recordLobEvent(store, lobEvent("evt_2", "letter.certified.delivered", "2026-11-07T10:00:00.000Z"))).toMatchObject({ outcome: "recorded", status: "delivered" });
    // Lob retries the first one: nothing new is stored, the status stays.
    expect(await recordLobEvent(store, lobEvent("evt_1", "letter.certified.in_transit", "2026-11-04T10:00:00.000Z"))).toMatchObject({ outcome: "duplicate", status: "delivered" });
    expect(rows).toHaveLength(2);
    expect(updates[updates.length - 1]).toMatchObject({ mailStatus: "delivered", deliveredAt: "2026-11-07T10:00:00.000Z", trackingNumber: "9407100000000000000000" });
  });

  it("announces a returned letter once", async () => {
    const { store, returned } = memoryStore(letter);
    expect(await recordLobEvent(store, lobEvent("evt_1", "letter.returned_to_sender", "2026-11-09T10:00:00.000Z", "Returned to Sender"))).toMatchObject({ status: "returned", returnedNow: true });
    expect(await recordLobEvent(store, lobEvent("evt_1", "letter.returned_to_sender", "2026-11-09T10:00:00.000Z", "Returned to Sender"))).toMatchObject({ outcome: "duplicate", returnedNow: false });
    expect(await recordLobEvent(store, lobEvent("evt_2", "letter.delivered", "2026-11-12T10:00:00.000Z"))).toMatchObject({ status: "returned", returnedNow: false });
    expect(returned).toHaveLength(1);
    expect(returned[0]).toMatchObject({ mailStatus: "returned", returnReason: "Returned to Sender" });
  });

  it("ignores letters that are not ours and events that are not about letters", async () => {
    expect(await recordLobEvent(memoryStore(null).store, lobEvent("evt_1", "letter.mailed", "2026-11-04T10:00:00.000Z"))).toEqual({ outcome: "unknown_letter" });
    expect(await recordLobEvent(memoryStore(letter).store, lobEvent("evt_1", "postcard.mailed", "2026-11-04T10:00:00.000Z"))).toEqual({ outcome: "not_a_letter_event" });
  });
});

// ── The console ─────────────────────────────────────────────────────────

describe("mail: sending a round from the console", () => {
  const demo = demoClientsWithMail(buildDemoClients(NOW), NOW);
  const rosario = demo.find((c) => c.id === "c50")!;
  const book = seededBook();
  const withMidland = (() => {
    const saved = saveToBook(
      book,
      { id: "f-midland", name: "Midland Credit Management", aliases: ["MIDLAND CREDIT MGMT", "MIDLAND CREDIT MANAGEMENT INC", "MCM"], addressLines: ["P.O. Box 4242", "Dallas, TX 75201"], phone: "", notes: "", source: "Carta de la empresa del 1 dic 2026", verifiedOn: "2026-12-01" },
      "carmen",
      NOW,
    );
    return saved.book;
  })();

  it("Rosario's round 4 writes to Capital One and Midland directly, certified", () => {
    expect(clientStage(rosario, later)).toBe("next_round_ready");
    const round4 = rosario.rounds.find((r) => r.number === 4)!;
    expect(round4.status).toBe("ready");
    const furnisherLetters = round4.letters.filter((l) => l.recipient.type === "furnisher");
    expect(furnisherLetters.map((l) => [l.recipient.name, l.templateKey]).sort()).toEqual([
      ["Capital One", "furnisher_direct"],
      ["Midland Credit Management", "debt_validation"],
    ]);
    expect(furnisherLetters.every((l) => defaultMailClass(l.templateKey, l.recipient.type) === "certified")).toBe(true);
  });

  it("holds a round while a creditor has no checked address, and says which company", () => {
    expect(sendableRound(rosario, later)?.number).toBe(4); // without the book, nothing is checked
    expect(sendableRound(rosario, later, { furnishers: book })).toBeNull();
    expect(sendBlockReason(rosario, later, { furnishers: book })).toMatch(/Midland Credit Management/);
    expect(missingFurnisherAddresses(rosario.rounds[3]!, book).map((g) => g.company)).toEqual(["Midland Credit Management"]);
    const exception = clientExceptions(rosario, later, { furnishers: book }).find((e) => e.kind === "furnisher_address_missing")!;
    expect(exception.sentence).toMatch(/Midland Credit Management/);
    expect(exception.href).toBe("/equipo/acreedores?editar=f-midland");
    expect(checkClaimGuardrails(exceptionMessage(rosario, exception))).toEqual([]);
    // A company that is not in the book at all: the form opens with its name filled in.
    const unknown = { ...rosario, rounds: rosario.rounds.map((r) => (r.number === 4 ? { ...r, letters: r.letters.map((l) => (l.recipient.name === "Midland Credit Management" ? { ...l, recipient: { ...l.recipient, name: "Ejemplo Recovery" } } : l)) } : r)) };
    expect(clientExceptions(unknown, later, { furnishers: book }).find((e) => e.kind === "furnisher_address_missing")?.href).toBe("/equipo/acreedores?nuevo=Ejemplo%20Recovery");
  });

  it("goes once the address is in the book, to the book's address and never the report's", () => {
    expect(sendableRound(rosario, later, { furnishers: withMidland })?.number).toBe(4);
    expect(clientExceptions(rosario, later, { furnishers: withMidland }).map((e) => e.kind)).not.toContain("furnisher_address_missing");
    const plan = roundMailPlan(rosario, rosario.rounds[3]!, withMidland, later);
    expect(plan.blockers).toEqual([]);
    expect(plan.from?.addressLines).toEqual(["4802 Calle Ejemplo", "Apt 12", "Houston, TX 77021"]);
    const to = Object.fromEntries(plan.letters.map((l) => [l.letter.recipient.name, l.to?.addressLines.join(" | ")]));
    expect(to["Capital One"]).toBe("P.O. Box 31293 | Salt Lake City, UT 84131-1293");
    expect(to["Midland Credit Management"]).toBe("P.O. Box 4242 | Dallas, TX 75201");
    expect(JSON.stringify(plan.letters.map((l) => l.to))).not.toMatch(/Camino De La Reina|30285/);
    expect(plan.letters.find((l) => l.letter.recipient.type === "bureau")?.addressFrom).toBe("registry");
    expect(plan.totalMills).toBe(plan.letters.reduce((n, l) => n + l.cost.mills, 0));
  });

  it("lets staff change a letter's class for this send, and prices it", () => {
    const round4 = rosario.rounds[3]!;
    const bureau = round4.letters.find((l) => l.recipient.type === "bureau")!;
    const plain = roundMailPlan(rosario, round4, withMidland, later);
    const upgraded = roundMailPlan(rosario, round4, withMidland, later, { [bureau.id]: "certified_return_receipt" });
    const before = plain.letters.find((l) => l.letter.id === bureau.id)!;
    const after = upgraded.letters.find((l) => l.letter.id === bureau.id)!;
    expect(before.mailClass).toBe(before.defaultClass);
    expect(after.mailClass).toBe("certified_return_receipt");
    expect(after.cost.mills - before.cost.mills).toBe(before.mailClass === "certified" ? LOB_PRICES.returnReceipt : LOB_PRICES.certified + LOB_PRICES.returnReceipt);
    expect(upgraded.totalMills - plain.totalMills).toBe(after.cost.mills - before.cost.mills);
  });

  it("splits a batch into what goes now and what is held, with why", () => {
    const refs = [
      { clientId: "c07", roundNumber: 1 },
      { clientId: "c50", roundNumber: 4 },
      { clientId: "c14", roundNumber: 2 },
      { clientId: "c10", roundNumber: 1 },
      { clientId: "nobody", roundNumber: 1 },
    ];
    const batch = buildSendBatch(demo, refs, later, book);
    expect(batch.ready.map((p) => p.client.id)).toEqual(["c07", "c14"]);
    expect(batch.held.map((h) => [h.ref.clientId, Boolean(h.plan)])).toEqual([
      ["c50", true],
      ["c10", false],
      ["nobody", false],
    ]);
    expect(batch.held[0]!.reason).toMatch(/Midland/);
    expect(batch.held[1]!.reason).toMatch(/ya se envió/);
    expect(batch.letters).toBe(batch.ready.reduce((n, p) => n + p.letters.length, 0));
    expect(Object.values(batch.byClass).reduce((a, b) => a + b, 0)).toBe(batch.letters);
    expect(batch.totalMills).toBe(batch.ready.reduce((n, p) => n + p.totalMills, 0));
  });

  it("records the class and the address of a demo send, simulated, with no tracking number", () => {
    const at = later.toISOString();
    const sent = applyDemoActions(demo, { ...EMPTY_ACTIONS, sent: { c07: { "1": at } } });
    const c07 = sent.find((c) => c.id === "c07")!;
    const letterId = c07.rounds[0]!.letters[0]!.id;
    const after = applyDemoSends(sent, { c07: { "1": { via: "simulated", classes: { [letterId]: "certified" }, addresses: {} } } });
    const letter = after.find((c) => c.id === "c07")!.rounds[0]!.letters[0]!;
    expect(letter.mailClass).toBe("certified");
    expect(letter.mail).toMatchObject({ provider: "simulated", mailClass: "certified", trackingNumber: null, mailedAt: at });
    expect(letter.mail!.events).toHaveLength(1);
    const printed = applyDemoSends(sent, { c07: { "1": { via: "print", classes: {}, addresses: {} } } });
    expect(printed.find((c) => c.id === "c07")!.rounds[0]!.letters[0]!.mail?.provider).toBe("print");
  });
});

describe("mail: returned letters and the response window", () => {
  const base = buildDemoClients(NOW);
  const demo = withDemoMail(base);

  it("a returned letter is a staff exception that says why", () => {
    const graciela = demo.find((c) => c.id === "c11")!;
    const exception = clientExceptions(graciela, later).find((e) => e.kind === "letter_returned")!;
    expect(exception.sentence).toMatch(/devolvió la carta/);
    expect(exception.sentence).toMatch(/Motivo: devuelta al remitente\./);
    expect(exception.since).toBe(graciela.rounds[0]!.letters[1]!.mail!.returnedAt);
  });

  it("billing does not charge a round whose letters all came back; one that reached anyone is charged as before", () => {
    const baltazar = base.find((c) => c.id === "c23")!;
    const allBack: StaffClient = {
      ...baltazar,
      rounds: baltazar.rounds.map((r) => ({ ...r, letters: r.letters.map((l) => ({ ...l, mailStatus: "returned" as const })) })),
    };
    const verdict = chargeEligibility(clientBilling(allBack), NOW);
    expect(verdict.eligible ? null : verdict.code).toBe("all_letters_returned");
    const oneBack: StaffClient = {
      ...baltazar,
      rounds: baltazar.rounds.map((r) => ({ ...r, letters: r.letters.map((l, i) => (i === 0 ? { ...l, mailStatus: "undeliverable" as const } : l)) })),
    };
    const other = chargeEligibility(clientBilling(oneBack), NOW);
    expect(other.eligible ? "eligible" : other.code).not.toBe("all_letters_returned");
  });

  it("the server's billing reads the post office's answer from the letters (mail_status)", () => {
    const round = { round_number: 1, status: "mailed", mailed_at: "2026-11-01T15:00:00.000Z" };
    const rows = [
      { status: "queued", mail_status: "returned", target_type: "bureau", target_key: "equifax", target_name: "Equifax" },
      { status: "queued", mail_status: "undeliverable", target_type: "furnisher", target_key: "x", target_name: "X" },
      { status: "draft", mail_status: "not_sent", target_type: "bureau", target_key: "experian", target_name: "Experian" },
    ];
    expect(billableRoundFromRows(round, rows).letters.map((l) => l.returned)).toEqual([true, true]);
    expect(billableRoundFromRows(round, [{ ...rows[0]!, mail_status: "in_transit" }]).letters[0]!.returned).toBe(false);
    expect(billableRoundFromRows(round, [{ ...rows[0]!, status: "failed", mail_status: "not_sent" }]).letters[0]!.returned).toBe(true);
  });

  it("the 30-day window counts from a certified letter's delivery scan, never from a first-class estimate", () => {
    const rosario = demoRosario(NOW);
    const movRound = rosario.rounds.find((r) => r.number === 3)!;
    expect(movRound.letters.every((l) => l.mail?.mailClass === "certified")).toBe(true);
    const delivered = movRound.letters.map((l) => letterDeliveredAt(l)!).sort();
    expect(responseWindowStart(movRound)).toBe(delivered[delivered.length - 1]);
    expect(new Date(responseWindowStart(movRound)!).getTime()).toBeGreaterThan(new Date(movRound.mailedAt!).getTime());
    // Round 2 went first class: "delivered" is the mail service's estimate, so the mailing date stands.
    const firstClass = rosario.rounds.find((r) => r.number === 2)!;
    expect(firstClass.letters.every((l) => l.mail?.mailClass === "first_class" && Boolean(l.mail.deliveredAt))).toBe(true);
    expect(responseWindowStart(firstClass)).toBe(firstClass.mailedAt);
    // A returned letter does not count.
    const back = { ...movRound, letters: movRound.letters.map((l) => ({ ...l, mailStatus: "returned" as const })) };
    expect(responseWindowStart(back)).toBe(movRound.mailedAt);
  });

  it("the system re-imports the report 35 days after the certified delivery (30 + 5 for the answer), not 40 after mailing", () => {
    const ernesto = base.find((c) => c.id === "c10")!;
    const mailedAt = ernesto.rounds[0]!.mailedAt!;
    const deliveredAt = new Date(new Date(mailedAt).getTime() + 3 * DAY).toISOString();
    const certified: StaffClient = {
      ...ernesto,
      rounds: ernesto.rounds.map((r) => ({
        ...r,
        letters: r.letters.map((l) => ({
          ...l,
          mailStatus: "delivered" as const,
          mail: { mailClass: "certified" as const, provider: "lob" as const, externalId: "ltr", trackingNumber: "9407100000000000000000", mailedAt, deliveredAt, returnedAt: null, returnReason: null, events: [] },
        })),
      })),
    };
    const before = nextAutomaticStep(ernesto, later)!;
    const after = nextAutomaticStep(certified, later)!;
    expect(before.text).toMatch(/Re-importar/);
    // No scan: mailing + 5 days' transit + 30 + 5 = 40. Delivered on day 3: 3 + 30 + 5 = 38 (rounds/timing.ts).
    expect(new Date(before.at).getTime() - new Date(mailedAt).getTime()).toBe(40 * DAY);
    expect(new Date(after.at).getTime() - new Date(deliveredAt).getTime()).toBe(35 * DAY);
    expect(new Date(after.at).getTime() - new Date(before.at).getTime()).toBe(-2 * DAY);
  });
});

// ── The client app ──────────────────────────────────────────────────────

describe("mail: the client's letter status", () => {
  const mailedAt = "2026-11-03T18:00:00.000Z";

  it("reads in plain Spanish and English", () => {
    const delivered = clientLetterMail({ templateKey: "mov_request" }, mailedAt, { status: "delivered", deliveredAt: "2026-11-07T18:00:00.000Z" });
    expect(letterMailLine(delivered, "es")).toBe("Enviada el 3 de noviembre · Certificada · Entregada el 7 de noviembre");
    expect(letterMailLine(delivered, "en")).toBe("Mailed November 3 · Certified · Delivered November 7");
    const moving = clientLetterMail({ templateKey: "dispute_611_accounts" }, mailedAt);
    expect(letterMailLine(moving, "es")).toBe("Enviada el 3 de noviembre · Primera clase · En camino");
    expect(letterMailLine(moving, "en")).toBe("Mailed November 3 · First class · On its way");
    const estimate = clientLetterMail({ templateKey: "dispute_611_accounts" }, mailedAt, { status: "delivered", deliveredAt: "2026-11-06T18:00:00.000Z" });
    expect(letterMailLine(estimate, "es")).toBe("Enviada el 3 de noviembre · Primera clase · Entregada el 6 de noviembre (aprox.)");
    const back = clientLetterMail({ templateKey: "furnisher_direct", targetType: "furnisher" }, mailedAt, { status: "returned", returnedAt: "2026-11-10T18:00:00.000Z" });
    expect(letterMailLine(back, "es")).toBe("Enviada el 3 de noviembre · Certificada · El correo la devolvió el 10 de noviembre; tu equipo la revisa");
    expect(letterMailLine(clientLetterMail({ templateKey: "mov_request" }, null), "es")).toBeNull();
  });

  it("never promises anything and never invents a delivery", () => {
    const lines = (["es", "en"] as const).flatMap((locale) =>
      [
        clientLetterMail({ templateKey: "mov_request" }, mailedAt, { status: "delivered", deliveredAt: "2026-11-07T18:00:00.000Z" }),
        clientLetterMail({ templateKey: "dispute_611_accounts" }, mailedAt),
        clientLetterMail({ templateKey: "debt_validation" }, mailedAt, { status: "undeliverable", returnedAt: "2026-11-10T18:00:00.000Z" }),
      ].map((m) => letterMailLine(m, locale)!),
    );
    for (const line of lines) expect(checkClaimGuardrails(line), line).toEqual([]);
    // Nothing saved: on its way, with no delivery date.
    expect(clientLetterMail({ templateKey: "mov_request" }, mailedAt)).toMatchObject({ status: "in_transit", deliveredAt: null });
  });

  it("counts the response window from a certified delivery when the client app knows one", () => {
    const certified = clientLetterMail({ templateKey: "mov_request" }, mailedAt, { status: "delivered", deliveredAt: "2026-11-07T18:00:00.000Z" });
    const firstClass = clientLetterMail({ templateKey: "dispute_611_accounts" }, mailedAt, { status: "delivered", deliveredAt: "2026-11-09T18:00:00.000Z" });
    expect(clientResponseWindowStart(mailedAt, [certified, firstClass])).toBe("2026-11-07T18:00:00.000Z");
    expect(clientResponseWindowStart(mailedAt, [firstClass])).toBe(mailedAt);
  });

  it("the new customer-facing files keep the house wording rules", () => {
    for (const file of ["src/lib/mail/clientView.ts", "src/lib/ux/letterMail.ts"]) {
      const text = readFileSync(file, "utf8");
      expect(/ataque/i.test(text), file).toBe(false);
      expect(/CreditCapi/.test(text), file).toBe(false);
    }
  });
});

// ── The database ────────────────────────────────────────────────────────

describe("mail: migration 0013", () => {
  const sql = readFileSync("supabase/migrations/0013_mail_tracking.sql", "utf8").replace(/--.*$/gm, "");

  it("gives clients and staff read access only, on every new table", () => {
    const policies = sql.match(/create policy[^;]+;/g) ?? [];
    expect(policies).toHaveLength(4);
    for (const policy of policies) {
      expect(policy).toMatch(/for select using/);
      expect(policy).not.toMatch(/for (all|insert|update|delete)|with check/);
    }
    expect(sql).toMatch(/create policy "own mail events read" on public\.mail_events\s+for select using \(auth\.uid\(\) = user_id\)/);
    expect(sql).not.toMatch(/drop policy|alter policy/);
  });

  it("records each provider event once, append-only, and refuses a charge for a round that all came back", () => {
    expect(sql).toMatch(/constraint mail_events_once unique \(provider, provider_event_id\)/);
    expect(sql).toMatch(/before update or delete on public\.mail_events/);
    expect(sql).toMatch(/before update or delete on public\.furnisher_changes/);
    expect(sql).toMatch(/create trigger charges_guard_returned\s+before insert on public\.charges/);
    expect(sql).toMatch(/after insert or update on public\.furnishers/);
  });

  it("seeds company names only, with no address", () => {
    const seed = sql.slice(sql.indexOf("insert into public.furnishers"));
    expect(seed).not.toMatch(/address_lines|verified_on|P\.O\.|Box/);
  });
});
