import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseReport } from "../domain/parser";
import type { ReportItem } from "../domain/types";
import { disputeAttempts, escalationOrder, median, MIN_SAMPLE, NO_ANSWER_AFTER_DAYS, NO_CHECK_KEY, outcomeTable, type DisputeAttempt } from "../staff/learning";
import { buildDemoClients } from "../staff/demoClients";
import type { StaffClient, StaffLetter, StaffRound } from "../staff/types";

// The internal learning loop on dispute outcomes (staff/learning.ts), and the
// rule that its numbers never reach a client or an ad.

const NOW = new Date("2026-11-22T18:00:00.000Z");

function items(bureau: "equifax" | "experian", accounts: Array<{ creditor: string; number: string; balance: number; status?: string; firstDelinquencyAt?: string }>, pulledAt: string): ReportItem[] {
  return parseReport({
    source: "t",
    pulledAt,
    bureaus: {
      [bureau]: {
        tradelines: accounts.map((a) => ({
          creditor: a.creditor,
          accountNumberMasked: a.number,
          accountType: "collection",
          status: a.status ?? "collection",
          balance: a.balance,
          openedAt: "2024-01-01",
          firstDelinquencyAt: a.firstDelinquencyAt ?? "2023-06-01",
          furnisher: { name: a.creditor, addressLines: ["x"] },
        })),
      },
    },
  }).items;
}

function letter(id: string, list: ReportItem[], reason = "not_mine", templateKey = "dispute_611_accounts", stage: StaffLetter["stage"] = "dispute"): StaffLetter {
  return {
    id,
    recipient: { type: "bureau", key: "equifax", name: "Equifax", addressLines: ["x"] },
    templateKey,
    category: "tradeline",
    stage,
    items: list,
    itemReasons: Object.fromEntries(list.map((i) => [i.fingerprint, reason])) as StaffLetter["itemReasons"],
    mailStatus: "delivered",
  };
}

function client(partial: Partial<StaffClient> & { id: string; rounds: StaffRound[] }): StaffClient {
  return { report: null, intake: [], reportImports: [], ...partial } as unknown as StaffClient;
}

// Client A: four accounts disputed in round 1, two again in round 2.
const r1Items = items("equifax", [
  { creditor: "Gone Co", number: "****0001", balance: 100 },
  { creditor: "Same Co", number: "****0002", balance: 200 },
  { creditor: "Changed Co", number: "****0003", balance: 300 },
  { creditor: "Quiet Co", number: "****0004", balance: 400 },
], "2025-12-20T00:00:00.000Z");
const [gone, same, changed, quiet] = r1Items as [ReportItem, ReportItem, ReportItem, ReportItem];
const changedLater: ReportItem = { ...changed, data: { ...changed.data, balance: 250 } };
const newest = { pulledAt: "2026-04-10T00:00:00.000Z", source: "t", items: [same, quiet], scores: {} };

const clientA = client({
  id: "a",
  report: newest,
  rounds: [
    { number: 1, status: "responded", mailedAt: "2026-01-01T00:00:00.000Z", respondedAt: "2026-02-05T00:00:00.000Z", letters: [letter("a1", r1Items)], results: [{ fingerprint: gone.fingerprint, outcome: "removed", reportDate: "2026-02-05T00:00:00.000Z" }] },
    { number: 2, status: "mailed", mailedAt: "2026-03-01T00:00:00.000Z", respondedAt: null, letters: [letter("a2", [same, changedLater], "wrong_balance", "mov_request", "mov")] },
  ],
});

// Client B: one round long ago with no answer but a bureau letter for one item, and one round still waiting.
const bItems = items("experian", [
  { creditor: "Letter Co", number: "****0101", balance: 50 },
  { creditor: "Silent Co", number: "****0102", balance: 60 },
], "2026-07-20T00:00:00.000Z");
const [letterItem, silent] = bItems as [ReportItem, ReportItem];
const fresh = items("experian", [{ creditor: "Fresh Co", number: "****0201", balance: 70 }], "2026-11-01T00:00:00.000Z");
const clientB = client({
  id: "b",
  intake: [
    {
      id: "i1",
      kind: "bureau_letter",
      at: "2026-08-25T00:00:00.000Z",
      status: "accepted",
      simulated: true,
      reasons: [],
      letter: { bureau: "experian", letterDate: "2026-08-20", items: [{ creditor: "Letter Co", account: "0101", outcome: "frivolous", fingerprint: letterItem.fingerprint, citation: null }] },
    },
  ],
  rounds: [
    { number: 2, status: "mailed", mailedAt: "2026-08-01T00:00:00.000Z", respondedAt: null, letters: [letter("b1", bItems, "never_late")] },
    { number: 3, status: "mailed", mailedAt: "2026-11-10T00:00:00.000Z", respondedAt: null, letters: [letter("b2", fresh, "never_late")] },
  ],
});

