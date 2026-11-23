import { describe, expect, it } from "vitest";
import { checkClaimGuardrails } from "../compliance/guardrails";
import { DEMO_RAW_REPORT } from "../demo";
import { parseReport, type RawReport } from "../domain/parser";
import { dedupePersonalInfo, normalizeBirthDate, personalInfoField, personalInfoKey } from "../domain/personalInfo";
import type { Bureau, ReportItem } from "../domain/types";
import { demoReportHistory, entryFromPullRow, historyFromPullRows, historySummary, reportHistoryOf } from "../reports/history";
import { importPreview, mergeReport, planImport, toRawReport } from "../reports/merge";
import { changesByBureau, openRoundMarks, personalInfoChanges, reappearedItems, readChangeRecords } from "../reports/reimport";
import { auditView } from "../reports/auditView";
import { reappearedFingerprints } from "../rounds/plan";
import { reappearedFacts } from "../clientCase/server";
import { applyDemoActions, EMPTY_ACTIONS } from "../staff/data";
import { buildDemoClients } from "../staff/demoClients";
import type { StaffClient } from "../staff/types";
import { reappearedExplanation } from "../ux/reappeared";
import { demoClientReportHistory } from "../ux/reportHistory";

// Re-imports (Credit Repair Cloud, Nov 20 2026): repeated personal information
// is not added again, items in an open round are labelled, items a round saw
// gone that come back are flagged for the client's review, and each disputed
// personal detail says "No longer appears" or "Still reporting". Plus the
// list of every report in the file (CRC, Nov 19).

const NOW = new Date("2026-11-23T18:00:00.000Z");
const AT = NOW.toISOString();
const DAY = 24 * 60 * 60 * 1000;

describe("personal information compared by normalized value", () => {
  it("reads the usual field names as one field", () => {
    expect(personalInfoField("Previous Address")).toBe("address");
    expect(personalInfoField("date_of_birth")).toBe("dob");
    expect(personalInfoField("AKA")).toBe("name");
    expect(personalInfoField("ssn_variant")).toBe("ssn_variant");
  });

  it("treats spellings of one address as the same entry", () => {
    const a = personalInfoKey("address", "123 Old Street Apt 2, Houston, TX 77001");
    expect(personalInfoKey("address", "123 OLD ST #2 HOUSTON TX 77001-1234")).toBe(a);
    expect(personalInfoKey("previous_address", "123 old st. apartment 2, Houston, Texas 77001")).toBe(a);
    expect(personalInfoKey("address", "124 Old Street Apt 2, Houston, TX 77001")).not.toBe(a);
  });

  it("reads birth dates in the usual spellings", () => {
    for (const v of ["1985-03-14", "03/14/1985", "3/14/1985", "March 14, 1985", "14 de marzo de 1985", "1985/3/14"]) {
      expect(normalizeBirthDate(v), v).toBe("1985-03-14");
    }
    expect(normalizeBirthDate("1985")).toBe("1985");
    expect(normalizeBirthDate("not a date")).toBeNull();
    expect(personalInfoKey("dob", "03/14/1985")).toBe(personalInfoKey("birth_date", "1985-03-14"));
  });

  it("names and employers ignore punctuation, case, accents and company suffixes", () => {
    expect(personalInfoKey("name", "R. MARTINEZ JR")).toBe(personalInfoKey("name", "r martinez jr."));
    expect(personalInfoKey("name", "Rosa Martínez")).toBe(personalInfoKey("name", "ROSA MARTINEZ"));
    expect(personalInfoKey("employer", "ACME LLC")).toBe(personalInfoKey("employer", "Acme, L.L.C."));
    expect(personalInfoKey("employer", "Acme Inc")).toBe(personalInfoKey("employer", "ACME"));
    expect(personalInfoKey("name", "ACME")).not.toBe(personalInfoKey("employer", "ACME"));
  });
});

