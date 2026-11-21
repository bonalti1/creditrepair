import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkClaimGuardrails } from "@/lib/compliance/guardrails";
import { DISPUTE_REASONS } from "@/lib/letters/reasons";
import { applyDemoActions, EMPTY_ACTIONS, type DemoActions, type RoundRef } from "@/lib/staff/data";
import { buildDemoClients } from "@/lib/staff/demoClients";
import { staffLetterText } from "@/lib/staff/letters";
import {
  buildPrintBatch,
  parseRoundRefs,
  roundRefsHref,
  roundRefsParam,
  slipLine,
  slipNames,
  splitLetterText,
  totalPages,
} from "@/lib/staff/printBatch";
import { sendableRound } from "@/lib/staff/stage";
import { fullName } from "@/lib/staff/types";

// Printing a batch of letters locally (/equipo/imprimir): which rounds a link
// names, which are printed, the order of the pages and the counts on screen.

const NOW = new Date("2026-12-05T18:00:00.000Z");
const clients = buildDemoClients(NOW);
const later = new Date(NOW.getTime() + 5 * 60 * 1000);
const ready: RoundRef[] = clients.flatMap((c) => {
  const round = sendableRound(c, later);
  return round ? [{ clientId: c.id, roundNumber: round.number }] : [];
});

describe("print view: which rounds a link names", () => {
  it("reads client:round pairs, in order, each once, and ignores anything else", () => {
    expect(parseRoundRefs("c07:1,c08:1,c14:2")).toEqual([
      { clientId: "c07", roundNumber: 1 },
      { clientId: "c08", roundNumber: 1 },
      { clientId: "c14", roundNumber: 2 },
    ]);
    expect(parseRoundRefs(" c07:1 , c07:1 ,c07:2")).toEqual([
      { clientId: "c07", roundNumber: 1 },
      { clientId: "c07", roundNumber: 2 },
    ]);
    for (const junk of [null, undefined, "", ",", "c07", "c07:", "c07:0", "c07:-1", "c07:x", "c07:100", "../etc:1", "<b>:1", ":1"]) {
      expect(parseRoundRefs(junk)).toEqual([]);
    }
    // A database id (a UUID) is a valid client id.
    expect(parseRoundRefs("3f2b6c1e-8a44-4d0e-9a51-0c9d2f6f1a77:3")).toEqual([
      { clientId: "3f2b6c1e-8a44-4d0e-9a51-0c9d2f6f1a77", roundNumber: 3 },
    ]);
  });

  it("writes the link the staff home and the client page use, and reads it back", () => {
    expect(roundRefsParam(ready)).toBe("c07:1,c08:1,c14:2");
    const href = roundRefsHref(ready);
    expect(href).toBe("/equipo/imprimir?rondas=c07%3A1%2Cc08%3A1%2Cc14%3A2");
    expect(parseRoundRefs(new URL(href, "https://example.test").searchParams.get("rondas"))).toEqual(ready);
    const home = readFileSync("src/app/equipo/page.tsx", "utf8");
    expect(home).toContain("roundRefsHref(chosen.map(");
    expect(home).toMatch(/Imprimir \{count\(chosen\.length, "ronda", "rondas"\)\}/);
    const client = readFileSync("src/app/equipo/clientes/[id]/page.tsx", "utf8");
    expect(client).toContain("roundRefsHref([{ clientId: client.id, roundNumber: r.number }])");
    expect(client).toContain("Imprimir esta ronda");
  });
});

