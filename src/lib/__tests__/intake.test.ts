import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { DEMO_RAW_REPORT, DEMO_REPORT } from "../demo";
import { parseReport } from "../domain/parser";
import type { ReportItem } from "../domain/types";
import { checkClaimGuardrails } from "../compliance/guardrails";
import { callClaude, type ModelAnswer, type ModelCaller, type StructuredCall } from "../intake/claude";
import { decideLetter, LETTER_JSON_SCHEMA, readBureauLetter, simulatedLetterReading, type LetterReading } from "../intake/bureauLetter";
import { clientLetterSummary } from "../intake/letterSummary";
import { PROOF_OF_ADDRESS_MAX_AGE_DAYS } from "../intake/config";
import { estimateCostUsd, NO_USAGE, usageFrom } from "../intake/cost";
import { intakeExceptions } from "../intake/exceptions";
import { checkUpload, sniffFile } from "../intake/files";
import { checkIdentityDocument, decideIdentity, IDENTITY_JSON_SCHEMA, simulatedIdentityCheck, type IdentityReading } from "../intake/identity";
import { addressesMatch, creditorsMatch, namesMatch } from "../intake/match";
import { roundOutcomes, verifiedItems } from "../intake/outcomes";
import { findSensitive, htmlToText, redactSensitive } from "../intake/redact";
import { schemaProblems } from "../intake/schema";
import type { IntakeRecord } from "../intake/types";
import { AI_ENVELOPE_FORMAT, readAiEnvelope } from "../intake/report/envelope";
import { countPdfPages, extractReport, simulatedReportExtraction } from "../intake/report/extract";
import { extractionFromRaw } from "../intake/report/fromRaw";
import { REPORT_JSON_SCHEMA, REPORT_SYSTEM_PROMPT, type ReportExtraction } from "../intake/report/model";
import { isMaskedAccount, maskAccount, providerKey, validateReportExtraction } from "../intake/report/validate";
import { getReportReader, ReportReadError } from "../reports/readers";
import { FIXTURE_REPORT_DATE, fixtureRawReport } from "../intake/__fixtures__/fixture";
import { renderMonitoringReportHtml } from "../intake/__fixtures__/monitoringReport";

// AI intake (src/lib/intake). No test here reaches the network: every model
// answer is a fake handed in. The one live test is intake.live.test.ts, which
// runs only with ANTHROPIC_API_KEY set.

const NOW = new Date(`${FIXTURE_REPORT_DATE}T18:00:00.000Z`);
const FIXTURE = fixtureRawReport(DEMO_RAW_REPORT);
const FIXTURE_HTML = readFileSync("src/lib/intake/__fixtures__/demo-monitoring-report.html", "utf8");
const FIXTURE_PDF = new Uint8Array(readFileSync("src/lib/intake/__fixtures__/demo-monitoring-report.pdf"));
const SOURCE_TEXT = redactSensitive(htmlToText(FIXTURE_HTML));

/** What a careful model would answer for the fixture page: every quote copied from the page. */
function goodAnswer(): ReportExtraction {
  const x = extractionFromRaw(FIXTURE, { provider: "SampleCredit Monitor", page: () => 1 });
  x.reportDateCitation = { page: 1, quote: `Report Date: 11/20/2026` };
  x.tradelines = x.tradelines.map((t) => ({ ...t, citation: { page: 1, quote: t.creditor.toUpperCase() } }));
  x.inquiries = x.inquiries.map((q) => ({ ...q, citation: { page: 1, quote: q.inquirer } }));
  x.summaryCounts = x.summaryCounts.map((c) => ({ ...c, citation: { page: 1, quote: "Total Accounts:" } }));
  return x;
}

const fake = (output: unknown, problem: string | null = null): ModelCaller & { calls: StructuredCall[] } => {
  const calls: StructuredCall[] = [];
  const caller = (async (call: StructuredCall): Promise<ModelAnswer> => {
    calls.push(call);
    return { output: problem ? null : output, problem, stopReason: problem === "refusal" ? "refusal" : "end_turn", model: "claude-opus-5-5", usage: { inputTokens: 30_000, outputTokens: 6_000, cacheReadTokens: 2_000, cacheWriteTokens: 0 } };
  }) as ModelCaller & { calls: StructuredCall[] };
  caller.calls = calls;
  return caller;
};