describe("dedupePersonalInfo", () => {
  const previous = parseReport(DEMO_RAW_REPORT);

  it("keeps the file's own spelling of an entry it already has, so it stays one item", () => {
    const raw = structuredClone(DEMO_RAW_REPORT);
    raw.bureaus.equifax!.personalInfo = [
      { field: "address", value: "123 OLD ST #2 HOUSTON TX 77001" },
      { field: "name", value: "r martinez jr." },
    ];
    const out = dedupePersonalInfo(raw, previous);
    // The two above, and Experian's employer, which the file has too.
    expect(out.skipped).toBe(3);
    expect(out.repeats.filter((r) => r.bureau === "equifax")).toHaveLength(2);
    expect(out.repeats.every((r) => r.reason === "on_file")).toBe(true);
    expect(out.raw.bureaus.equifax!.personalInfo).toEqual(DEMO_RAW_REPORT.bureaus.equifax!.personalInfo);
    // Same fingerprints as the file: no new items, the answers carry over.
    const fps = (r: RawReport) => parseReport(r).items.filter((i) => i.category === "personal_info").map((i) => i.fingerprint).sort();
    expect(fps(out.raw)).toEqual(fps(DEMO_RAW_REPORT));
    // The input is not changed.
    expect(raw.bureaus.equifax!.personalInfo[0]!.value).toBe("123 OLD ST #2 HOUSTON TX 77001");
  });

  it("drops a second copy of one entry in the same report, per bureau only", () => {
    const raw = structuredClone(DEMO_RAW_REPORT);
    raw.bureaus.experian!.personalInfo.push({ field: "employer", value: "Acme, L.L.C." }, { field: "employer", value: "ACME" });
    raw.bureaus.transunion!.personalInfo.push({ field: "employer", value: "ACME LLC" });
    const out = dedupePersonalInfo(raw, null);
    expect(out.skipped).toBe(2);
    expect(out.repeats.map((r) => [r.bureau, r.reason])).toEqual([
      ["experian", "in_report"],
      ["experian", "in_report"],
    ]);
    expect(out.raw.bureaus.experian!.personalInfo).toEqual([{ field: "employer", value: "ACME LLC" }]);
    expect(out.raw.bureaus.transunion!.personalInfo).toEqual([{ field: "employer", value: "ACME LLC" }]);
  });

  it("leaves everything that is not personal information exactly as it came", () => {
    const out = dedupePersonalInfo(DEMO_RAW_REPORT, previous);
    for (const bureau of ["equifax", "experian", "transunion"] as Bureau[]) {
      const { personalInfo: _a, ...rest } = out.raw.bureaus[bureau]!;
      const { personalInfo: _b, ...before } = DEMO_RAW_REPORT.bureaus[bureau]!;
      expect(rest).toEqual(before);
    }
    expect(out.raw.pulledAt).toBe(DEMO_RAW_REPORT.pulledAt);
  });
});

// ── A client with five rounds: Rosa Delgado in the demo (c24) ───────────

function rosa(): StaffClient {
  return buildDemoClients(NOW).find((c) => c.id === "c24")!;
}

/** An item's raw entry put back into a report in the app's own format. */
function putBack(raw: RawReport, item: ReportItem) {
  const section = raw.bureaus[item.bureau]!;
  const data = item.data as never;
  if (item.category === "tradeline") section.tradelines.push(data);
  else if (item.category === "inquiry") section.inquiries.push(data);
  else if (item.category === "public_record") section.publicRecords.push(data);
  else section.personalInfo.push(data);
}

/** Today's report: the one on file, with repeats in other spellings and one item a past round saw gone. */
function reimport(client: StaffClient): { raw: RawReport; back: ReportItem } {
  const raw = toRawReport(client.report!);
  raw.pulledAt = new Date(NOW.getTime() - DAY).toISOString();
  raw.bureaus.equifax!.personalInfo.push({ field: "name", value: "r delgado jr." }, { field: "name", value: "R DELGADO JR" });
  raw.bureaus.experian!.personalInfo.push({ field: "employer", value: "Acme, L.L.C." });
  const goneFp = client.rounds.find((r) => r.number === 2)!.results![0]!.fingerprint;
  const back = client.rounds.flatMap((r) => r.letters.flatMap((l) => l.items)).find((i) => i.fingerprint === goneFp)!;
  putBack(raw, back);
  return { raw, back };
}

