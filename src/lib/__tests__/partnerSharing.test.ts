import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkMarketingCopy } from "../compliance/guardrails";
import { EMPTY_CASE_FACTS } from "../case/timeline";
import { partnerRules } from "../partners/copy";
import { checkLogo } from "../partners/logo";
import { checkProgramChange, NO_FEES_LINE, programFromRow } from "../partners/program";
import {
  consentHash,
  consentPlainText,
  consentText,
  noticesDue,
  partnerMilestones,
  partnerNoticeKey,
  partnerStage,
  partnerTimeline,
  PARTNER_PROGRESS_COLUMNS,
  progressFromCaseFacts,
  progressFromRow,
  SHARE_LEVELS,
  SHARING_CONSENT_VERSION,
  type PartnerProgress,
} from "../partners/sharing";
import { CLIENT_SHARING_COPY, howItWorksCopy, PARTNER_SHARING_COPY } from "../partners/sharingCopy";
import { currentShares } from "../partners/sharingStaff";
import { noticeText, PARTNER_NOTICE_TEMPLATE_BODY } from "../partners/sharingServer";
import { PARTNER_CLIENT_TERMS_VERSION, partnerTerms, partnerTermsHash } from "../partners/terms";

// Partner sharing, the pure parts: the consent text and its hash, what a
// partner's screen says at each stage, the notices, the program switch, the
// logo check, and every word against the advertising claim rules.

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-22T18:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * DAY).toISOString();
const LAURA = { name: "Laura Benítez", company: "Benítez Realty" };
const MIGRATION = readFileSync("supabase/migrations/0023_partner_sharing.sql", "utf8");

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (typeof value === "function") out.push(String((value as (...a: string[]) => string)("María López", "3 de diciembre")));
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => strings(v, out));
  return out;
}

const base: PartnerProgress = {
  clientId: "c1",
  name: "Rosa Martínez",
  level: "summary",
  how: "referred",
  sharedAt: ago(30),
  goal: "mortgage",
  agreementSignedAt: ago(28),
  workStartsAt: ago(24),
  serviceEndedAt: null,
  documentsCompleteAt: ago(22),
  reviewFinishedAt: ago(20),
  rounds: [{ number: 1, mailedAt: ago(10), answerDueAt: new Date(NOW.getTime() + 20 * DAY).toISOString(), nextRoundAt: new Date(NOW.getTime() + 30 * DAY).toISOString() }],
  disputingCount: 4,
  noLongerReportedCount: 1,
};

/** Words that would describe an outcome, a deletion or a percentage. */
const OUTCOME = /elimin|\bborrad[oa]s?\b|delet|remov|garantiz|guarant|arregl|fixed|\d+\s*%|porcentaje|percent|puntaje sub|score went/i;

describe("every word passes the claim rules and never speaks of an outcome", () => {
  const all = [
    ...strings(CLIENT_SHARING_COPY),
    ...strings(PARTNER_SHARING_COPY),
    ...(["es", "en"] as const).flatMap((l) => [
      ...SHARE_LEVELS.flatMap((level) => strings(consentText(level, LAURA, l))),
      ...strings(howItWorksCopy(l, LAURA, true)),
      ...strings(howItWorksCopy(l, LAURA, false)),
      ...strings(partnerTerms(l, true)),
      ...strings(partnerTerms(l, false)),
      ...partnerRules(l, false),
      NO_FEES_LINE[l],
    ]),
  ];
  it.each(all.map((t) => [t]))("%s", (text) => {
    expect(checkMarketingCopy(text, "full_service")).toEqual([]);
    expect(text).not.toMatch(OUTCOME);
  });

  it("stage sentences, timelines and notices too, at every stage", () => {
    const scenarios: PartnerProgress[] = [
      { ...base, agreementSignedAt: null, workStartsAt: null, documentsCompleteAt: null, reviewFinishedAt: null, rounds: [] },
      { ...base, workStartsAt: new Date(NOW.getTime() + 2 * DAY).toISOString(), documentsCompleteAt: null, reviewFinishedAt: null, rounds: [] },
      { ...base, documentsCompleteAt: null, reviewFinishedAt: null, rounds: [] },
      { ...base, reviewFinishedAt: null, rounds: [] },
      { ...base, documentsCompleteAt: null, rounds: [] },
      { ...base, rounds: [] },
      base,
      { ...base, rounds: [{ ...base.rounds[0]!, answerDueAt: ago(1) }] },
      { ...base, rounds: [{ ...base.rounds[0]!, answerDueAt: ago(5), nextRoundAt: ago(1) }] },
      { ...base, serviceEndedAt: ago(2) },
    ];
    const keys = new Set<string>();
    for (const p of scenarios) {
      for (const l of ["es", "en"] as const) {
        const stage = partnerStage(p, l, NOW);
        keys.add(stage.key);
        const texts = [stage.sentence, stage.label, stage.next?.label ?? "", ...partnerTimeline(p, l, NOW).map((e) => e.title), ...partnerMilestones(p, NOW).map((m) => m.text[l])];
        for (const t of texts.filter(Boolean)) {
          expect(checkMarketingCopy(t, "full_service"), t).toEqual([]);
          expect(t).not.toMatch(OUTCOME);
        }
      }
    }
    expect(keys.size).toBe(10);
  });
});