describe("intake: the fictional fixtures", () => {
  it("are clearly fictional and match the demo report", () => {
    expect(FIXTURE_HTML).toContain("FICTIONAL SAMPLE");
    expect(FIXTURE_HTML).toBe(renderMonitoringReportHtml(FIXTURE));
    expect(sniffFile(FIXTURE_PDF)).toBe("pdf");
    expect(countPdfPages(FIXTURE_PDF)).toBe(3);
    expect(checkUpload("credit_report", FIXTURE_PDF).ok).toBe(true);
    expect(sniffFile(new TextEncoder().encode(FIXTURE_HTML))).toBe("html");
  });

  it("a saved page is reduced to text with the SSN and birth date removed before it is sent", () => {
    expect(FIXTURE_HTML).toContain("XXX-XX-1234");
    expect(FIXTURE_HTML).toContain("01/15/1985");
    expect(SOURCE_TEXT).not.toContain("1234 ");
    expect(SOURCE_TEXT).not.toMatch(/XXX-XX|01\/15\/1985/);
    expect(SOURCE_TEXT).toContain("[REDACTED]");
    expect(SOURCE_TEXT).toContain("MIDLAND CREDIT MANAGEMENT");
    expect(SOURCE_TEXT).not.toMatch(/<td|<style|font-family/);
    expect(findSensitive(SOURCE_TEXT.replace(/Social Security Number|Date of Birth/g, ""))).toEqual([]);
  });

  it("redacts SSN-like numbers and birth dates in any spelling", () => {
    for (const text of ["SSN: 123-45-6789", "ssn 123 45 6789", "Social Security No. 123456789", "id 123456789 end", "***-**-6789", "Date of Birth: 1980-01-02", "DOB 01/02/1980", "Fecha de nacimiento: 2 ene 1980"]) {
      const out = redactSensitive(text);
      expect(out, text).toContain("[REDACTED]");
      expect(out, text).not.toMatch(/6789|1980/);
    }
    // Account numbers that are masked, dates of accounts, amounts and ZIP codes stay.
    expect(redactSensitive("Account #: ****8821 Opened 02/20/2024 Balance $1,250 Houston, TX 77001")).toBe("Account #: ****8821 Opened 02/20/2024 Balance $1,250 Houston, TX 77001");
  });
});