describe("print view: the batch", () => {
  const batch = buildPrintBatch(clients, ready, later);

  it("the three rounds that are ready to send are a batch of thirteen letters", () => {
    expect(ready).toHaveLength(3);
    expect(batch.skipped).toEqual([]);
    expect(batch.rounds.map((r) => [r.client.id, r.round.number, r.letters.length])).toEqual([
      ["c07", 1, 2],
      ["c08", 1, 3],
      ["c14", 2, 8],
    ]);
    expect(batch.counts).toEqual({ rounds: 3, clients: 3, letters: 13, slips: 13, pagesAtLeast: 27 });
    expect(batch.toMark).toEqual(ready);
    expect(batch.rounds.every((r) => !r.alreadySent)).toBe(true);
  });

  it("prints every letter of each round, in the round's order, and no other letter", () => {
    const expected = batch.rounds.flatMap((r) => r.round.letters.map((l) => l.id));
    expect(batch.letters.map((l) => l.id)).toEqual(expected);
    expect(new Set(batch.letters.map((l) => l.id)).size).toBe(13);
    // Grouped by client, in the order requested.
    expect([...new Set(batch.letters.map((l) => l.clientId))]).toEqual(["c07", "c08", "c14"]);
    const reversed = buildPrintBatch(clients, [...ready].reverse(), later);
    expect([...new Set(reversed.letters.map((l) => l.clientId))]).toEqual(["c14", "c08", "c07"]);
    expect(reversed.counts).toEqual(batch.counts);
  });

  it("each page is the letter the console shows for that round: same text, reasons included", () => {
    for (const { client, round, letters } of batch.rounds) {
      round.letters.forEach((letter, index) => {
        const printed = letters[index]!;
        expect(printed.text).toBe(staffLetterText(client, round, letter, later));
        expect(printed.clientName).toBe(fullName(client));
        expect(printed.recipient).toBe(letter.recipient);
        expect(printed.roundNumber).toBe(round.number);
      });
    }
    const withItems = batch.letters.filter((l) => /\): |^- (Address|Name|Employer): /m.test(l.text));
    expect(withItems.length).toBeGreaterThan(5);
    const sentences = DISPUTE_REASONS.map((r) => r.sentence);
    for (const letter of withItems) expect(sentences.some((s) => letter.text.includes(s)), letter.id).toBe(true);
  });

  it("a slip follows each letter that has enclosures, and only those", () => {
    for (const letter of batch.letters) expect(letter.enclosures).toEqual(["government_id", "proof_of_address"]);
    expect(slipLine(batch.letters[0]!.enclosures)).toBe("Adjuntar: copia de identificación, comprobante de domicilio");
    expect(slipNames(["ssn_card", "identity_theft_report"])).toEqual([
      "copia de la tarjeta de Seguro Social",
      "reporte de robo de identidad de la FTC",
    ]);
    // A client with no documents on file: letters, and no slips.
    const bare = clients.map((c) => (c.id === "c07" ? { ...c, documents: [] } : c));
    const none = buildPrintBatch(bare, [{ clientId: "c07", roundNumber: 1 }], later);
    // (Without documents the client is no longer ready to send, so the round is not printed at all.)
    expect(none.counts.letters).toBe(0);
    const sent = applyDemoActions(bare, { ...EMPTY_ACTIONS, sent: { c07: { "1": later.toISOString() } } });
    const copy = buildPrintBatch(sent, [{ clientId: "c07", roundNumber: 1 }], later);
    expect(copy.counts).toEqual({ rounds: 1, clients: 1, letters: 2, slips: 0, pagesAtLeast: 3 });
    expect(copy.letters.every((l) => l.enclosures.length === 0 && !l.text.includes("Enclosures:"))).toBe(true);
  });

  it("counts one client once, however many of their rounds are in the batch", () => {
    const sent = applyDemoActions(clients, { ...EMPTY_ACTIONS, sent: { c14: { "2": later.toISOString() } } });
    const both = buildPrintBatch(sent, [{ clientId: "c14", roundNumber: 1 }, { clientId: "c14", roundNumber: 2 }], later);
    expect(both.counts.rounds).toBe(2);
    expect(both.counts.clients).toBe(1);
    expect(both.counts.letters).toBe(both.rounds[0]!.letters.length + both.rounds[1]!.letters.length);
    expect(both.counts.pagesAtLeast).toBe(1 + both.counts.letters + both.counts.slips);
  });

  it("leaves out a round that may not go out, and says why", () => {
    const mixed = buildPrintBatch(
      clients,
      [
        { clientId: "c09", roundNumber: 1 }, // prepared, but the report is too old to send on
        { clientId: "c07", roundNumber: 1 },
        { clientId: "c07", roundNumber: 4 }, // no such round
        { clientId: "nobody", roundNumber: 1 },
        { clientId: "c05", roundNumber: 1 }, // still reviewing: no round yet
      ],
      later,
    );
    expect(mixed.rounds.map((r) => r.client.id)).toEqual(["c07"]);
    expect(mixed.counts).toEqual({ rounds: 1, clients: 1, letters: 2, slips: 2, pagesAtLeast: 5 });
    expect(mixed.skipped.map((s) => [s.ref.clientId, s.ref.roundNumber, s.clientName])).toEqual([
      ["c09", 1, "Ramiro Escobedo"],
      ["c07", 4, "Anselmo Quiroga"],
      ["nobody", 1, null],
      ["c05", 1, "Fidel Carranza"],
    ]);
    expect(mixed.skipped[0]!.reason).toMatch(/El reporte tiene más de \d+ días/);
    expect(mixed.skipped[1]!.reason).toBe("No tiene una ronda 4.");
    expect(mixed.skipped[2]!.reason).toBe("No encontramos a este cliente.");
    for (const s of mixed.skipped) expect(checkClaimGuardrails(s.reason)).toEqual([]);
    // A round still in preparation is not printed either.
    const draft = clients.map((c) => (c.id === "c07" ? { ...c, rounds: [{ ...c.rounds[0]!, status: "draft" as const }] } : c));
    expect(buildPrintBatch(draft, [{ clientId: "c07", roundNumber: 1 }], later).skipped[0]!.reason).toBe(
      "La ronda todavía está en preparación.",
    );
  });

  it("an empty or unknown selection is an empty batch, with no pages", () => {
    expect(buildPrintBatch(clients, [], later).counts).toEqual({ rounds: 0, clients: 0, letters: 0, slips: 0, pagesAtLeast: 0 });
    const unknown = buildPrintBatch(clients, [{ clientId: "zz", roundNumber: 1 }], later);
    expect(unknown.counts.pagesAtLeast).toBe(0);
    expect(unknown.toMark).toEqual([]);
  });

  it("marking as sent goes through the data layer's markRoundsSent; afterwards the batch is a copy with nothing left to mark", () => {
    const actions: DemoActions = structuredClone(EMPTY_ACTIONS);
    for (const ref of batch.toMark) actions.sent[ref.clientId] = { [String(ref.roundNumber)]: later.toISOString() };
    const after = buildPrintBatch(applyDemoActions(clients, actions), ready, later);
    expect(after.counts).toEqual(batch.counts);
    expect(after.toMark).toEqual([]);
    expect(after.rounds.every((r) => r.alreadySent && r.round.status === "mailed")).toBe(true);
    // The printed letters keep the date they were marked as mailed.
    expect(after.letters[0]!.text).toContain("December 5, 2026");
    const page = readFileSync("src/app/equipo/imprimir/page.tsx", "utf8");
    expect(page).toContain("data.markRoundsSent(toMark, { via: \"print\" })");
    expect(page).toContain("window.print()");
  });

  it("totals the pages: the cover, each letter's pages and the slips", () => {
    expect(totalPages(1, Array(13).fill(1), 13)).toBe(27);
    expect(totalPages(1, [1, 2, 1], 3)).toBe(8);
    expect(totalPages(2, [1], 0)).toBe(3);
    // A letter is never fewer than one page.
    expect(totalPages(1, [0, 1], 2)).toBe(5);
  });
});