describe("the consent text and its record", () => {
  it("says what the partner will and will never see, by level", () => {
    const progress = consentPlainText("progress", LAURA, "es");
    const summary = consentPlainText("summary", LAURA, "es");
    expect(progress).toMatch(/Tu nombre completo/);
    expect(progress).not.toMatch(/Dos números/);
    expect(summary).toMatch(/Dos números/);
    for (const text of [progress, summary, consentPlainText("none", LAURA, "es")]) {
      expect(text).toMatch(/puntajes/);
      expect(text).toMatch(/Seguro Social/);
      expect(text).toMatch(/pagos/);
    }
    expect(consentPlainText("progress", LAURA, "en")).toMatch(/Social Security number/);
    expect(consentText("summary", LAURA, "es").lead).toBe("Laura Benítez, Benítez Realty podrá ver tu avance.");
  });

  it("the hash is SHA-256 of the version, language, level and exact text; any change gives another", () => {
    const expected = createHash("sha256")
      .update([`version: ${SHARING_CONSENT_VERSION}`, "locale: es", "level: progress", consentPlainText("progress", LAURA, "es")].join("\n\n"))
      .digest("hex");
    expect(consentHash("progress", LAURA, "es")).toBe(expected);
    const others = [consentHash("summary", LAURA, "es"), consentHash("progress", LAURA, "en"), consentHash("progress", { ...LAURA, company: null }, "es"), consentHash("progress", LAURA, "es", "2026-12-x")];
    expect(new Set([expected, ...others]).size).toBe(5);
  });

  it("the partner terms: the version is the database's, and the fee clause follows the program", () => {
    expect(MIGRATION).toContain(`select '${PARTNER_CLIENT_TERMS_VERSION}'::text`);
    expect(partnerTermsHash("es", false)).not.toBe(partnerTermsHash("es", true));
    const off = strings(partnerTerms("es", false)).join(" ");
    expect(off).toMatch(/no paga comisiones/);
    expect(off).not.toMatch(/recibes una comisión/);
    expect(strings(partnerTerms("es", true)).join(" ")).toMatch(/cliente que firma o por cliente activo/);
    for (const title of ["Confidencialidad", "Sin promesas", "Sin números de Seguro Social ni reportes", "Sin presión", "El cliente decide"]) {
      expect(partnerTerms("es", false).clauses.map((c) => c.title)).toContain(title);
    }
  });
});

describe("what a partner gets", () => {
  it("the columns the code expects are exactly the database function's", () => {
    const block = MIGRATION.split("create function public.partner_clients()")[1]!.split("language sql")[0]!;
    const cols = [...block.matchAll(/^\s+([a-z_]+) (?:uuid|text|timestamptz|jsonb|integer),?$/gm)].map((m) => m[1]);
    expect(cols.sort()).toEqual([...PARTNER_PROGRESS_COLUMNS].sort());
  });

  it("a row at the 'progress' level never carries counts, even if one were sent", () => {
    const p = progressFromRow({ client_id: "x", display_name: "Rosa", level: "progress", how: "referred", shared_at: ago(1), rounds: [], disputing_count: 5, no_longer_reported_count: 2, goal: "nonsense" });
    expect(p.disputingCount).toBeNull();
    expect(p.noLongerReportedCount).toBeNull();
    expect(p.goal).toBeNull();
  });

  it("the stage and the next date come from the milestone dates only", () => {
    const stage = partnerStage(base, "es", NOW);
    expect(stage.key).toBe("waiting_answers");
    expect(stage.sentence).toMatch(/Las cartas de la ronda 1 de Rosa salieron el/);
    expect(stage.next?.at).toBe(base.rounds[0]!.answerDueAt);
    const timeline = partnerTimeline(base, "es", NOW);
    expect(timeline.at(-1)!.done).toBe(false);
    expect(timeline.map((e) => e.key)).toEqual(["shared", "signed", "work_starts", "documents", "review", "round_1", "answer_1", "next_round"]);
  });

  it("the client's preview uses the same shape, from their own case", () => {
    const preview = progressFromCaseFacts(EMPTY_CASE_FACTS, { name: "Rosa Martínez", goal: "auto", level: "summary" });
    expect(Object.keys(preview).length).toBe(Object.keys(base).length);
    expect(preview).toMatchObject({ agreementSignedAt: null, goal: "auto", disputingCount: 0 });
    expect(partnerStage(preview, "es", NOW).key).toBe("not_signed");
  });
});