describe("intake: validating a credit report reading", () => {
  it("accepts a good reading: every item high confidence, counts match, same items as the report", () => {
    const v = validateReportExtraction(goodAnswer(), { now: NOW, sourceText: SOURCE_TEXT });
    expect(v.fatal).toEqual([]);
    expect(v.warnings).toEqual([]);
    expect(v.items.every((i) => i.confidence === "high" && !i.excluded)).toBe(true);
    expect(v.raw).not.toBeNull();
    const fromAi = parseReport(v.raw).items.map((i) => i.fingerprint).sort();
    const expected = parseReport(FIXTURE).items.map((i) => i.fingerprint).sort();
    expect(fromAi).toEqual(expected);
    expect(v.raw!.pulledAt.slice(0, 10)).toBe(FIXTURE_REPORT_DATE);
    expect(parseReport(v.raw).scores).toEqual(parseReport(FIXTURE).scores);
    // Furnisher addresses never come from a reading.
    expect(v.raw!.bureaus.equifax!.tradelines.every((t) => t.furnisher === null)).toBe(true);
  });

  it("refuses a malformed answer, whatever its shape", () => {
    for (const output of [null, "texto", 42, [], { foo: 1 }, { ...goodAnswer(), tradelines: "x" }, { ...goodAnswer(), extra: true }]) {
      const v = validateReportExtraction(output, { now: NOW });
      expect(v.raw).toBeNull();
      expect(v.fatal.join(" ")).toMatch(/forma esperada/);
    }
  });

  it("refuses an invented bureau: a name that is not a bureau, or one the document never mentions", () => {
    const innovis = goodAnswer() as unknown as { tradelines: Array<{ bureau: string }> };
    innovis.tradelines[0]!.bureau = "innovis";
    expect(validateReportExtraction(innovis, { now: NOW }).raw).toBeNull();

    const text = SOURCE_TEXT.replace(/TransUnion/gi, "Other");
    const v = validateReportExtraction(goodAnswer(), { now: NOW, sourceText: text });
    expect(v.raw).toBeNull();
    expect(v.fatal.join(" ")).toMatch(/TransUnion, pero el documento no lo menciona/);

    // An item under a bureau the reading itself says is not in the report is left out.
    const x = goodAnswer();
    x.bureausPresent = ["equifax", "experian"];
    const w = validateReportExtraction(x, { now: NOW });
    const tu = w.items.filter((i) => i.bureau === "transunion");
    expect(tu.length).toBeGreaterThan(0);
    expect(tu.every((i) => i.excluded && i.reasons.some((r) => /no trae/.test(r)))).toBe(true);
    expect(w.raw!.bureaus.transunion).toBeUndefined();
  });

  it("warns when the counts do not match the summary the report printed", () => {
    const x = goodAnswer();
    x.summaryCounts = x.summaryCounts.map((c) => (c.bureau === "equifax" ? { ...c, accounts: 3, inquiries: 2 } : c));
    const v = validateReportExtraction(x, { now: NOW });
    expect(v.raw).not.toBeNull();
    expect(v.warnings).toEqual([
      "Equifax: el resumen del reporte dice 3 cuentas y se leyeron 2. Revisa que no falte ni sobre ninguna.",
      "Equifax: el resumen del reporte dice 2 consultas y se leyeron 1. Revisa que no falte ni sobre ninguna.",
    ]);
    const none = goodAnswer();
    none.summaryCounts = [];
    expect(validateReportExtraction(none, { now: NOW }).warnings.join(" ")).toMatch(/no se pudo comparar/);
  });

  it("throws the whole answer away when it carries an SSN or a birth date", () => {
    const cases: Array<(x: ReportExtraction) => void> = [
      (x) => (x.personalInfo[0]!.value = "123-45-6789"),
      (x) => (x.tradelines[0]!.citation.quote = "SSN: XXX-XX-1234"),
      (x) => (x.tradelines[0]!.remarks = ["consumer 123456789"]),
      (x) => (x.unreadable = ["Date of Birth: 01/15/1985"]),
      (x) => ((x as unknown as Record<string, unknown>).ssn = "x"),
    ];
    for (const leak of cases) {
      const x = goodAnswer();
      leak(x);
      const v = validateReportExtraction(x, { now: NOW });
      expect(v.discard).toBe(true);
      expect(v.raw).toBeNull();
      expect(v.items).toEqual([]);
    }
  });

  it("masks an account number that came in full, and marks it", () => {
    expect(isMaskedAccount("****1234")).toBe(true);
    expect(isMaskedAccount("517805XXXXXX")).toBe(true);
    expect(isMaskedAccount("1234")).toBe(true);
    expect(isMaskedAccount("4111111111111111")).toBe(false);
    expect(isMaskedAccount("4111 1111 1111")).toBe(false);
    expect(maskAccount("4111-1111-1111-1234")).toBe("****1234");
    const x = goodAnswer();
    x.tradelines[0]!.accountNumberMasked = "4111111111111234";
    const v = validateReportExtraction(x, { now: NOW });
    expect(v.raw!.bureaus.equifax!.tradelines[0]!.accountNumberMasked).toBe("****1234");
    expect(v.items[0]!.confidence).toBe("low");
    expect(JSON.stringify(v.raw)).not.toContain("4111111111111234");
  });

  it("drops impossible dates and amounts, and says so", () => {
    const x = goodAnswer();
    const t = x.tradelines[0]!;
    t.openedAt = "2026-02-31";
    t.lastPaymentAt = "2031-01-01";
    t.balance = -5;
    t.creditLimit = 1e9;
    const v = validateReportExtraction(x, { now: NOW });
    const saved = v.raw!.bureaus.equifax!.tradelines[0]!;
    expect(saved.openedAt).toBeUndefined();
    expect(saved.lastPaymentAt).toBeUndefined();
    expect(saved.balance).toBeUndefined();
    expect(saved.creditLimit).toBeUndefined();
    expect(v.items[0]!.reasons.length).toBe(4);
    expect(v.items[0]!.confidence).toBe("low");
    const y = goodAnswer();
    y.tradelines[0]!.openedAt = "2026-06";
    y.tradelines[0]!.lastReportedAt = "2025-01-10";
    expect(validateReportExtraction(y, { now: NOW }).items[0]!.reasons).toContain("La fecha de apertura es posterior a la del último reporte.");
  });

  it("needs the report's own date, and refuses one in the future", () => {
    const x = goodAnswer();
    x.reportDate = null;
    expect(validateReportExtraction(x, { now: NOW }).fatal.join(" ")).toMatch(/fecha del reporte/);
    x.reportDate = "2027-01-01";
    expect(validateReportExtraction(x, { now: NOW }).fatal.join(" ")).toMatch(/en el futuro/);
    x.reportDate = "2026-05-01";
    expect(validateReportExtraction(x, { now: NOW }).warnings.join(" ")).toMatch(/más de 120 días/);
  });

  it("flags repeats, unsure readings, quotes not in the page, impossible pages; leaves out nameless entries", () => {
    const x = goodAnswer();
    x.tradelines.push({ ...x.tradelines[0]! });
    x.tradelines[1]!.confidence = "low";
    x.tradelines[1]!.doubt = "Column alignment unclear";
    x.inquiries[0]!.citation = { page: 1, quote: "Something that is not on the page" };
    x.personalInfo[0]!.citation = { page: 9, quote: x.personalInfo[0]!.value };
    x.publicRecords.push({ bureau: "equifax", recordType: "", court: "", filedAt: null, status: "", citation: { page: 1, quote: "x" }, confidence: "high", doubt: null });
    const v = validateReportExtraction(x, { now: NOW, sourceText: SOURCE_TEXT, pageCount: 3 });
    const capital = v.items.filter((i) => i.label.startsWith("Capital One"));
    expect(capital.map((i) => i.excluded)).toEqual([false, true]);
    expect(capital[0]!.reasons.join(" ")).toMatch(/Tiene un repetido/);
    expect(v.items[1]!.reasons.join(" ")).toMatch(/no está segura: «Column alignment unclear»/);
    expect(v.items.find((i) => i.category === "inquiry")!.reasons).toContain("La cita no aparece tal cual en el documento.");
    expect(v.items.find((i) => i.category === "personal_info")!.reasons.join(" ")).toMatch(/página citada \(9\) no existe/);
    expect(v.items.find((i) => i.category === "public_record")!.excluded).toBe(true);
    expect(v.raw!.bureaus.equifax!.tradelines.filter((t) => t.creditor === "Capital One")).toHaveLength(1);
  });

  it("refuses a document that is not a credit report, or a reading with nothing in it", () => {
    expect(validateReportExtraction({ ...goodAnswer(), documentIsCreditReport: false }, { now: NOW }).fatal).toEqual(["Este documento no parece un reporte de crédito."]);
    const empty = { ...goodAnswer(), tradelines: [], inquiries: [], personalInfo: [], publicRecords: [] };
    expect(validateReportExtraction(empty, { now: NOW }).fatal.join(" ")).toMatch(/ninguna cuenta/);
  });

  it("names the provider when it is a known one", () => {
    expect(providerKey("IdentityIQ")).toBe("identityiq");
    expect(providerKey("Smart Credit")).toBe("smartcredit");
    expect(providerKey("Otro")).toBe("ai_document");
    expect(providerKey(null)).toBe("ai_document");
  });
});

