import { describe, expect, it } from "vitest";
import { checkClaimGuardrails } from "../compliance/guardrails";
import { DEMO_RAW_REPORT } from "../demo";
import { parseReport } from "../domain/parser";
import { applyDemoActions, EMPTY_ACTIONS } from "../staff/data";
import { buildDemoClients } from "../staff/demoClients";
import { exceptionMessage } from "../staff/messages";
import { sendBlockReason as sendBlock } from "../staff/stage";
import {
  clientExceptions,
  clientStage,
  EXCEPTION_LABEL,
  HANDLED_QUIET_DAYS,
  handledExceptions,
  identityTheftItemsWithoutReport,
  sendableRound,
} from "../staff/stage";
import type { ItemAnswer, StaffClient } from "../staff/types";

// Identity theft needs a person: the client is told a teammate will follow up
// when they pick that reason, so the team has to be told too.

const NOW = new Date("2026-12-05T18:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

const report = parseReport({ ...DEMO_RAW_REPORT, pulledAt: ago(2) });
const [first, second, ...rest] = report.items;

const theft = (daysAgo: number): ItemAnswer => ({
  status: "inaccurate",
  reason: "Yo no abrí esta cuenta.",
  reasonCode: "identity_theft",
  confirmedAt: ago(daysAgo),
});

function client(overrides: Partial<StaffClient> = {}): StaffClient {
  const answers: Record<string, ItemAnswer> = Object.fromEntries(
    report.items.map((item) => [item.fingerprint, { status: "correct", answeredAt: ago(1) }]),
  );
  return {
    id: "t1",
    firstName: "Prueba",
    lastName: "Ejemplo",
    phone: "+17135550100",
    state: "TX",
    addressLines: ["1 Calle Ejemplo", "Houston, TX 77001"],
    salesperson: "ana",
    createdAt: ago(20),
    signedUpAt: ago(19),
    agreementSignedAt: ago(18),
    documents: ["government_id", "proof_of_address"],
    report,
    answers,
    rounds: [],
    billing: "active",
    lastActivityAt: ago(1),
    notes: [],
    questions: [],
    handled: {},
    ...overrides,
  };
}

const withTheft = (c: StaffClient, ...entries: Array<[string, ItemAnswer]>): StaffClient => ({
  ...c,
  answers: { ...c.answers, ...Object.fromEntries(entries) },
});

const kinds = (c: StaffClient, now = NOW) => clientExceptions(c, now).map((e) => e.kind);

describe("staff: identity theft with no identity theft report on file", () => {
  it("needs a person: a confirmed item with that reason and no FTC report on file", () => {
    const c = withTheft(client(), [second!.fingerprint, theft(1)]);
    const [exception] = clientExceptions(c, NOW);
    expect(exception).toMatchObject({
      key: "identity_theft_report_missing",
      kind: "identity_theft_report_missing",
      severity: "high",
      actionLabel: "Pedirle el reporte de robo de identidad",
      action: "whatsapp",
      since: ago(1),
    });
    expect(exception!.sentence).toBe(
      "Dijo que 1 punto es resultado de robo de identidad (Midland Credit Management) y no hay un reporte de robo de identidad de la FTC en archivo. La app le avisó que una persona del equipo lo contactaría.",
    );
    expect(EXCEPTION_LABEL.identity_theft_report_missing).toBe("Robo de identidad sin reporte");
    expect(checkClaimGuardrails(exception!.sentence)).toEqual([]);
  });

  it("clears when the identity theft report is on file", () => {
    const c = withTheft(client(), [second!.fingerprint, theft(1)]);
    expect(kinds(c)).toEqual(["identity_theft_report_missing"]);
    const onFile: StaffClient = { ...c, documents: [...c.documents, "identity_theft_report"] };
    expect(kinds(onFile)).toEqual([]);
    expect(handledExceptions(onFile, NOW)).toEqual([]);
    expect(identityTheftItemsWithoutReport(onFile)).toEqual([]);
    // Another document on file does not stand in for it.
    expect(kinds({ ...c, documents: [...c.documents, "ssn_card"] })).toEqual(["identity_theft_report_missing"]);
  });

  it("is one notice per client, counting every such item, dated from the first", () => {
    const c = withTheft(client(), [first!.fingerprint, theft(1)], [second!.fingerprint, theft(4)], [rest[0]!.fingerprint, theft(2)]);
    const found = clientExceptions(c, NOW).filter((e) => e.kind === "identity_theft_report_missing");
    expect(found).toHaveLength(1);
    expect(found[0]!.sentence).toMatch(/^Dijo que 3 puntos son resultado de robo de identidad y no hay/);
    expect(found[0]!.since).toBe(ago(4));
  });

  it("does not fire for other reasons, for answers without a reason, or for an item no longer on the report", () => {
    const other: ItemAnswer = { status: "inaccurate", reason: "No es mía.", reasonCode: "not_mine", confirmedAt: ago(1) };
    const noCode: ItemAnswer = { status: "inaccurate", reason: "Robo de identidad.", confirmedAt: ago(1) };
    expect(kinds(withTheft(client(), [first!.fingerprint, other], [second!.fingerprint, noCode]))).toEqual([]);
    // Staff cannot infer the reason from the client's words: only the code the client picked counts.
    expect(kinds(withTheft(client(), ["gone-from-the-report", theft(1)]))).toEqual([]);
    expect(kinds(client({ report: null, answers: { [second!.fingerprint]: theft(1) } }))).toEqual([]);
  });

  it("can be marked handled like any notice, and comes back if the report is still missing", () => {
    const c = withTheft(client({ handled: { identity_theft_report_missing: ago(1) } }), [second!.fingerprint, theft(5)]);
    expect(kinds(c)).toEqual([]);
    expect(handledExceptions(c, NOW).map((e) => e.kind)).toEqual(["identity_theft_report_missing"]);
    const afterQuiet = new Date(NOW.getTime() + HANDLED_QUIET_DAYS * DAY);
    expect(kinds(c, afterQuiet)).toContain("identity_theft_report_missing");
  });

  it("does not change the client's stage: it is a notice, the answers stay the client's", () => {
    const plain = client();
    const c = withTheft(plain, [second!.fingerprint, theft(1)]);
    expect(clientStage(c, NOW)).toBe("ready_to_send");
    const otherReason: ItemAnswer = { status: "inaccurate", reason: "No es mía.", reasonCode: "not_mine", confirmedAt: ago(1) };
    expect(clientStage(withTheft(plain, [second!.fingerprint, otherReason]), NOW)).toBe("ready_to_send");
  });

  it("drafts a WhatsApp message that asks for the report and promises nothing", () => {
    const c = withTheft(client(), [second!.fingerprint, theft(1)]);
    const message = exceptionMessage(c, clientExceptions(c, NOW)[0]!);
    expect(message).toMatch(/^Hola Prueba, te escribe el equipo de Credalti\./);
    expect(message).toContain("reporte de robo de identidad de la FTC");
    expect(message).toContain("IdentityTheft.gov");
    expect(checkClaimGuardrails(message)).toEqual([]);
    expect(message).not.toMatch(/garantiz|deber[ií]as marcar|marca (como|este|esta)/i);
  });

  describe("in the demo", () => {
    const clients = buildDemoClients(NOW);
    const later = new Date(NOW.getTime() + 5 * 60 * 1000);
    const flagged = clients.filter((c) => clientExceptions(c, later).some((e) => e.kind === "identity_theft_report_missing"));

    it("one invented client shows it, with the reason she picked and what the app told her", () => {
      expect(flagged.map((c) => c.id)).toEqual(["c16"]);
      const dolores = flagged[0]!;
      expect(identityTheftItemsWithoutReport(dolores)).toEqual([
        { label: "Midland Credit Management", confirmedAt: expect.any(String) },
      ]);
      expect(dolores.documents).not.toContain("identity_theft_report");
      expect(dolores.conversation!.some((m) => /Una persona del equipo te va a contactar/.test(m.text))).toBe(true);
      expect(sendableRound(dolores, later)).toBeNull();
    });

    it("clears once her report is on file, and nothing else about her changes", () => {
      const dolores = flagged[0]!;
      const after = applyDemoActions(clients, { ...EMPTY_ACTIONS, documents: { c16: ["identity_theft_report"] } }).find((c) => c.id === "c16")!;
      expect(after.documents).toEqual([...dolores.documents, "identity_theft_report"]);
      expect(clientExceptions(after, later)).toEqual([]);
      expect(after.answers).toEqual(dolores.answers);
      expect(clientStage(after, later)).toBe(clientStage(dolores, later));
    });
  });
});

describe("identity theft blocks sending until the report is on file", () => {
  const NOW_ = new Date("2026-11-21T18:00:00.000Z");
  const clients = buildDemoClients(NOW_);

  it("refuses to send for the client who reported identity theft with no report on file", () => {
    const c16 = clients.find((c) => c.id === "c16")!;
    expect(sendBlock(c16, NOW_)).toMatch(/robo de identidad/);
  });

  it("lifts the block once the identity theft report is on file", () => {
    const after = applyDemoActions(clients, { ...EMPTY_ACTIONS, documents: { c16: ["identity_theft_report"] } }).find((c) => c.id === "c16")!;
    expect(sendBlock(after, NOW_) ?? "").not.toMatch(/robo de identidad/);
  });
});