describe("milestone notices", () => {
  it("only recent milestones since sharing began, each once", () => {
    const recent = { ...base, sharedAt: ago(40), rounds: [{ ...base.rounds[0]!, mailedAt: ago(1) }] };
    const due = noticesDue(recent, "p1", new Set(), NOW);
    expect(due.map((m) => m.key)).toEqual(["round_1"]);
    expect(noticesDue(recent, "p1", new Set([partnerNoticeKey("p1", "c1", "round_1")]), NOW)).toEqual([]);
    // Nothing from before the client started sharing.
    expect(noticesDue({ ...recent, sharedAt: NOW.toISOString() }, "p1", new Set(), NOW)).toEqual([]);
  });

  it("the words carry only the milestone, and fit the approved template", () => {
    const [m] = noticesDue({ ...base, rounds: [{ ...base.rounds[0]!, mailedAt: ago(1) }] }, "p1", new Set(), NOW);
    const text = noticeText({ name: "Laura Benítez" }, m!);
    expect(text).toBe("Hola, Laura. Salieron las cartas de la ronda 1 de Rosa. Los burós tienen unos 30 días para responder. Más detalles en tu portal de socios de Credalti.");
    expect(PARTNER_NOTICE_TEMPLATE_BODY.replace("{{1}}", "Laura").replace("{{2}}", m!.text.es)).toBe(text);
    expect(checkMarketingCopy(text, "full_service")).toEqual([]);
  });
});

describe("Comisiones a socios", () => {
  it("off needs nothing; on needs the attorney, a past date and the confirmation", () => {
    expect(checkProgramChange({ enabled: false })).toMatchObject({ ok: true });
    expect(checkProgramChange({ enabled: true, attorneyApprovedOn: "2026-11-20", confirmed: true }, NOW)).toMatchObject({ ok: false });
    expect(checkProgramChange({ enabled: true, attorneyName: "Lic. Ana", attorneyApprovedOn: "2026-11-20" }, NOW)).toMatchObject({ ok: false });
    expect(checkProgramChange({ enabled: true, attorneyName: "Lic. Ana", attorneyApprovedOn: "2027-01-01", confirmed: true }, NOW)).toMatchObject({ ok: false });
    expect(checkProgramChange({ enabled: true, attorneyName: "Lic. Ana", attorneyApprovedOn: "2026-11-20", confirmed: true }, NOW)).toMatchObject({ ok: true });
    expect(programFromRow(null).commissionsEnabled).toBe(false);
  });

  it("the rules partners read drop the commission lines while off", () => {
    expect(partnerRules("es", false).join(" ")).not.toMatch(/recibes una comisión/);
    expect(partnerRules("es", false).join(" ")).toMatch(/no paga comisiones/);
    expect(partnerRules("es", true).join(" ")).toMatch(/recibes una comisión/);
    expect(howItWorksCopy("es", LAURA, false).fees).toBe("Laura no recibe ningún pago por recomendarte.");
    expect(howItWorksCopy("es", LAURA, true).fees).toMatch(/recibe una comisión/);
  });
});

describe("the logo and the staff view", () => {
  it("accepts a real PNG, refuses SVG and a file that only claims to be an image", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString("base64");
    expect(checkLogo(`data:image/png;base64,${png}`)).toMatchObject({ ok: true, mime: "image/png" });
    expect(checkLogo(`data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`).ok).toBe(false);
    expect(checkLogo(`data:image/png;base64,${Buffer.from("<script>x</script>").toString("base64")}`).ok).toBe(false);
    expect(checkLogo(`data:image/png;base64,${Buffer.alloc(130_000, 0x89).toString("base64")}`).ok).toBe(false);
  });

  it("the current pairs are the newest records, with the start of the current stretch", () => {
    const rows = currentShares(
      [
        { seq: 1, clientId: "a", partnerId: "p", level: "progress", how: "referred", at: ago(10) },
        { seq: 2, clientId: "a", partnerId: "p", level: "none", how: "referred", at: ago(8) },
        { seq: 3, clientId: "a", partnerId: "p", level: "progress", how: "referred", at: ago(5) },
        { seq: 4, clientId: "a", partnerId: "p", level: "summary", how: "referred", at: ago(2) },
        { seq: 5, clientId: "b", partnerId: "p", level: "summary", how: "added_by_code", at: ago(3) },
        { seq: 6, clientId: "b", partnerId: "p", level: "none", how: "added_by_code", at: ago(1) },
      ],
      (id) => id.toUpperCase(),
    );
    expect(rows).toEqual([{ partnerId: "p", clientId: "a", clientName: "A", level: "summary", how: "referred", since: ago(5) }]);
  });
});