describe("intake: reading a report end to end (fake model)", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  it("sends a PDF as a document with the fixed, cacheable instructions and the strict schema", async () => {
    const call = fake(goodAnswer());
    const result = await extractReport({ bytes: FIXTURE_PDF, fileName: "reporte.pdf", now: NOW, call });
    expect(call.calls).toHaveLength(1);
    const sent = call.calls[0]!;
    expect(sent.task).toBe("credit_report");
    expect(sent.system).toBe(REPORT_SYSTEM_PROMPT);
    expect(sent.schema).toBe(REPORT_JSON_SCHEMA);
    expect(sent.content[0]).toMatchObject({ type: "document", source: { type: "base64", media_type: "application/pdf" } });
    expect(result.pageCount).toBe(3);
    expect(result.simulated).toBe(false);
    expect(result.validation.raw).not.toBeNull();
    expect(result.costUsd).toBeCloseTo((30_000 * 4 + 6_000 * 20 + 2_000 * 0.2) / 1e6, 4);
    // The envelope is what the ai_document reader takes, and it reads again on its own.
    const raw = getReportReader("ai_document")!.read(JSON.stringify(result.envelope));
    expect(parseReport(raw).items.length).toBe(parseReport(FIXTURE).items.length);
  });

  it("sends a saved page as redacted text, and checks the quotes against it", async () => {
    const call = fake(goodAnswer());
    const result = await extractReport({ bytes: new TextEncoder().encode(FIXTURE_HTML), fileName: "reporte.html", now: NOW, call });
    const block = call.calls[0]!.content[0] as { type: string; source: { type: string; data: string } };
    expect(block.type).toBe("document");
    expect(block.source.type).toBe("text");
    expect(block.source.data).not.toMatch(/XXX-XX-1234|01\/15\/1985/);
    expect(result.validation.items.every((i) => i.confidence === "high")).toBe(true);
    const lying = goodAnswer();
    lying.tradelines[0]!.citation.quote = "BANK OF NOWHERE ****0000";
    const flagged = await extractReport({ bytes: new TextEncoder().encode(FIXTURE_HTML), fileName: null, now: NOW, call: fake(lying) });
    expect(flagged.validation.items[0]!.reasons).toContain("La cita no aparece tal cual en el documento.");
  });

  it("keeps nothing of an answer with an SSN in it, and routes model failures to a person", async () => {
    const leaky = goodAnswer();
    leaky.personalInfo[0]!.value = "SSN 123-45-6789";
    const leaked = await extractReport({ bytes: FIXTURE_PDF, fileName: null, now: NOW, call: fake(leaky) });
    expect(leaked.envelope).toBeNull();
    expect(leaked.validation.discard).toBe(true);
    for (const problem of ["refusal", "max_tokens", "invalid_json", "api_error", "empty"]) {
      const r = await extractReport({ bytes: FIXTURE_PDF, fileName: null, now: NOW, call: fake(null, problem) });
      expect(r.envelope).toBeNull();
      expect(r.problem).toBeTruthy();
      expect(r.validation.fatal).toEqual([r.problem]);
    }
  });

  it("refuses files that are not a report before calling anything", async () => {
    const call = fake(goodAnswer());
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    const r = await extractReport({ bytes: png, fileName: "x.png", now: NOW, call });
    expect(r.problem).toMatch(/no es un PDF/);
    expect(call.calls).toHaveLength(0);
  });

  it("without an API key, returns a labelled simulated reading with one unsure item; it never saves to a real client", async () => {
    const r = await extractReport({ bytes: FIXTURE_PDF, fileName: "x.pdf", now: NOW });
    expect(r.simulated).toBe(true);
    expect(r.envelope!.simulated).toBe(true);
    const low = r.validation.items.filter((i) => i.confidence === "low");
    expect(low.map((i) => i.label)).toEqual(["Synchrony Bank ****5521"]);
    expect(r.validation.warnings).toEqual([]);
    // The demo may save it…
    expect(() => readAiEnvelope(JSON.stringify(r.envelope), NOW)).not.toThrow();
    // …a database never takes it.
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    expect(() => getReportReader("ai_document")!.read(JSON.stringify(r.envelope))).toThrow(ReportReadError);
    expect(simulatedReportExtraction(NOW).tradelines.some((t) => t.confidence === "low")).toBe(true);
  });

  it("the ai_document reader refuses anything that is not a reading, and re-checks a tampered one", () => {
    const reader = getReportReader("ai_document")!;
    expect(reader.upload).toBe("ai");
    expect(() => reader.read(JSON.stringify(DEMO_RAW_REPORT))).toThrow(ReportReadError);
    expect(() => reader.read("<html></html>")).toThrow(ReportReadError);
    const tampered = { format: AI_ENVELOPE_FORMAT, version: 1, simulated: false, intakeId: null, fileName: null, fileKind: "pdf", model: "m", extractedAt: NOW.toISOString(), extraction: { ...goodAnswer(), reportDate: "2099-01-01" } };
    expect(() => reader.read(JSON.stringify(tampered))).toThrow(/en el futuro/);
    expect(reader.detect(JSON.stringify(tampered))).toBe(true);
  });

  it("calls nothing without a key (no network in tests)", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const r = await callClaude({ task: "identity", system: "x", content: [], schema: {} });
    expect(r.problem).toBe("not_configured");
    expect(r.usage).toEqual(NO_USAGE);
  });
});