const attempts = disputeAttempts([clientA, clientB], NOW);
const result = (clientId: string, round: number, fp: string) => attempts.find((a) => a.clientId === clientId && a.round === round && a.fingerprint === fp)!;

describe("learning loop: what happened to each dispute", () => {
  it("one dispute per item per mailed letter, with its bureau, company, reason, letter and stage", () => {
    expect(attempts).toHaveLength(4 + 2 + 2 + 1);
    const a = result("a", 2, same.fingerprint);
    expect(a).toMatchObject({ bureau: "equifax", furnisher: "Same Co", reasonCode: "wrong_balance", templateKey: "mov_request", stage: "mov" });
  });

  it("deleted: recorded on the round, dated by the report that showed it", () => {
    expect(result("a", 1, gone.fingerprint)).toMatchObject({ result: "deleted", daysToResult: 35 });
  });

  it("verified or updated: disputed again by the next round, unchanged or changed", () => {
    expect(result("a", 1, same.fingerprint)).toMatchObject({ result: "verified", daysToResult: 35 });
    expect(result("a", 1, changed.fingerprint)).toMatchObject({ result: "updated" });
  });

  it("from the newest report when no later round says: still there after the window is verified; gone is deleted", () => {
    expect(result("a", 1, quiet.fingerprint)).toMatchObject({ result: "verified", daysToResult: 99 });
    expect(result("a", 2, changedLater.fingerprint)).toMatchObject({ result: "deleted", daysToResult: 40 });
    expect(result("a", 2, same.fingerprint)).toMatchObject({ result: "verified" });
  });

  it("a bureau letter read by intake gives the answer a report cannot show", () => {
    expect(result("b", 2, letterItem.fingerprint)).toMatchObject({ result: "other_answer", daysToResult: 19 });
  });

  it(`no answer after ${NO_ANSWER_AFTER_DAYS} days; waiting before`, () => {
    expect(result("b", 2, silent.fingerprint)).toMatchObject({ result: "no_answer", daysToResult: null });
    expect(result("b", 3, fresh[0]!.fingerprint)).toMatchObject({ result: "waiting", daysToResult: null });
  });

  it("records the data checks the item had when it was mailed", () => {
    // Client A's accounts are on one bureau with no oddities; none has a check.
    expect(attempts.filter((a) => a.clientId === "a").every((a) => a.checkKinds.length === 0)).toBe(true);
    const demo = disputeAttempts(buildDemoClients(NOW), NOW);
    expect(demo.some((a) => a.checkKinds.includes("balance_mismatch"))).toBe(true);
  });
});

describe("learning loop: the table", () => {
  it("counts per row, with the results on record and the median days", () => {
    const rows = outcomeTable(attempts, "bureau", 1);
    const equifax = rows.find((r) => r.key === "equifax")!;
    expect(equifax).toMatchObject({ sent: 6, deleted: 2, updated: 1, verified: 3, otherAnswer: 0, noAnswer: 0, waiting: 0, recorded: 6, enough: true });
    expect(equifax.medianDays).toBe(37.5);
    const experian = rows.find((r) => r.key === "experian")!;
    expect(experian).toMatchObject({ sent: 3, otherAnswer: 1, noAnswer: 1, waiting: 1, recorded: 1 });
  });

  it(`hides every result of a row with fewer than ${MIN_SAMPLE} disputes`, () => {
    expect(MIN_SAMPLE).toBe(10);
    expect(outcomeTable(attempts, "bureau").every((r) => r.enough === r.sent >= 10)).toBe(true);
    expect(outcomeTable(attempts, "bureau").some((r) => r.enough)).toBe(false);
  });

  it("groups by company, reason, letter and stage, and data check (with a no-check baseline)", () => {
    expect(outcomeTable(attempts, "reason", 1).map((r) => r.key).sort()).toEqual(["never_late", "not_mine", "wrong_balance"]);
    expect(outcomeTable(attempts, "template", 1).map((r) => r.key).sort()).toEqual(["dispute_611_accounts|dispute", "mov_request|mov"]);
    expect(outcomeTable(attempts, "check", 1).map((r) => r.key)).toEqual([NO_CHECK_KEY]);
    expect(outcomeTable(attempts, "furnisher", 1)[0]).toMatchObject({ sent: 2 });
  });

  it("median of nothing is null; of an even count, the middle two averaged", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2, 10])).toBe(2.5);
  });
});

