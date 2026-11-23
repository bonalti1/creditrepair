import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkClaimGuardrails } from "../compliance/guardrails";
import { DEMO_RAW_REPORT } from "../demo";
import { parseReport, type RawReport } from "../domain/parser";
import type { NormalizedReport, ReportItem } from "../domain/types";
import { FRESH_REPORT_DAYS } from "../monitoring/subscription";
import { importPreview, mergeReport, planImport, toRawReport } from "../reports/merge";
import {
  getReportReader,
  MAX_SOURCE_BYTES,
  REPORT_READERS,
  ReportReadError,
  suggestReader,
} from "../reports/readers";
import { templateJson, templateReport } from "../reports/template";
import { applyDemoActions, EMPTY_ACTIONS, type DemoActions } from "../staff/data";
import { buildDemoClients } from "../staff/demoClients";
import { clientExceptions, clientStage, nextStep, RESPONSE_WINDOW_DAYS, sendableRound } from "../staff/stage";
import { clientTimeline } from "../staff/timeline";
import type { ItemAnswer, StaffClient, StaffRound } from "../staff/types";
import { setStaffLocaleFallback } from "../staff/i18n/locale";

// Written against the Spanish console: the sentences these tests pin are the Spanish ones.
setStaffLocaleFallback("es");

// Noon in Texas on 5 December 2026.
const NOW = new Date("2026-12-05T18:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
const AT = NOW.toISOString();
const META = { at: AT, by: "ana", readerKey: "credalti_json" };

const credalti = getReportReader("credalti_json")!;

/** The demo report dated `daysAgo`, as a file's text. */
const raw = (daysAgo: number, change?: (r: RawReport) => void): RawReport => {
  const r = structuredClone(DEMO_RAW_REPORT);
  r.pulledAt = ago(daysAgo);
  change?.(r);
  return r;
};

/** What `read` says is wrong with a text, or [] when it reads. */
function problems(source: string): string[] {
  try {
    credalti.read(source);
    return [];
  } catch (error) {
    expect(error).toBeInstanceOf(ReportReadError);
    return (error as ReportReadError).problems;
  }
}

function answersFor(report: NormalizedReport, inaccurate: (item: ReportItem) => boolean): Record<string, ItemAnswer> {
  return Object.fromEntries(
    report.items.map((item): [string, ItemAnswer] => [
      item.fingerprint,
      inaccurate(item)
        ? { status: "inaccurate", reason: "No lo reconozco.", reasonCode: "not_mine", confirmedAt: ago(20) }
        : { status: "correct", answeredAt: ago(20) },
    ]),
  );
}

function client(overrides: Partial<StaffClient> = {}): StaffClient {
  return {
    id: "t1",
    firstName: "Prueba",
    lastName: "Ejemplo",
    phone: "+17135550100",
    state: "TX",
    addressLines: ["1 Calle Ejemplo", "Houston, TX 77001"],
    salesperson: "ana",
    createdAt: ago(60),
    signedUpAt: ago(59),
    agreementSignedAt: ago(58),
    documents: ["government_id", "proof_of_address"],
    report: null,
    answers: {},
    rounds: [],
    billing: { paymentMethod: null, charges: [], pause: null },
    lastActivityAt: ago(1),
    notes: [],
    questions: [],
    handled: {},
    ...overrides,
  };
}

const isCollection = (item: ReportItem) => item.name === "Midland Credit Management";

/** A client whose round 1 disputes both Midland collections and was mailed `mailedDaysAgo`. */
function mailedClient(mailedDaysAgo: number, reportDaysAgo = mailedDaysAgo + 4): StaffClient {
  const report = parseReport(raw(reportDaysAgo));
  const round: StaffRound = {
    number: 1,
    status: "mailed",
    mailedAt: ago(mailedDaysAgo),
    respondedAt: null,
    letters: [
      {
        id: "t1-r1-c1",
        recipient: { type: "bureau", key: "equifax", name: "Equifax Information Services LLC", addressLines: ["P.O. Box 740256", "Atlanta, GA 30374-0256"] },
        templateKey: "dispute_611_accounts",
        category: "tradeline",
        stage: "dispute",
        items: report.items.filter(isCollection),
        mailStatus: "delivered",
      },
    ],
  };
  return client({ report, answers: answersFor(report, isCollection), rounds: [round] });
}

/** The re-import the task describes: the Equifax collection is gone and the Experian one has a new balance. */
const reimport = (daysAgo: number) =>
  raw(daysAgo, (r) => {
    r.bureaus.equifax!.tradelines = r.bureaus.equifax!.tradelines.filter((t) => t.creditor !== "Midland Credit Management");
    r.bureaus.experian!.tradelines[0]!.balance = 900;
  });

describe("report readers: the registry", () => {
  it("has the app's own format, the AI reader (simulated without an API key), and five providers waiting for a sample", () => {
    expect(REPORT_READERS.map((r) => [r.key, r.status])).toEqual([
      ["credalti_json", "ready"],
      ["ai_document", "simulated"],
      ["identityiq", "needs_sample"],
      ["smartcredit", "needs_sample"],
      ["myfreescorenow", "needs_sample"],
      ["myscoreiq", "needs_sample"],
      ["privacyguard", "needs_sample"],
    ]);
    for (const reader of REPORT_READERS) {
      expect(reader.label.length).toBeGreaterThan(3);
      expect(getReportReader(reader.key)).toBe(reader);
    }
    expect(getReportReader("equifax_direct")).toBeUndefined();
  });

  it.each(REPORT_READERS.filter((r) => r.status === "needs_sample").map((r) => [r.key, r] as const))(
    "%s refuses to read, whatever it is given, and says why in Spanish",
    (_key, reader) => {
      const sources = [
        "",
        "<html><body><table><tr><td>Capital One</td><td>$480</td></tr></table></body></html>",
        JSON.stringify(DEMO_RAW_REPORT),
        `Reporte de ${reader.label}: Equifax 561, Experian 574, TransUnion 558`,
      ];
      for (const source of sources) {
        let thrown: unknown;
        try {
          reader.read(source);
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toBeInstanceOf(ReportReadError);
        const message = (thrown as ReportReadError).problems.join(" ");
        expect(message).toContain(`Todavía no existe un lector para los reportes de ${reader.label}`);
        expect(message).toMatch(/hace falta un reporte real .* como muestra/);
      }
    },
  );

  it("contains no parser for a provider's pages: the placeholders hold nothing but their refusal", () => {
    const source = readFileSync("src/lib/reports/readers.ts", "utf8");
    const placeholders = source.slice(source.indexOf("function needsSample"), source.indexOf("export const REPORT_READERS"));
    // No DOM, no selectors, no field mapping: nothing that reads a provider's page.
    expect(placeholders).not.toMatch(/DOMParser|querySelector|<table|<td|cheerio|JSON\.parse|\.split\(|tradelines|creditor/);
    expect(placeholders).toMatch(/throw new ReportReadError/);
  });

  it("suggests a source from the text, and only when exactly one fits", () => {
    expect(suggestReader(JSON.stringify(DEMO_RAW_REPORT))?.key).toBe("credalti_json");
    expect(suggestReader('<a href="https://www.identityiq.com/help">Ayuda</a>')?.key).toBe("identityiq");
    expect(suggestReader("Visita SmartCredit.com para ver tu reporte")?.key).toBe("smartcredit");
    expect(suggestReader("un texto cualquiera")).toBeNull();
    expect(suggestReader("identityiq.com y myscoreiq.com")).toBeNull();
    // A page that names a provider is still not something that provider's reader can read.
    expect(() => getReportReader("identityiq")!.read("https://www.identityiq.com")).toThrow(ReportReadError);
  });

  it("accepts sources up to 5 MB", () => {
    expect(MAX_SOURCE_BYTES).toBe(5 * 1024 * 1024);
  });
});

describe("report readers: the Credalti JSON format", () => {
  it("reads a valid report into the app's own format", () => {
    const read = credalti.read(JSON.stringify(DEMO_RAW_REPORT));
    expect(read.pulledAt).toBe("2026-07-01T00:00:00.000Z");
    const report = parseReport(read);
    expect(report.items).toHaveLength(8);
    expect(report.scores).toEqual({ equifax: 561, experian: 574, transunion: 558 });
    expect(parseReport(read)).toEqual(parseReport(DEMO_RAW_REPORT));
  });

  it("reads the downloadable template, which is the demo report dated today", () => {
    const text = templateJson(NOW);
    const read = credalti.read(text);
    expect(read.pulledAt).toBe(AT);
    expect(parseReport(read).items.map((i) => i.fingerprint)).toEqual(parseReport(DEMO_RAW_REPORT).items.map((i) => i.fingerprint));
    expect(templateReport(NOW).bureaus).toEqual(DEMO_RAW_REPORT.bureaus);
    // The demo report itself is not changed by making a template from it.
    expect(DEMO_RAW_REPORT.pulledAt).toBe("2026-07-01T00:00:00.000Z");
  });

  it("says what is wrong with text that is not JSON", () => {
    expect(problems("")).toEqual(["No hay nada que leer. Pega el texto del reporte o elige un archivo."]);
    expect(problems("   \n ")).toHaveLength(1);

    // A comma missing at the end of line 2: the parser stops at the start of line 3.
    const broken = problems('{\n  "source": "x"\n  "pulledAt": "2026-11-01"\n}');
    expect(broken).toHaveLength(1);
    expect(broken[0]).toMatch(/^El texto no es JSON válido: hay un error cerca de la línea 3, columna \d+\./);
    expect(broken[0]).toContain("plantilla");
    // Where the parser gives no place, the message still says what to look for.
    expect(problems('{ "source": }')[0]).toMatch(/^El texto no es JSON válido.*una coma, una llave o unas comillas/);

    const html = problems("<!doctype html><html><body>Mi reporte</body></html>");
    expect(html[0]).toMatch(/parece una página web \(HTML\)/);
    expect(html[0]).toContain("elige ese proveedor");
  });

  it("names each missing or wrong field in plain Spanish", () => {
    expect(problems("{}")).toEqual([
      "Falta «source» (de dónde viene el reporte). Debe ser un texto entre comillas.",
      "Falta «pulledAt» (la fecha del reporte). Debe ser un texto entre comillas.",
      "Falta «bureaus» (las secciones de cada buró). Debe ser un objeto entre llaves { }.",
    ]);
    expect(problems("[1, 2]")).toEqual(["El archivo debe ser un objeto entre llaves { }."]);

    const wrong = problems(
      JSON.stringify({
        source: "x",
        pulledAt: "2026-11-01",
        bureaus: {
          equifax: { score: 900, tradelines: [{ balance: "480" }], inquiries: "ninguna" },
        },
      }),
    );
    expect(wrong).toContain("«bureaus.equifax.score» debe ser un puntaje entre 300 y 850.");
    expect(wrong).toContain("Falta «bureaus.equifax.tradelines[0].creditor». Debe ser un texto entre comillas.");
    expect(wrong).toContain("«bureaus.equifax.tradelines[0].balance» debe ser un número.");
    expect(wrong).toContain("«bureaus.equifax.inquiries» debe ser una lista entre corchetes [ ].");

    const bureau = problems(JSON.stringify({ source: "x", pulledAt: "2026-11-01", bureaus: { equifaxx: {} } }));
    expect(bureau[0]).toBe("«equifaxx» no es un buró que conozcamos. Los burós se escriben equifax, experian y transunion.");
  });

  it("refuses a report without a real date, without a bureau, or with the same entry twice", () => {
    const base = { source: "x", bureaus: { equifax: { tradelines: [{ creditor: "Capital One", accountNumberMasked: "****1234" }] } } };
    expect(problems(JSON.stringify({ ...base, pulledAt: "ayer" }))[0]).toMatch(/«pulledAt» no es una fecha: dice "ayer"/);
    expect(problems(JSON.stringify({ ...base, pulledAt: "2026-02-31" }))[0]).toMatch(/no es una fecha/);
    expect(problems(JSON.stringify({ source: "x", pulledAt: "2026-11-01", bureaus: {} }))).toEqual([
      "El reporte no trae ningún buró. Hace falta al menos una sección: equifax, experian o transunion.",
    ]);
    const twice = structuredClone(base) as typeof base;
    twice.bureaus.equifax.tradelines.push({ creditor: "Capital One", accountNumberMasked: "****1234" });
    expect(problems(JSON.stringify({ ...twice, pulledAt: "2026-11-01" }))).toEqual([
      "«Capital One» aparece dos veces en Equifax. Deja una sola entrada.",
    ]);
  });

  it("reads a date without a time as that calendar day in the United States", () => {
    const read = credalti.read(JSON.stringify({ ...DEMO_RAW_REPORT, pulledAt: "2026-11-21" }));
    expect(read.pulledAt).toBe("2026-11-21T12:00:00.000Z");
    expect(new Date(read.pulledAt).toLocaleDateString("en-CA", { timeZone: "America/Chicago" })).toBe("2026-11-21");
    expect(new Date(read.pulledAt).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })).toBe("2026-11-21");
  });

  it("tells the app's own format from anything else", () => {
    expect(credalti.detect(JSON.stringify(DEMO_RAW_REPORT))).toBe(true);
    expect(credalti.detect('{"hello": "world"}')).toBe(false);
    expect(credalti.detect("<html></html>")).toBe(false);
  });
});

describe("report import: a first report", () => {
  const waiting = client();

  it("previews what the report holds before anything is saved", () => {
    const preview = importPreview(waiting, raw(0), AT);
    expect(preview.blocked).toBeNull();
    expect(preview.reportDate).toBe(AT);
    expect(preview.ageDays).toBe(0);
    expect(preview.total).toBe(8);
    expect(preview.negative).toBe(4);
    expect(preview.byCategory).toEqual({ tradeline: 3, inquiry: 2, public_record: 0, personal_info: 3 });
    expect(preview.bureaus).toEqual([
      { bureau: "equifax", score: 561, total: 5, negative: 2, byCategory: { tradeline: 2, inquiry: 1, public_record: 0, personal_info: 2 } },
      { bureau: "experian", score: 574, total: 2, negative: 1, byCategory: { tradeline: 1, inquiry: 0, public_record: 0, personal_info: 1 } },
      { bureau: "transunion", score: 558, total: 1, negative: 1, byCategory: { tradeline: 0, inquiry: 1, public_record: 0, personal_info: 0 } },
    ]);
    expect(preview.comparison).toBeNull();
    expect(preview.effects).toEqual(["Es su primer reporte: los 8 puntos quedan pendientes de la revisión del cliente."]);
    expect(preview.after).toMatchObject({ stageBefore: "report_pending", stageAfter: "client_review_pending" });
    expect(preview.after!.next).toMatchObject({ actor: "client", text: "Terminar su revisión (faltan 8 de 8)" });
    // Looking changed nothing.
    expect(waiting.report).toBeNull();
  });

  it("saving it gives the client a report, every item pending, and moves the stage on", () => {
    const after = mergeReport(waiting, raw(0), META);
    expect(after.report!.items).toHaveLength(8);
    expect(after.report!.pulledAt).toBe(AT);
    expect(after.answers).toEqual({});
    expect(clientStage(waiting, NOW)).toBe("report_pending");
    expect(clientStage(after, NOW)).toBe("client_review_pending");
    expect(nextStep(after, NOW)).toMatchObject({ actor: "client", text: "Terminar su revisión (faltan 8 de 8)" });
    expect(after.reportImports).toEqual([
      {
        at: AT, by: "ana", readerKey: "credalti_json", reportDate: AT, itemCount: 8, removed: 0, added: 0, changed: 0, closedRound: null,
        // The re-import facts (reports/reimport.ts): none on a first report.
        source: "demo", skippedPersonalInfo: 0, reappeared: 0, personalInfo: [],
      },
    ]);
    // A new object: the record passed in is untouched.
    expect(waiting.report).toBeNull();
    expect(waiting.reportImports).toBeUndefined();
  });

  it("adds one line to the client's history, and not a second one for the same report", () => {
    const after = mergeReport(waiting, raw(0), META);
    const lines = clientTimeline(after, NOW).map((e) => e.text);
    expect(lines).toContain("Ana importó un reporte con fecha del 5 de diciembre de 2026 (8 puntos)");
    expect(lines.filter((line) => /import/i.test(line))).toHaveLength(1);
    // A teammate who has not given a name signs as "equipo".
    const unnamed = mergeReport(waiting, raw(0), { ...META, by: "equipo" });
    expect(clientTimeline(unnamed, NOW)[0]!.text).toBe("El equipo importó un reporte con fecha del 5 de diciembre de 2026 (8 puntos)");
  });

  it("warns about a report too old to send letters on, and saving it raises that notice", () => {
    const preview = importPreview(waiting, raw(FRESH_REPORT_DAYS + 15), AT);
    expect(preview.blocked).toBeNull();
    expect(preview.ageDays).toBe(FRESH_REPORT_DAYS + 15);
    expect(preview.notes.join(" ")).toMatch(/tiene 60 días.*más de 45 días no se envían cartas/);
    const after = mergeReport(waiting, raw(FRESH_REPORT_DAYS + 15), META);
    expect(clientExceptions(after, NOW).map((e) => e.kind)).toContain("report_stale");
  });

  it("does not save a report dated in the future, and treats a few hours ahead as now", () => {
    const future = importPreview(waiting, raw(-3), AT);
    expect(future.blocked).toMatch(/está en el futuro/);
    expect(future.after).toBeNull();
    expect(() => mergeReport(waiting, raw(-3), META)).toThrow(/está en el futuro/);
    // Noon UTC of today, read from a date without a time, can be hours ahead of the team's clock.
    expect(planImport(waiting, raw(-0.25), AT)).toMatchObject({ blocked: null, report: { pulledAt: AT } });
  });
});

describe("report import: a new report over an old one", () => {
  it("shows what changed: one negative item gone, one balance different, nothing new", () => {
    const before = mailedClient(12);
    const preview = importPreview(before, reimport(0), AT);
    const comparison = preview.comparison!;

    expect(comparison.previousDate).toBe(ago(16));
    expect(comparison.removed.map((r) => [r.item.bureau, r.item.name, r.inRound])).toEqual([["equifax", "Midland Credit Management", 1]]);
    expect(comparison.added).toEqual([]);
    expect(comparison.changed.map((c) => [c.item.bureau, c.item.name])).toEqual([["experian", "Midland Credit Management"]]);
    expect(comparison.changed[0]!.differences).toEqual(["Saldo: $1,250 → $900"]);
    expect(comparison.unchanged).toBe(6);
    expect(comparison.removedNegative).toBe(1);
    expect(comparison.remainingNegative).toBe(3);
    expect(comparison.scores).toEqual([]);
    expect(preview.total).toBe(7);
    expect(preview.negative).toBe(3);
  });

  it("keeps the client's answers, matched by fingerprint, and never writes one", () => {
    const before = mailedClient(12);
    const answersBefore = structuredClone(before.answers);
    const after = mergeReport(before, reimport(0), META);

    // Every item still on the report carries exactly the answer the client gave.
    for (const item of after.report!.items) {
      expect(after.answers[item.fingerprint]).toEqual(answersBefore[item.fingerprint]);
    }
    const changed = after.report!.items.find((i) => i.bureau === "experian" && isCollection(i))!;
    expect(changed.data.balance).toBe(900);
    expect(after.answers[changed.fingerprint]).toMatchObject({ status: "inaccurate", reasonCode: "not_mine" });
    // Nothing was added, removed or edited in the answers.
    expect(after.answers).toEqual(answersBefore);
    expect(before.answers).toEqual(answersBefore);
    expect(importPreview(before, reimport(0), AT).effects[0]).toBe(
      "Las respuestas del cliente se conservan: 7 puntos siguen en el reporte con la respuesta que ya dio.",
    );
  });

  it("leaves a new item without an answer: it waits for the client's review", () => {
    const before = mailedClient(12);
    const withNew = raw(0, (r) => {
      r.bureaus.transunion!.inquiries.push({ inquirer: "Example Wireless", date: "2026-11-20", type: "hard" });
    });
    const preview = importPreview(before, withNew, AT);
    expect(preview.comparison!.added.map((i) => i.name)).toEqual(["Example Wireless"]);
    expect(preview.effects).toContain(
      "1 punto nuevo queda pendiente de la revisión del cliente. Solo el cliente puede responder.",
    );
    const after = mergeReport(before, withNew, META);
    const added = after.report!.items.find((i) => i.name === "Example Wireless")!;
    expect(after.answers[added.fingerprint]).toBeUndefined();
  });

  it("before the response window ends: the item that disappeared is recorded on the open round, which stays open", () => {
    const before = mailedClient(12);
    const preview = importPreview(before, reimport(0), AT);
    expect(preview.effects).toContain(
      "La ronda 1 sigue abierta: los burós tienen hasta el 23 de diciembre para responder. Queda anotado en la ronda que 1 punto ya no aparece.",
    );
    expect(preview.after).toMatchObject({ stageBefore: "waiting_on_bureaus", stageAfter: "waiting_on_bureaus" });

    const after = mergeReport(before, reimport(0), META);
    const round = after.rounds[0]!;
    const gone = before.report!.items.find((i) => i.bureau === "equifax" && isCollection(i))!;
    expect(round.results).toEqual([{ fingerprint: gone.fingerprint, outcome: "removed", reportDate: AT }]);
    expect(round.status).toBe("mailed");
    expect(round.respondedAt).toBeNull();
    expect(clientStage(after, NOW)).toBe("waiting_on_bureaus");
    expect(nextStep(after, NOW).text).toBe("Re-importar el reporte el 23 de diciembre");
    expect(after.reportImports![0]).toMatchObject({ removed: 1, added: 0, changed: 1, closedRound: null });
    // The letter still shows what was mailed.
    expect(round.letters[0]!.items).toHaveLength(2);
  });

  it(`after the ${RESPONSE_WINDOW_DAYS}-day window: the report closes the round, and the stage, notices and next step follow`, () => {
    const before = mailedClient(35, 40);
    expect(clientStage(before, NOW)).toBe("waiting_on_bureaus");
    expect(clientExceptions(before, NOW).map((e) => e.kind)).toEqual(["response_overdue"]);
    expect(nextStep(before, NOW)).toMatchObject({ actor: "client" });

    const preview = importPreview(before, reimport(0), AT);
    expect(preview.effects).toContain(
      "Trae las respuestas a la ronda 1: la ronda queda «Con respuesta». 1 punto de esa ronda ya no aparece en el reporte.",
    );
    expect(preview.after).toMatchObject({ stageBefore: "waiting_on_bureaus", stageAfter: "results_in" });

    const after = mergeReport(before, reimport(0), META);
    expect(after.rounds[0]).toMatchObject({ status: "responded", respondedAt: AT });
    expect(after.rounds[0]!.results).toHaveLength(1);
    expect(clientStage(after, NOW)).toBe("results_in");
    expect(clientExceptions(after, NOW)).toEqual([]);
    expect(nextStep(after, NOW)).toMatchObject({ actor: "system", text: "Preparar las cartas de la ronda 2 el 10 de diciembre" });
    expect(after.reportImports![0]!.closedRound).toBe(1);

    const lines = clientTimeline(after, NOW).map((e) => e.text);
    expect(lines).toContain(
      "Ana importó el reporte nuevo, con las respuestas a la ronda 1 (7 puntos): 1 punto ya no aparece, 1 punto cambió",
    );
    // Told once: not also as the system's line for the same report.
    expect(lines).not.toContain("Se importó el reporte nuevo, con las respuestas a la ronda 1");
  });

  it("does not record the same result twice when a later report is imported", () => {
    const first = mergeReport(mailedClient(12), reimport(1), { ...META, at: ago(1) });
    const second = mergeReport(first, reimport(0), META);
    expect(second.rounds[0]!.results).toHaveLength(1);
    expect(second.reportImports).toHaveLength(2);
  });

  it("an item that disappeared without being disputed is not a result of the round", () => {
    const before = mailedClient(12);
    const noInquiry = raw(0, (r) => {
      r.bureaus.transunion!.inquiries = [];
    });
    const preview = importPreview(before, noInquiry, AT);
    expect(preview.comparison!.removed.map((r) => [r.item.name, r.inRound])).toEqual([["Retail Card Services", null]]);
    expect(mergeReport(before, noInquiry, META).rounds[0]!.results).toBeUndefined();
  });

  it("a report from before the letters went out says nothing about the round", () => {
    const before = mailedClient(12, 20);
    const preview = importPreview(before, reimport(14), AT);
    expect(preview.notes.join(" ")).toMatch(/anterior al envío de la ronda 1/);
    const after = mergeReport(before, reimport(14), META);
    expect(after.rounds[0]!.results).toBeUndefined();
    expect(after.rounds[0]!.status).toBe("mailed");
  });

  it("refuses a report older than the one on file", () => {
    const before = mailedClient(12, 4);
    const preview = importPreview(before, raw(9), AT);
    expect(preview.blocked).toMatch(/más antiguo que el que ya está en archivo/);
    expect(preview.effects).toEqual([]);
    expect(() => mergeReport(before, raw(9), META)).toThrow(/más antiguo/);
  });

  it("refuses a report that leaves out a bureau the one on file has: its items would look removed", () => {
    const before = mailedClient(12);
    const partial = raw(0, (r) => {
      delete r.bureaus.experian;
    });
    const preview = importPreview(before, partial, AT);
    expect(preview.blocked).toMatch(/no trae Experian y el reporte en archivo sí/);
    expect(preview.blocked).toMatch(/2 puntos de Experian desaparecieron/);
    expect(() => mergeReport(before, partial, META)).toThrow(/no trae Experian/);
    // An empty section is different: that bureau reported, and reported nothing.
    const emptied = raw(0, (r) => {
      r.bureaus.experian = { tradelines: [], inquiries: [], publicRecords: [], personalInfo: [] };
    });
    expect(importPreview(before, emptied, AT).blocked).toBeNull();
  });

  it("sends a prepared, unsent round back to preparation when the report changes what its letters cover", () => {
    const ready = mailedClient(12);
    ready.rounds = [{ ...ready.rounds[0]!, status: "ready", mailedAt: null, letters: ready.rounds[0]!.letters.map((l) => ({ ...l, mailStatus: "not_sent" as const })) }];
    expect(sendableRound(ready, NOW)?.number).toBe(1);

    const preview = importPreview(ready, reimport(0), AT);
    expect(preview.effects.join(" ")).toMatch(/La ronda 1 estaba lista .* Vuelve a «En preparación»/);
    const after = mergeReport(ready, reimport(0), META);
    expect(after.rounds[0]!.status).toBe("draft");
    expect(sendableRound(after, NOW)).toBeNull();
    expect(after.rounds[0]!.results).toBeUndefined();

    // A report that leaves those items as they were leaves the round ready.
    const same = mergeReport(ready, raw(0), META);
    expect(same.rounds[0]!.status).toBe("ready");
    expect(sendableRound(same, NOW)?.number).toBe(1);
  });

  it("writes a report on file back in the app's own format, so it can be edited and imported again", () => {
    const report = parseReport(raw(3));
    expect(parseReport(toRawReport(report))).toEqual(report);
    expect(parseReport(credalti.read(JSON.stringify(toRawReport(report))))).toEqual(report);
  });

  it("promises nothing in what it tells staff", () => {
    const texts = [
      ...importPreview(client(), raw(0), AT).effects,
      ...importPreview(mailedClient(12), reimport(0), AT).effects,
      ...importPreview(mailedClient(35, 40), reimport(0), AT).effects,
      ...importPreview(client(), raw(60), AT).notes,
    ];
    expect(texts.length).toBeGreaterThan(4);
    for (const text of texts) expect(checkClaimGuardrails(text)).toEqual([]);
  });
});

describe("report import: the staff data layer (demo)", () => {
  const clients = buildDemoClients(NOW);
  const later = new Date(NOW.getTime() + 5 * 60 * 1000);
  const find = (list: StaffClient[], id: string) => list.find((c) => c.id === id)!;
  const withActions = (actions: Partial<DemoActions>) => applyDemoActions(clients, { ...EMPTY_ACTIONS, ...actions });

  it("an imported report moves a client who was waiting for one into review", () => {
    const waiting = clients.find((c) => clientStage(c, later) === "report_pending")!;
    const imported = { at: later.toISOString(), by: "ana", readerKey: "credalti_json", report: templateReport(later) };
    const after = find(withActions({ imports: { [waiting.id]: [imported] } }), waiting.id);
    expect(after.report!.items).toHaveLength(8);
    expect(clientStage(after, later)).toBe("client_review_pending");
    expect(after.reportImports).toHaveLength(1);
    // Everyone else is as they were.
    expect(withActions({ imports: { [waiting.id]: [imported] } }).filter((c) => c.id !== waiting.id)).toEqual(
      clients.filter((c) => c.id !== waiting.id),
    );
  });

  it("an imported report closes the round of the client whose answers were overdue", () => {
    const overdue = clients.find((c) => clientExceptions(c, later).some((e) => e.kind === "response_overdue"))!;
    const report = toRawReport(overdue.report!);
    report.pulledAt = later.toISOString();
    report.bureaus.equifax!.personalInfo = report.bureaus.equifax!.personalInfo.filter((p) => p.field !== "address");
    const after = find(withActions({ imports: { [overdue.id]: [{ at: later.toISOString(), by: "ana", readerKey: "credalti_json", report }] } }), overdue.id);
    expect(after.rounds[0]).toMatchObject({ status: "responded", respondedAt: later.toISOString() });
    expect(after.rounds[0]!.results).toHaveLength(1);
    expect(clientStage(after, later)).toBe("results_in");
    expect(clientExceptions(after, later).map((e) => e.kind)).not.toContain("response_overdue");
    expect(after.answers).toEqual(overdue.answers);
  });

  it("a round sent after a report was imported is not answered by that report", () => {
    const ready = clients.find((c) => sendableRound(c, later))!;
    const number = sendableRound(ready, later)!.number;
    const importedAt = later.toISOString();
    const sentAt = new Date(later.getTime() + 60 * 1000).toISOString();
    const report = toRawReport(ready.report!);
    report.pulledAt = importedAt;
    const after = find(
      withActions({
        imports: { [ready.id]: [{ at: importedAt, by: "ana", readerKey: "credalti_json", report }] },
        sent: { [ready.id]: { [String(number)]: sentAt } },
      }),
      ready.id,
    );
    const round = after.rounds.find((r) => r.number === number)!;
    expect(round.status).toBe("mailed");
    expect(round.results).toBeUndefined();
  });

  it("a saved sample is kept as it came and changes nothing else about the client", () => {
    const waiting = clients.find((c) => clientStage(c, later) === "report_pending")!;
    const sample = { id: "s1", provider: "identityiq", savedAt: later.toISOString(), savedBy: "ana", fileName: "reporte.html", text: "<html>…</html>" };
    const after = find(withActions({ samples: { [waiting.id]: [sample] } }), waiting.id);
    expect(after.reportSamples).toEqual([sample]);
    expect(after.report).toBeNull();
    expect(clientStage(after, later)).toBe(clientStage(waiting, later));
    expect(clientExceptions(after, later)).toEqual(clientExceptions(waiting, later));
    expect(nextStep(after, later)).toEqual(nextStep(waiting, later));
    expect(clientTimeline(after, later).map((e) => e.text)).toContain(
      "Ana guardó una muestra de reporte de IdentityIQ. Todavía no hay lector para leerla",
    );
  });

  it("the import screen offers a sample only on request and says the stage does not change", () => {
    const screen = readFileSync("src/components/staff/ReportImport.tsx", "utf8");
    expect(screen).toContain("Guardar como muestra");
    expect(screen.replace(/\s+/g, " ")).toContain("la etapa del cliente no cambia hasta que exista un lector");
    // The only call that stores a sample is the button's own handler.
    expect(screen.match(/saveReportSample\(/g)).toHaveLength(1);
    expect(screen).toMatch(/onClick=\{saveSample\}/);
    expect(screen.match(/saveSample\b/g)).toHaveLength(2);
  });
});