describe("print view: a letter split for the page", () => {
  const batch = buildPrintBatch(clients, ready, later);

  it("separates the sender, the date and the recipient that shows in the envelope window", () => {
    const letter = batch.letters[0]!;
    expect(letter.parts).not.toBeNull();
    expect(letter.parts!.sender).toEqual(["Anselmo Quiroga", "291 Calle Ejemplo", "San Antonio, TX 78205"]);
    expect(letter.parts!.date).toBe("December 5, 2026");
    expect(letter.parts!.recipient).toEqual(["Equifax Information Services LLC", "P.O. Box 740256", "Atlanta, GA 30374-0256"]);
    expect(letter.parts!.body.startsWith("Re: Request to update personal information on my credit file")).toBe(true);
    expect(letter.parts!.closing).toEqual({ valediction: "Sincerely,", name: "Anselmo Quiroga" });
    expect(letter.parts!.after).toBe(
      "Enclosures:\n- Copy of government-issued photo ID\n- Proof of address (utility bill / bank statement)",
    );
  });

  it("every letter of the batch splits, the recipient block is the letter's recipient, and no word is lost or added", () => {
    for (const letter of batch.letters) {
      const parts = letter.parts!;
      expect(parts, letter.id).not.toBeNull();
      expect(parts.recipient).toEqual([letter.recipient.name, ...letter.recipient.addressLines]);
      // At most four lines: what fits in a #10 window.
      expect(parts.recipient.length).toBeLessThanOrEqual(4);
      const rebuilt = [
        ...parts.sender,
        parts.date,
        ...parts.recipient,
        parts.body,
        parts.closing?.valediction ?? "",
        parts.closing?.name ?? "",
        parts.after,
      ].join("\n");
      const words = (text: string) => text.split(/\s+/).filter(Boolean);
      expect(words(rebuilt), letter.id).toEqual(words(letter.text));
    }
  });

  it("a text without the usual header is not split (the page prints it as it is)", () => {
    expect(splitLetterText("Hello\n\nNo header here.")).toBeNull();
    expect(splitLetterText("Name\nStreet\n\nRe: something\n\nBody")).toBeNull();
    const noClosing = splitLetterText("Name\nStreet\n\nJuly 2, 2026\n\nBureau\nBox 1\nRe: something\n\nBody");
    expect(noClosing).toEqual({ sender: ["Name", "Street"], date: "July 2, 2026", recipient: ["Bureau", "Box 1"], body: "Re: something\n\nBody", closing: null, after: "" });
  });
});