describe("learning loop: an escalation order for later (not used by the round engine)", () => {
  const row = (key: string, sent: number, deleted: number, updated: number, verified: number) => ({ key, label: key, sent, deleted, updated, verified, otherAnswer: 0, noAnswer: 0, waiting: 0, recorded: deleted + updated + verified, medianDays: null, enough: sent >= 10 });

  it("ranks candidates with enough disputes by deleted-or-updated share; the rest keep their given order after", () => {
    const rows = [row("a", 20, 2, 0, 18), row("b", 20, 8, 2, 10), row("c", 5, 5, 0, 0), row("d", 30, 0, 0, 0)];
    expect(escalationOrder(rows, ["a", "c", "b", "d", "e"])).toEqual(["b", "a", "c", "d", "e"]);
  });

  it("does not change the round engine: attack.ts never reads outcomes", () => {
    const attack = readFileSync("src/lib/domain/attack.ts", "utf8");
    expect(attack).not.toMatch(/learning|outcome|escalationOrder/i);
  });
});

// ── Never client-facing ─────────────────────────────────────────────────

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

/** Everything a client or a prospect can read: the client app, the public pages, their copy, the content pipeline. */
const CLIENT_AND_MARKETING = [
  ...files("src/app").filter((f) => !f.startsWith(join("src", "app", "equipo")) && !f.startsWith(join("src", "app", "api", "staff"))),
  ...files("src/components").filter((f) => !f.startsWith(join("src", "components", "staff"))),
  ...files("src/lib/ux"),
  ...files("src/lib/i18n"),
  ...files("src/lib/learn"),
  ...files("src/lib/coach"),
  ...files("src/lib/chat"),
  ...files("src/lib/sales"),
  ...files("src/lib/autopilot"),
  ...files("src/lib/voice"),
  ...files("content").filter((f) => !f.endsWith(".jpg")),
].filter((f) => /\.(tsx?|json|md)$/.test(f));

const PCT = String.raw`\d{1,3}(?:[.,]\d+)?\s*(?:%|por\s*ciento|percent)|\$\{[^}]*\}\s*%`;
const REMOVAL = String.raw`elimin|borr|remov|delet|quit|desaparec|sac(?:a|amos|aron)`;
const REMOVAL_RATE = [new RegExp(`(?:${PCT})[^.\\n]{0,60}\\b(?:${REMOVAL})`, "i"), new RegExp(`\\b(?:${REMOVAL})\\w*[^.\\n]{0,60}(?:${PCT})`, "i")];

describe("outcome numbers never reach a client or an ad", () => {
  it("scans a real set of files", () => {
    expect(CLIENT_AND_MARKETING.length).toBeGreaterThan(100);
  });

  it("no percentage of removals anywhere a client or a prospect can read", () => {
    for (const file of CLIENT_AND_MARKETING) {
      const text = readFileSync(file, "utf8");
      for (const pattern of REMOVAL_RATE) expect(text.match(pattern)?.[0] ?? null, file).toBeNull();
    }
  });

  it("the pattern catches the claims it is for", () => {
    const caught = (s: string) => REMOVAL_RATE.some((p) => p.test(s));
    expect(caught("Eliminamos el 87% de las cuentas")).toBe(true);
    expect(caught("87% de los puntos se borraron")).toBe(true);
    expect(caught("We removed 92 percent of negatives")).toBe(true);
    expect(caught("`${rate}% deleted`")).toBe(true);
    expect(caught("Mantén tu uso de crédito por debajo del 30%")).toBe(false);
  });

  it("nothing a client or a prospect reads imports the learning loop", () => {
    for (const file of CLIENT_AND_MARKETING) expect(readFileSync(file, "utf8"), file).not.toMatch(/staff\/learning|OutcomesLearning/);
  });

  it("the table sits on the administrators' business dashboard only", () => {
    const users = files("src").filter((f) => /\.(tsx?)$/.test(f) && !f.includes("__tests__") && /OutcomesLearning|staff\/learning/.test(readFileSync(f, "utf8")));
    expect(users.sort()).toEqual([join("src", "app", "equipo", "negocio", "page.tsx"), join("src", "components", "staff", "OutcomesLearning.tsx")].sort());
    expect(readFileSync("src/app/equipo/negocio/page.tsx", "utf8")).toContain('can("business.view")');
  });
});

export type { DisputeAttempt };