describe("intake: schemas the model answers in", () => {
  it("close every object and require every property (structured outputs), with no unsupported keywords", () => {
    expect(schemaProblems(REPORT_JSON_SCHEMA)).toEqual([]);
    expect(schemaProblems(IDENTITY_JSON_SCHEMA)).toEqual([]);
    expect(schemaProblems(LETTER_JSON_SCHEMA)).toEqual([]);
    expect(schemaProblems({ type: "object", properties: { a: { type: "string", maxLength: 3 } }, additionalProperties: true })).toHaveLength(3);
  });

  it("have no field for an SSN, a birth date or an ID number, and the instructions forbid them", () => {
    for (const schema of [REPORT_JSON_SCHEMA, IDENTITY_JSON_SCHEMA, LETTER_JSON_SCHEMA]) {
      const keys = JSON.stringify(schema).match(/"[a-zA-Z]+":\{/g) ?? [];
      expect(keys.join(" ")).not.toMatch(/ssn|birth|dob|license|idNumber|documentNumber/i);
    }
    expect(REPORT_SYSTEM_PROMPT).toMatch(/Never output a Social Security number/);
    expect(REPORT_SYSTEM_PROMPT).toMatch(/Do not judge or comment on whether anything is negative, wrong, inaccurate or disputable/);
  });
});

describe("intake: matching names, addresses and creditors", () => {
  it("names: accents, capitals, middle names and second surnames do not matter; a different first name does", () => {
    expect(namesMatch("JOSE MARIA NUNEZ GARCIA", "José Núñez")).toBe(true);
    expect(namesMatch("Maria Guadalupe Lopez", "María López Hernández")).toBe(true);
    expect(namesMatch("ROBERTO MARTINEZ JR", "Roberto Martínez")).toBe(true);
    expect(namesMatch("Ana Lopez", "María López")).toBe(false);
    expect(namesMatch("Roberto", "Roberto Martínez")).toBe(false);
    expect(namesMatch("", "Roberto Martínez")).toBe(false);
  });

  it("addresses: same number, street and ZIP; abbreviations and apartment numbers do not matter", () => {
    const onFile = ["213 Calle Ejemplo", "Houston, TX 77001"];
    expect(addressesMatch(["213 CALLE EJEMPLO APT 4", "HOUSTON TX 77001-1234"], onFile)).toBe(true);
    expect(addressesMatch("123 Old Street Apt 2, Houston, TX 77001", "123 Old St, Houston TX 77001")).toBe(true);
    expect(addressesMatch("123 N Main Street, Dallas, TX 75201", "123 Main St, Dallas, TX 75201")).toBe(true);
    expect(addressesMatch("124 Old Street, Houston, TX 77001", "123 Old St, Houston TX 77001")).toBe(false);
    expect(addressesMatch("123 Old Street, Houston, TX 77002", "123 Old St, Houston TX 77001")).toBe(false);
    expect(addressesMatch("PO Box 55, Houston, TX 77001", onFile)).toBe(false);
  });

  it("creditors", () => {
    expect(creditorsMatch("CAPITAL ONE BANK USA NA", "Capital One")).toBe(true);
    expect(creditorsMatch("Midland Credit Mgmt", "Midland Credit Management")).toBe(false);
    expect(creditorsMatch("MIDLAND CREDIT MANAGEMENT INC", "Midland Credit Management")).toBe(true);
    expect(creditorsMatch("Synchrony Bank", "Capital One")).toBe(false);
  });
});

describe("intake: ID and proof of address", () => {
  const onFile = { fullName: "Roberto Martínez", addressLines: ["213 Calle Ejemplo", "Houston, TX 77001"] };
  const id = (over: Partial<IdentityReading> = {}): IdentityReading => ({
    documentType: "drivers_license",
    legible: true,
    problems: [],
    nameOnDocument: "MARTINEZ, ROBERTO CARLOS",
    addressOnDocument: ["213 CALLE EJEMPLO", "HOUSTON TX 77001"],
    documentDate: null,
    expirationDate: "2029-05-01",
    confidence: "high",
    ...over,
  });
  const bill = (over: Partial<IdentityReading> = {}): IdentityReading => ({
    ...id(),
    documentType: "utility_bill",
    nameOnDocument: "Roberto Martinez",
    expirationDate: null,
    documentDate: "2026-11-02",
    ...over,
  });

  it("accepts a clear, current ID with the client's name, with the reasons", () => {
    const d = decideIdentity("government_id", id(), onFile, NOW);
    expect(d.status).toBe("accepted");
    expect(d.reasons).toEqual(["Es una licencia de conducir.", "Se lee con claridad.", "El nombre coincide con el de tu cuenta.", "No está vencida."]);
  });

  it("sends to a person: expired, wrong kind, unreadable, other name, unsure, a document number in the answer, a malformed answer", () => {
    const cases: Array<[IdentityReading | unknown, RegExp]> = [
      [id({ expirationDate: "2025-01-01" }), /vencida \(venció el 2025-01-01\)/],
      [id({ documentType: "utility_bill" }), /no una identificación oficial/],
      [id({ legible: false, problems: ["glare"] }), /reflejo/],
      [id({ nameOnDocument: "Ana Torres" }), /no coincide con el de tu cuenta/],
      [id({ confidence: "medium" }), /no está segura/],
      [id({ nameOnDocument: "ROBERTO MARTINEZ D1234567" }), /no se pudo completar/],
      [{ documentType: "drivers_license" }, /no pudo leer/],
    ];
    for (const [reading, reason] of cases) {
      const d = decideIdentity("government_id", reading, onFile, NOW);
      expect(d.status).toBe("needs_person");
      expect(d.reasons.join(" ")).toMatch(reason);
    }
  });

  it("proof of address: matches the mailing address on file and is recent", () => {
    expect(decideIdentity("proof_of_address", bill(), onFile, NOW).status).toBe("accepted");
    const old = new Date(NOW.getTime() - (PROOF_OF_ADDRESS_MAX_AGE_DAYS + 5) * 86_400_000).toISOString().slice(0, 10);
    expect(decideIdentity("proof_of_address", bill({ documentDate: old }), onFile, NOW).reasons.join(" ")).toMatch(/más de 90 días/);
    expect(decideIdentity("proof_of_address", bill({ addressOnDocument: ["9 Otra Calle", "Dallas TX 75201"] }), onFile, NOW).reasons.join(" ")).toMatch(/dirección del documento no coincide/);
    expect(decideIdentity("proof_of_address", bill({ documentDate: null }), onFile, NOW).reasons.join(" ")).toMatch(/fecha del documento/);
    expect(decideIdentity("proof_of_address", bill(), { ...onFile, addressLines: [] }, NOW).reasons.join(" ")).toMatch(/todavía no tiene tu dirección/);
    expect(decideIdentity("proof_of_address", id(), onFile, NOW).reasons.join(" ")).toMatch(/recibo o estado de cuenta reciente/);
  });

  it("without a key: the demo shows both results; with a database every document goes to a person", async () => {
    expect(simulatedIdentityCheck("government_id", false).status).toBe("accepted");
    expect(simulatedIdentityCheck("proof_of_address", false).status).toBe("needs_person");
    const live = await checkIdentityDocument({ kind: "government_id", bytes: FIXTURE_PDF, onFile, now: NOW, live: true });
    expect(live.status).toBe("needs_person");
    expect(live.simulated).toBe(true);
  });

  it("refuses HEIC with a way out, and never stores what the model read", async () => {
    const heic = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]);
    const check = checkUpload("identity", heic);
    expect(check.ok).toBe(false);
    expect(!check.ok && check.message).toMatch(/HEIC.*JPG/);
    const call = fake(id());
    const result = await checkIdentityDocument({ kind: "government_id", bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]), onFile, now: NOW, call, live: true });
    expect(result.status).toBe("accepted");
    expect(call.calls[0]!.content[0]).toMatchObject({ type: "image", source: { media_type: "image/jpeg" } });
    // The result has the decision and the reasons only.
    expect(Object.keys(result).sort()).toEqual(["costUsd", "model", "reasons", "simulated", "status", "usage"]);
    expect(JSON.stringify(result)).not.toMatch(/MARTINEZ, ROBERTO|CALLE EJEMPLO/);
  });

  it("caps sizes", () => {
    const big = new Uint8Array(11 * 1024 * 1024);
    big.set([0xff, 0xd8, 0xff]);
    const c = checkUpload("identity", big);
    expect(!c.ok && c.status).toBe(413);
    expect(checkUpload("identity", new Uint8Array()).ok).toBe(false);
  });
});