describe("the re-import preview", () => {
  it("counts the repeated personal-info entries it does not add again", () => {
    const client = rosa();
    const { raw } = reimport(client);
    const preview = importPreview(client, raw, AT, "en");
    // Every entry already on file and the three spelled another way.
    const onFile = client.report!.items.filter((i) => i.category === "personal_info").length;
    expect(preview.personalInfoRepeats).toHaveLength(onFile + 3);
    expect(preview.blocked).toBeNull();
    // Nothing new from the repeats: the only new item is the one that came back.
    expect(preview.comparison!.added.map((i) => i.category)).toEqual(["tradeline"]);
  });

  it("labels the items of the open round (round 5, mailed) as already disputed", () => {
    const client = rosa();
    const { raw } = reimport(client);
    const preview = importPreview(client, raw, AT, "en");
    const round5 = new Set(client.rounds.find((r) => r.number === 5)!.letters.flatMap((l) => l.items.map((i) => i.fingerprint)));
    expect(preview.inOpenRound.length).toBeGreaterThan(0);
    expect(preview.inOpenRound.every(({ item, mark }) => round5.has(item.fingerprint) && mark.round === 5 && mark.status === "mailed")).toBe(true);
    // Answered rounds are not open.
    const marks = openRoundMarks(client.rounds);
    expect([...marks.values()].every((m) => m.round === 5)).toBe(true);
  });

  it("flags an item a past round saw gone that is back, and says so in what saving does", () => {
    const client = rosa();
    const { raw, back } = reimport(client);
    const preview = importPreview(client, raw, AT, "en");
    expect(preview.reappeared.map((r) => [r.item.fingerprint, r.round])).toEqual([[back.fingerprint, 2]]);
    expect(preview.effects.join(" ")).toMatch(/shows up again\. It's marked “Reappeared” for the client's review/);
    const es = importPreview(client, raw, AT, "es");
    expect(es.effects.join(" ")).toMatch(/Volvió a aparecer/);
    // A report dated before the one that showed it gone says nothing about a return.
    expect(reappearedItems(client.rounds, { ...client.report!, items: [back], pulledAt: "2026-01-01T00:00:00.000Z" })).toEqual([]);
  });

  it("marks each disputed personal detail, bureau by bureau: no longer appears or still reporting", () => {
    const client = rosa();
    const { raw } = reimport(client);
    const preview = importPreview(client, raw, AT, "en");
    const groups = changesByBureau(preview.personalInfoChanges);
    expect(groups.map((g) => g.bureau)).toEqual(["equifax", "experian", "transunion"].filter((b) => groups.some((g) => g.bureau === b)));
    const byName = Object.fromEntries(preview.personalInfoChanges.map((c) => [`${c.bureau} ${c.item.name}`, c.status]));
    expect(byName["equifax Address: 325 Old Street Apt 2, Houston, TX 77004"]).toBe("no_longer_appears");
    expect(byName["equifax Name: R. DELGADO JR"]).toBe("still_reporting");
    expect(byName["experian Employer: ACME LLC"]).toBe("still_reporting");
    expect(preview.personalInfoChanges.every((c) => c.round === 1)).toBe(true);
    // A bureau the report leaves out is not judged.
    expect(personalInfoChanges(client.rounds, client.report!, ["experian"]).every((c) => c.bureau === "experian")).toBe(true);
  });

  it("saves the report without the repeats and keeps the facts on the import record", () => {
    const client = rosa();
    const { raw } = reimport(client);
    const plan = planImport(client, raw, AT);
    expect(plan.raw.bureaus.equifax!.personalInfo).toEqual(toRawReport(client.report!).bureaus.equifax!.personalInfo);
    const merged = mergeReport(client, raw, { at: AT, by: "marta", readerKey: "credalti_json" });
    const record = merged.reportImports!.at(-1)!;
    expect(record.skippedPersonalInfo).toBe(plan.personalInfoRepeats.length);
    expect(record.reappeared).toBe(1);
    expect(record.personalInfo!.some((p) => p.status === "no_longer_appears" && p.kind === "address")).toBe(true);
    // The answers carry over: no personal-info item lost its answer.
    for (const item of merged.report!.items.filter((i) => i.category === "personal_info")) {
      expect(merged.answers[item.fingerprint]).toEqual(client.answers[item.fingerprint]);
    }
  });

  it("the round planner disputes a reappeared item again from the start", () => {
    const items = [parseReport(DEMO_RAW_REPORT).items[0]!];
    const rows = [{ round_number: 2, results: [{ fingerprint: items[0]!.fingerprint, outcome: "removed", reportDate: "2026-07-01T00:00:00.000Z" }] }];
    expect([...reappearedFingerprints(rows, items)]).toEqual([items[0]!.fingerprint]);
    expect(reappearedFingerprints([{ round_number: 2, results: [] }], items).size).toBe(0);
  });

  it("the client's payload carries the same facts from the database rows", () => {
    const client = rosa();
    const { raw, back } = reimport(client);
    const report = parseReport(raw);
    const rows = client.rounds.map((r) => ({ round_number: r.number, results: r.results ?? [] }));
    expect(reappearedFacts(report, rows)).toEqual([{ fingerprint: back.fingerprint, round: 2, goneOn: client.rounds[1]!.results![0]!.reportDate }]);
  });
});