describe("print view: the page", () => {
  const page = readFileSync("src/app/equipo/imprimir/page.tsx", "utf8");

  it("is laid out for US Letter with print CSS and no library", () => {
    expect(page).toMatch(/@page \{ size: letter; margin: 0; \}/);
    expect(page).toMatch(/@media print \{/);
    expect(page).toMatch(/break-after: page/);
    expect(page).toMatch(/\.pl-screen \{ display: none !important; \}/);
    expect(page).not.toMatch(/jspdf|pdfkit|pdf-lib|react-pdf|html2canvas|puppeteer/i);
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies).sort()).toEqual(["@anthropic-ai/sdk", "@supabase/ssr", "@supabase/supabase-js", "next", "react", "react-dom", "zod"]);
  });

  it("hides the console's frame on paper", () => {
    const shell = readFileSync("src/components/staff/StaffShell.tsx", "utf8");
    expect(shell).toMatch(/<header className="[^"]*print:hidden/);
    expect(shell).toMatch(/<footer className="[^"]*print:hidden/);
  });

  it("asks before marking, naming how many rounds and clients; its copy promises nothing", () => {
    expect(page).toContain("¿Marcar {markSummary} como enviadas por correo?");
    expect(page).toContain('`${count(toMark.length, "ronda", "rondas")} de ${count(markClients, "cliente", "clientes")}`');
    expect(page).toContain("Marcar como enviadas por correo");
    const copy = [...page.matchAll(/>\s*([^<>{}]{25,})\s*</g)].map((m) => m[1]!.replace(/\s+/g, " ").trim());
    expect(copy.length).toBeGreaterThan(5);
    for (const line of copy) expect(checkClaimGuardrails(line), line).toEqual([]);
  });
});