describe("intake: bureau letters (optional)", () => {
  const items: ReportItem[] = DEMO_REPORT.items;
  const letter = (over: Partial<LetterReading> = {}): LetterReading => ({
    isBureauLetter: true,
    bureau: "equifax",
    letterDate: "2026-11-15",
    items: [
      { creditor: "MIDLAND CREDIT MANAGEMENT INC", accountNumber: "****8821", outcome: "deleted", outcomeWords: "Deleted", citation: { page: 1, quote: "MIDLAND ****8821 Deleted" }, confidence: "high" },
      { creditor: "Auto Finance Corp", accountNumber: "", outcome: "verified", outcomeWords: "Verified", citation: { page: 1, quote: "AUTO FINANCE CORP Verified" }, confidence: "high" },
    ],
    generalNotice: "none",
    generalCitation: null,
    unreadable: [],
    confidence: "high",
    ...over,
  });
  const midland = items.find((i) => i.bureau === "equifax" && i.name === "Midland Credit Management")!;

  it("matches each item to the report by creditor and last 4 digits, and accepts a clean letter", () => {
    const d = decideLetter(letter(), items, NOW);
    expect(d.status).toBe("accepted");
    expect(d.summary!.items.map((i) => i.fingerprint)).toEqual([midland.fingerprint, items.find((i) => i.name === "Auto Finance Corp")!.fingerprint]);
  });

  it("an unmatched item or an unsure reading is a note for staff, not an exception", () => {
    const d = decideLetter(letter({ items: [{ ...letter().items[0]!, accountNumber: "****0000" }] }), items, NOW);
    expect(d.status).toBe("read");
    expect(d.reasons.join(" ")).toMatch(/no se encontró en el reporte/);
    expect(decideLetter(letter({ confidence: "low" }), items, NOW).status).toBe("read");
    expect(decideLetter(letter({ isBureauLetter: false }), items, NOW).status).toBe("read");
    expect(decideLetter({ nope: 1 }, items, NOW).status).toBe("read");
  });

  it("only 'more information' or 'frivolous' needs a person", () => {
    const more = decideLetter(letter({ items: [{ ...letter().items[0]!, outcome: "more_info_requested" }] }), items, NOW);
    expect(more.status).toBe("needs_person");
    expect(decideLetter(letter({ generalNotice: "frivolous" }), items, NOW).status).toBe("needs_person");
    expect(decideLetter(letter({ generalNotice: "in_investigation" }), items, NOW).status).toBe("accepted");
    const records: IntakeRecord[] = [
      { id: "a", kind: "bureau_letter", at: NOW.toISOString(), status: "read", simulated: false, reasons: ["x"] },
      { id: "b", kind: "bureau_letter", at: NOW.toISOString(), status: "needs_person", simulated: false, reasons: ["piden más"] },
    ];
    expect(intakeExceptions(records, "c1").map((e) => e.key)).toEqual(["bureau_letter_needs_person:b"]);
  });

  it("an SSN in the reading throws it away", () => {
    const d = decideLetter(letter({ unreadable: ["SSN 123-45-6789"] }), items, NOW);
    expect(d.summary).toBeNull();
  });

  it("the client's summary is the letter's facts: no promise, no score, both languages", () => {
    for (const status of ["accepted", "needs_person", "read"] as const) {
      for (const locale of ["es", "en"] as const) {
        const outcomes = ["deleted", "verified", "updated", "in_investigation", "more_info_requested", "frivolous", "unclear"] as const;
        const s = clientLetterSummary({ bureau: "experian", letterDate: "2026-11-15", items: outcomes.map((outcome) => ({ creditor: "Capital One", account: "****1234", outcome, fingerprint: null, citation: null })) }, status, locale);
        const text = [s.title, ...s.lines, s.note].join(" ");
        expect(checkClaimGuardrails(text, "full_service")).toEqual([]);
        expect(text).not.toMatch(/puntaje|score|garantiz|guarantee/i);
        expect(s.lines.every((l) => /la carta dice|the letter says/.test(l))).toBe(true);
      }
    }
    expect(clientLetterSummary(null, "needs_person", "es").note).toMatch(/Una persona del equipo/);
  });

  it("without a key: the demo reads a simulated Equifax letter; with a database nothing is read and no exception is made", async () => {
    const demo = await readBureauLetter({ bytes: FIXTURE_PDF, reportItems: items, now: NOW, live: false });
    expect(demo.simulated).toBe(true);
    expect(demo.status).toBe("needs_person");
    expect(simulatedLetterReading(NOW).items).toHaveLength(3);
    const live = await readBureauLetter({ bytes: FIXTURE_PDF, reportItems: items, now: NOW, live: true });
    expect(live.status).toBe("read");
  });
});