describe("reports in one place", () => {
  it("lists the report on file, then each import, newest first, in the demo", () => {
    const client = rosa();
    const { raw } = reimport(client);
    const actions = { ...structuredClone(EMPTY_ACTIONS), imports: { c24: [{ at: AT, by: "marta", readerKey: "credalti_json", report: raw }] } };
    const after = applyDemoActions([client], actions)[0]!;
    const list = reportHistoryOf(after);
    expect(list.map((e) => e.id)).toEqual([`import-${AT}`, "on-file"]);
    expect(list[0]).toMatchObject({ by: "marta", readerKey: "credalti_json", first: false, reappeared: 1 });
    expect(list[1]).toMatchObject({ first: true, readerKey: null, by: null, itemCount: client.report!.items.length });
    // Without imports, the report on file is the one entry.
    expect(reportHistoryOf(client).map((e) => e.id)).toEqual(["on-file"]);
    expect(demoReportHistory(null, [])).toEqual([]);
  });

  it("reads every pull of the database as an entry, oldest first, and reads its summary back safely", () => {
    const rows = [
      { id: "p2", pulled_at: "2026-11-01T00:00:00Z", created_at: "2026-11-02T00:00:00Z", source: "identityiq", reader_key: "credalti_json", imported_by_name: "marta", import_summary: { itemCount: 9, removed: 2, added: 1, changed: 0, closedRound: 3, skippedPersonalInfo: 4, reappeared: 1, personalInfo: [{ bureau: "equifax", kind: "address", name: "Address: 1 A St", status: "no_longer_appears" }, { bureau: "nowhere", name: "x", status: "still_reporting" }] } },
      { id: "p1", pulled_at: "2026-09-01T00:00:00Z", created_at: "2026-09-01T00:00:00Z", source: "identityiq", reader_key: null, imported_by_name: null, import_summary: null },
    ];
    const list = historyFromPullRows(rows);
    expect(list.map((e) => [e.id, e.first])).toEqual([["p1", true], ["p2", false]]);
    expect(list[1]).toMatchObject({ removed: 2, added: 1, closedRound: 3, skippedPersonalInfo: 4, reappeared: 1, by: "marta" });
    expect(list[1]!.personalInfo).toEqual([{ bureau: "equifax", kind: "address", name: "Address: 1 A St", status: "no_longer_appears" }]);
    expect(entryFromPullRow({ id: "x", pulled_at: "bad", import_summary: "nope" }, false)).toMatchObject({ itemCount: 0, personalInfo: [] });
    expect(readChangeRecords("nope")).toEqual([]);
  });

  it("says what changed in staff words and in the client's, never 'deleted' or a score to the client", () => {
    const entry = {
      ...historyFromPullRows([{ id: "p", pulled_at: "2026-11-01T00:00:00Z", created_at: "2026-11-01T00:00:00Z", source: "s", import_summary: { itemCount: 9 } }])[0]!,
      first: false,
      removed: 2,
      added: 1,
      changed: 1,
      closedRound: 4,
      reappeared: 1,
      skippedPersonalInfo: 12,
      personalInfo: [
        { bureau: "equifax" as const, kind: "address" as const, name: "Address: 1 A St", status: "no_longer_appears" as const },
        { bureau: "experian" as const, kind: "name" as const, name: "Name: R D", status: "still_reporting" as const },
      ],
    };
    const staff = historySummary(entry, "en", "staff").join(" ");
    expect(staff).toMatch(/12 repeat personal-info entries skipped/);
    expect(staff).toMatch(/deleted by the bureau/);
    for (const locale of ["en", "es"] as const) {
      const client = historySummary(entry, locale, "client").join(" ");
      expect(client).not.toMatch(/delet|borr|elimin|score|puntaje|repeat|repetid/i);
      expect(checkClaimGuardrails(client)).toEqual([]);
    }
    expect(historySummary(entry, "es", "client").join(" ")).toMatch(/Datos personales que disputaste: 1 ya no aparece, 1 sigue en tu reporte/);
  });

  it("the client demo's list compares two sample reports with the real code", () => {
    const list = demoClientReportHistory(NOW);
    expect(list.map((e) => e.first)).toEqual([false, true]);
    expect(list[0]!.removed).toBeGreaterThan(0);
    expect(list[0]!.personalInfo.map((p) => p.status).sort()).toEqual(["no_longer_appears", "still_reporting"]);
  });

  it("an audit groups each bureau's items, the negative ones first, with no score", () => {
    const view = auditView(parseReport(DEMO_RAW_REPORT));
    expect(view.bureaus.map((b) => b.bureau)).toEqual(["equifax", "experian", "transunion"]);
    expect(view.bureaus[0]!.groups[0]!.key).toBe("negative");
    expect(JSON.stringify(view)).not.toMatch(/"score"/);
  });
});

describe("what the client reads about a reappeared item", () => {
  it("is a fact with the law it rests on, and no promise", () => {
    for (const locale of ["en", "es"] as const) {
      const text = reappearedExplanation(locale, "2026-07-01T12:00:00.000Z");
      expect(text).toMatch(/611\(a\)\(5\)\(B\)/);
      expect(text).toMatch(locale === "en" ? /you decide/ : /tú decides/);
      expect(text).not.toMatch(/delet|borr|elimin|guarantee|garantiz/i);
      expect(checkClaimGuardrails(text)).toEqual([]);
    }
  });
});