describe("intake: round outcomes come from the report; letters only add what a report cannot show", () => {
  const before = DEMO_REPORT;
  const fp = (name: string, bureau = "equifax") => before.items.find((i) => i.name === name && i.bureau === bureau)!.fingerprint;
  const midland = fp("Midland Credit Management");
  const capital = fp("Capital One");
  const inquiry = fp("Auto Finance Corp");
  const after = (() => {
    const raw = structuredClone(DEMO_RAW_REPORT);
    raw.pulledAt = "2026-08-15T00:00:00.000Z";
    raw.bureaus.equifax!.tradelines = raw.bureaus.equifax!.tradelines.filter((t) => t.creditor !== "Midland Credit Management");
    raw.bureaus.equifax!.tradelines[0]!.balance = 100;
    return parseReport(raw);
  })();

  it("deleted, updated and (after the window) verified, from the report alone", () => {
    const o = roundOutcomes({ before, after, disputed: [midland, capital, inquiry], windowClosed: true });
    expect(o.get(midland)).toEqual({ outcome: "deleted", source: "report" });
    expect(o.get(capital)).toEqual({ outcome: "updated", source: "report" });
    expect(o.get(inquiry)).toEqual({ outcome: "verified", source: "report" });
    expect(verifiedItems(o)).toEqual([inquiry]);
    expect(roundOutcomes({ before, after, disputed: [inquiry], windowClosed: false }).get(inquiry)!.outcome).toBe("pending");
    expect(roundOutcomes({ before, after: null, disputed: [inquiry], windowClosed: false }).size).toBe(0);
  });

  it("a letter adds 'more information', 'frivolous' or 'still investigating'; the report wins on everything else", () => {
    const letters = [
      { creditor: "Auto Finance Corp", account: null, outcome: "more_info_requested" as const, fingerprint: inquiry, citation: null },
      { creditor: "Midland", account: "****8821", outcome: "verified" as const, fingerprint: midland, citation: null },
      { creditor: "Capital One", account: "****1234", outcome: "frivolous" as const, fingerprint: capital, citation: null },
    ];
    const o = roundOutcomes({ before, after, disputed: [midland, capital, inquiry], windowClosed: true, letters });
    expect(o.get(inquiry)).toEqual({ outcome: "more_info_requested", source: "letter" });
    expect(o.get(midland)).toEqual({ outcome: "deleted", source: "report", conflict: { letterOutcome: "verified" } });
    expect(o.get(capital)).toEqual({ outcome: "updated", source: "report", conflict: { letterOutcome: "frivolous" } });
    // Before any new report, a letter's word stands; a letter about an item not disputed is ignored.
    const early = roundOutcomes({ before, after: null, disputed: [midland], windowClosed: false, letters });
    expect(early.get(midland)).toEqual({ outcome: "verified", source: "letter" });
    expect(early.has(inquiry)).toBe(false);
  });
});

describe("intake: exceptions and cost", () => {
  it("the newest document check decides; an accepted one never reaches the list", () => {
    const base = { kind: "proof_of_address" as const, simulated: false };
    const older: IntakeRecord = { ...base, id: "1", at: "2026-11-01T00:00:00.000Z", status: "needs_person", reasons: ["La dirección no coincide."] };
    const newer: IntakeRecord = { ...base, id: "2", at: "2026-11-05T00:00:00.000Z", status: "accepted", reasons: ["ok"] };
    expect(intakeExceptions([older], "c1").map((e) => e.kind)).toEqual(["document_check_needs_person"]);
    expect(intakeExceptions([older, newer], "c1")).toEqual([]);
    expect(intakeExceptions(undefined, "c1")).toEqual([]);
  });

  it("estimates cost from tokens at the configured prices", () => {
    expect(estimateCostUsd({ inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(4);
    expect(estimateCostUsd({ inputTokens: 0, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 })).toBe(25.2);
    expect(usageFrom({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: null })).toEqual({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 });
  });

  it("the model call caches the fixed instructions and logs tokens", () => {
    const source = readFileSync("src/lib/intake/claude.ts", "utf8");
    expect(source).toMatch(/cache_control: \{ type: "ephemeral" \}/);
    expect(source).toMatch(/output_config: \{ effort: .*format: \{ type: "json_schema"/);
    expect(source).toMatch(/logIntakeUsage/);
    expect(source).toMatch(/process\.env\.ANTHROPIC_API_KEY/);
  });

  it("the AI never marks anything for dispute: intake writes no answer and no flag", () => {
    for (const file of ["claude.ts", "identity.ts", "bureauLetter.ts", "outcomes.ts", "server.ts", "report/validate.ts", "report/extract.ts", "report/envelope.ts"]) {
      const source = readFileSync(`src/lib/intake/${file}`, "utf8");
      expect(source, file).not.toMatch(/item_flags|attested|\.answers\b|attestation/);
    }
  });
});
