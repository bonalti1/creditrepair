import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { availabilityFromEnv, chooseChannel } from "../autopilot/channels";
import { clientTimeZone, isQuietHour, localHour, nextAllowedTime } from "../autopilot/clock";
import { DEMO_CHANNELS, DEMO_SETTINGS } from "../autopilot/demo";
import { applyAutopilotDemoActions, EMPTY_AUTOPILOT_ACTIONS } from "../autopilot/data";
import { dueFollowups, FOLLOWUP_SCHEDULES, followupStates, openSituations } from "../autopilot/followups";
import { currentOptOut, OPT_OUT_WORDS, optReply, parseOptKeyword } from "../autopilot/optout";
import { planDeliveries, sentToday } from "../autopilot/plan";
import { roundPlanKey } from "../autopilot/planKey";
import { MINUTES_BY_KIND, personExceptions, SEVERITY_BY_KIND, workQueue, workSummary } from "../autopilot/queue";
import { autoSendState } from "../autopilot/sending";
import { statusMessage, type StatusEvent } from "../autopilot/status";
import { ALL_TEMPLATES, appLink, FOLLOWUP_TEMPLATES, FOOTER, renderTemplate, STATUS_TEMPLATES } from "../autopilot/templates";
import { CHANNELS, DEFAULT_AUTOPILOT, FOLLOWUP_KINDS, normalizeSettings, type AutopilotEnv, type OutboundMessage } from "../autopilot/types";
import { unsubscribeToken, unsubscribeUrl, verifyUnsubscribeToken } from "../autopilot/unsubscribe";
import { checkClaimGuardrails, checkMarketingCopy } from "../compliance/guardrails";
import { DEMO_RAW_REPORT } from "../demo";
import { parseReport } from "../domain/parser";
import { emailBody } from "../integrations/email";
import { seededBook } from "../mail/data";
import { demoClientsWithMail } from "../mail/demo";
import { activityFeed, clientActivity } from "../staff/activity";
import { buildDemoClients } from "../staff/demoClients";
import { businessMetrics, METRIC_INFO } from "../staff/metrics";
import { clientExceptions, EXCEPTION_KINDS } from "../staff/stage";
import { buildDemoTeam } from "../staff/team";
import type { ItemAnswer, StaffClient, StaffRound } from "../staff/types";

// Piloto automático: the follow-up engine, the status messages, quiet hours,
// the daily cap, opt-out, the WhatsApp window, automatic sending and the work
// queue (src/lib/autopilot). The database side is in db/autopilot.test.ts.

// Noon in Texas on 5 December 2026.
const NOW = new Date("2026-12-05T18:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const ago = (days: number, hours = 0) => new Date(NOW.getTime() - days * DAY - hours * HOUR).toISOString();

const ON: AutopilotEnv = { settings: { ...DEFAULT_AUTOPILOT, roundsEnabled: true, followupsEnabled: true }, channels: { whatsapp: true, email: true, approvedTemplates: "all", simulated: false } };

function report(daysAgo: number) {
  return parseReport({ ...DEMO_RAW_REPORT, pulledAt: ago(daysAgo) });
}

function client(overrides: Partial<StaffClient> = {}): StaffClient {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    firstName: "Rosa",
    lastName: "Prueba",
    phone: "+17135550100",
    state: "TX",
    addressLines: ["1 Calle Ejemplo", "Houston, TX 77001"],
    salesperson: "ana",
    createdAt: ago(10),
    signedUpAt: ago(10),
    agreementSignedAt: null,
    documents: [],
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

function sent(c: StaffClient, situationKey: string, step: number, at: string, extra: Partial<OutboundMessage> = {}): OutboundMessage {
  return {
    id: `m-${step}-${at}`,
    dedupeKey: `followup:${c.id}:${situationKey}:${step}`,
    kind: "followup",
    topic: situationKey.split(":")[0] as OutboundMessage["topic"],
    step,
    channel: "whatsapp",
    template: null,
    locale: "es",
    body: "x",
    link: null,
    status: "sent",
    queuedAt: at,
    sentAt: at,
    ...extra,
  };
}

/** Sends every step that comes due, at its time, until now: what the hourly runs would have done. */
function runUntil(c: StaffClient, now: Date, env: AutopilotEnv = ON): StaffClient {
  let current = c;
  for (let i = 0; i < 10; i += 1) {
    const due = followupStates(current, now, env).filter((s) => !s.block && s.next && s.next.dueAt <= now.toISOString());
    if (due.length === 0) break;
    const s = due[0]!;
    current = { ...current, outbound: [...(current.outbound ?? []), sent(current, s.situation.key, s.next!.step, s.next!.dueAt)] };
  }
  return current;
}

// ── Schedules ───────────────────────────────────────────────────────────

describe("autopilot: the follow-up schedules", () => {
  it("three messages for each situation, a few days apart, then a person; identity theft is a person's from the start", () => {
    for (const kind of FOLLOWUP_KINDS) {
      const s = FOLLOWUP_SCHEDULES[kind];
      expect(s.stepDays).toHaveLength(3);
      expect([...s.stepDays]).toEqual([...s.stepDays].sort((a, b) => a - b));
      expect(new Set(s.stepDays).size).toBe(3);
      if (!s.personFromStart) expect(s.personAfterDays).toBeGreaterThan(s.stepDays[2]!);
      expect(s.path.startsWith("/")).toBe(true);
      expect(s.covers.length).toBeGreaterThan(0);
      for (const exception of s.covers) expect(EXCEPTION_KINDS).toContain(exception);
    }
    expect(FOLLOWUP_SCHEDULES.identity_theft_report_missing.personFromStart).toBe(true);
    expect(FOLLOWUP_SCHEDULES.agreement_unsigned.stepDays).toEqual([1, 3, 5]);
  });

  it("an unsigned agreement: day 1, 3 and 5 after the account, then a person on day 6 — 'Se le escribió 3 veces sin respuesta'", () => {
    const base = client({ signedUpAt: ago(0, 1) });
    expect(openSituations(base, NOW).map((s) => s.kind)).toEqual(["agreement_unsigned"]);
    // Nothing on day 0.
    expect(dueFollowups(base, NOW, ON)).toEqual([]);
    const day1 = new Date(NOW.getTime() + DAY);
    const due = dueFollowups(base, day1, ON);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ step: 1, topic: "agreement_unsigned", dedupeKey: expect.stringMatching(/^followup:.+:agreement_unsigned:\d{4}-\d{2}-\d{2}:1$/) });
    expect(due[0]!.body).toContain("Hola Rosa");
    expect(due[0]!.body).toContain("/acuerdo");

    // Days later, all three went; the raw notice exists (> 3 days) but is still the system's until day 6.
    const day5 = new Date(NOW.getTime() + 5 * DAY);
    const after5 = runUntil(base, day5);
    expect(after5.outbound!.map((m) => m.step)).toEqual([1, 2, 3]);
    expect(clientExceptions(after5, day5).map((e) => e.kind)).toContain("agreement_unsigned");
    expect(personExceptions(after5, day5, { autopilot: ON })).toEqual([]);

    const day7 = new Date(NOW.getTime() + 7 * DAY);
    const queue = workQueue([after5], day7, { autopilot: ON });
    expect(queue).toHaveLength(1);
    expect(queue[0]!.triedSummary).toBe("Se le escribió 3 veces sin respuesta.");
    expect(queue[0]!.tried.map((t) => t.text)).toEqual(["Recordatorio 1 de 3 por WhatsApp", "Recordatorio 2 de 3 por WhatsApp", "Recordatorio 3 de 3 por WhatsApp"]);
    expect(queue[0]!.action).toMatchObject({ kind: "call", label: "Llamarle", href: "tel:+17135550100" });
  });

  it("never two steps closer than 20 hours, even when one went late", () => {
    const base = client({ signedUpAt: ago(4) });
    // Step 1 went late, an hour ago: step 2 (day 3) is overdue by its day but waits for the gap.
    const late = { ...base, outbound: [sent(base, `agreement_unsigned:${ago(4).slice(0, 10)}`, 1, ago(0, 1))] };
    expect(dueFollowups(late, NOW, ON)).toEqual([]);
    expect(dueFollowups(late, new Date(NOW.getTime() + 20 * HOUR), ON).map((m) => m.step)).toEqual([2]);
  });

  it("documents are asked for only once the cancellation window is over", () => {
    const signedToday = client({ agreementSignedAt: ago(0, 1), signedUpAt: ago(1) });
    expect(openSituations(signedToday, NOW).map((s) => s.kind)).not.toContain("documents_missing");
    const later = client({ agreementSignedAt: ago(9), signedUpAt: ago(10), documents: ["government_id"] });
    const docs = openSituations(later, NOW).find((s) => s.kind === "documents_missing")!;
    expect(docs.values.es).toEqual(["comprobante de domicilio"]);
    expect(docs.values.en).toEqual(["proof of address"]);
  });

  it("a review restarts its schedule whenever the client answers", () => {
    const r = report(9);
    const first = r.items[0]!;
    const answers: Record<string, ItemAnswer> = { [first.fingerprint]: { status: "correct", answeredAt: ago(1) } };
    const c = client({ agreementSignedAt: ago(15), documents: ["government_id", "proof_of_address"], report: r, answers });
    const review = openSituations(c, NOW).find((s) => s.kind === "review_unfinished")!;
    expect(review.startedAt).toBe(ago(1));
    // Answered yesterday: no reminder yet (first one on day 2), and the raw "stalled" notice is the system's.
    expect(dueFollowups(c, NOW, ON)).toEqual([]);
    expect(clientExceptions(c, NOW).map((e) => e.kind)).toContain("review_stalled");
    expect(personExceptions(c, NOW, { autopilot: ON }).map((p) => p.exception.kind)).not.toContain("review_stalled");
  });

  it("nothing goes to a client who cancelled or asked to end the service", () => {
    expect(openSituations(client({ agreementCancelledAt: ago(1) }), NOW)).toEqual([]);
    expect(openSituations(client({ serviceEndRequestedAt: ago(1) }), NOW)).toEqual([]);
    expect(openSituations(client({ signedUpAt: null }), NOW)).toEqual([]);
  });
});

describe("autopilot: when the system cannot write, the notice is a person's exactly as before", () => {
  const c = client({ signedUpAt: ago(4) });
  const raw = clientExceptions(c, NOW);

  it("reminders off (the default): identical to the console's notices", () => {
    const off: AutopilotEnv = { settings: DEFAULT_AUTOPILOT, channels: ON.channels };
    expect(DEFAULT_AUTOPILOT.followupsEnabled).toBe(false);
    expect(DEFAULT_AUTOPILOT.roundsEnabled).toBe(false);
    expect(personExceptions(c, NOW, { autopilot: off }).map((p) => p.exception)).toEqual(raw);
    // One situation off, the rest on.
    const one: AutopilotEnv = { ...ON, settings: { ...ON.settings, followups: { ...ON.settings.followups, agreement_unsigned: false } } };
    expect(personExceptions(c, NOW, { autopilot: one }).map((p) => p.exception)).toEqual(raw);
  });

  it("opted out, on hold, or no channel: the notice shows, with why", () => {
    const optedOut = { ...c, optOut: { at: ago(2), keyword: "BAJA", channel: "whatsapp" as const } };
    const q1 = workQueue([optedOut], NOW, { autopilot: ON });
    expect(q1.map((i) => i.exception.kind)).toEqual(["agreement_unsigned"]);
    expect(q1[0]!.triedSummary).toMatch(/^Pidió no recibir mensajes automáticos \(BAJA\)/);

    const held = { ...c, holds: [{ id: "h", at: ago(1), by: "carmen", reason: "Habló por teléfono" }] };
    expect(workQueue([held], NOW, { autopilot: ON })[0]!.triedSummary).toBe("El piloto automático está detenido para este cliente.");

    const none: AutopilotEnv = { ...ON, channels: { whatsapp: false, email: false, approvedTemplates: [], simulated: false } };
    expect(workQueue([c], NOW, { autopilot: none })[0]!.triedSummary).toMatch(/No hay un canal/);
  });
});

// ── Channels ────────────────────────────────────────────────────────────

describe("autopilot: channels — WhatsApp first, then email, never SMS", () => {
  const contact = { phone: "+17135550100", email: "rosa@ejemplo.com", lastInboundAt: null };
  it("plain text inside the client's 24-hour window, an approved template outside it", () => {
    expect(chooseChannel({ ...contact, lastInboundAt: ago(0, 3) }, "credalti_acuerdo_1", { ...ON.channels, approvedTemplates: [] }, NOW)).toEqual({ channel: "whatsapp", mode: "text" });
    expect(chooseChannel(contact, "credalti_acuerdo_1", { ...ON.channels, approvedTemplates: ["credalti_acuerdo_1"] }, NOW)).toEqual({ channel: "whatsapp", mode: "template" });
  });

  it("an unapproved template never goes on WhatsApp outside the window: email instead, or nothing", () => {
    const noTemplates = { ...ON.channels, approvedTemplates: [] as string[] };
    expect(chooseChannel(contact, "credalti_acuerdo_1", noTemplates, NOW)).toEqual({ channel: "email" });
    expect(chooseChannel({ ...contact, email: null }, "credalti_acuerdo_1", noTemplates, NOW)).toEqual({ channel: null, reason: "template_not_approved" });
    expect(chooseChannel({ ...contact, email: null }, "x", { ...noTemplates, whatsapp: false }, NOW)).toEqual({ channel: null, reason: "no_channel" });
  });

  it("SMS is never a channel for automatic messages: only login codes use it", () => {
    expect(CHANNELS).toEqual(["whatsapp", "email"]);
    expect((CHANNELS as readonly string[]).includes("sms")).toBe(false);
    // Twilio settings do not turn anything on.
    const env = availabilityFromEnv({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "x", TWILIO_FROM_NUMBER: "+15555550100" });
    expect(env).toEqual({ whatsapp: false, email: false, approvedTemplates: [], simulated: false });
    expect(Object.keys(env)).not.toContain("sms");
    // No autopilot or integration file sends a text message.
    const files = [...sourceFiles("src/lib/autopilot"), ...sourceFiles("src/lib/integrations"), "src/app/api/cron/autopilot/route.ts"];
    for (const file of files) {
      const text = readFileSync(file, "utf8").replace(/\/\/.*$/gm, "");
      expect(text, file).not.toMatch(/twilio|api\.twilio|\/Messages\.json|sendSms|sms:/i);
    }
    expect(readdirSync("src/lib/integrations").some((f) => /sms|twilio/i.test(f))).toBe(false);
    // The database refuses an SMS channel.
    expect(readFileSync("supabase/migrations/0015_autopilot.sql", "utf8")).toMatch(/channel in \('whatsapp', 'email'\)\)/);
  });

  it("email is available only with an unsubscribe link and the company's postal address (CAN-SPAM)", () => {
    const full = { EMAIL_API_KEY: "k", EMAIL_FROM: "hola@credalti.test", NEXT_PUBLIC_COMPANY_ADDRESS: "1 Main St, Houston, TX", UNSUBSCRIBE_SECRET: "s", NEXT_PUBLIC_APP_URL: "https://app.test" };
    expect(availabilityFromEnv(full).email).toBe(true);
    for (const key of Object.keys(full)) expect(availabilityFromEnv({ ...full, [key]: undefined }).email, key).toBe(false);
    const body = emailBody({ text: "Hola Rosa.", unsubscribeUrl: "https://app.test/baja?u=1&t=2", postalAddress: "1 Main St, Houston, TX" });
    expect(body).toContain("1 Main St, Houston, TX");
    expect(body).toContain("https://app.test/baja?u=1&t=2");
  });

  it("the unsubscribe link is signed: someone else's id does not unsubscribe them", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const token = unsubscribeToken(id, "secret");
    expect(verifyUnsubscribeToken(id, token, "secret")).toBe(true);
    expect(verifyUnsubscribeToken("00000000-0000-4000-8000-000000000002", token, "secret")).toBe(false);
    expect(verifyUnsubscribeToken(id, token, undefined)).toBe(false);
    expect(unsubscribeUrl(id, { NEXT_PUBLIC_APP_URL: "https://app.test/", UNSUBSCRIBE_SECRET: "secret" })).toBe(`https://app.test/baja?u=${id}&t=${token}`);
    expect(unsubscribeUrl(id, {})).toBeNull();
  });
});

// ── Quiet hours, cap, opt-out ──────────────────────────────────────────

describe("autopilot: quiet hours, the daily cap and opt-out", () => {
  it("the client's clock: Texas by default; quiet from 9 p.m. to 8 a.m.", () => {
    expect(clientTimeZone("TX")).toBe("America/Chicago");
    expect(clientTimeZone(null)).toBe("America/Chicago");
    expect(clientTimeZone("CA")).toBe("America/Los_Angeles");
    const q = DEFAULT_AUTOPILOT;
    expect(isQuietHour(new Date("2026-12-06T02:30:00Z"), "America/Chicago", q)).toBe(false); // 8:30 p.m.
    expect(localHour(new Date("2026-12-06T02:30:00Z"), "America/Chicago")).toBe(20);
    expect(isQuietHour(new Date("2026-12-06T03:00:00Z"), "America/Chicago", q)).toBe(true); // 9 p.m.
    expect(isQuietHour(new Date("2026-12-06T13:59:00Z"), "America/Chicago", q)).toBe(true); // 7:59 a.m.
    expect(isQuietHour(new Date("2026-12-06T14:00:00Z"), "America/Chicago", q)).toBe(false); // 8 a.m.
    expect(nextAllowedTime(new Date("2026-12-06T04:17:00Z"), "America/Chicago", q).toISOString()).toBe("2026-12-06T14:00:00.000Z");
    expect(nextAllowedTime(NOW, "America/Chicago", q)).toEqual(NOW);
  });

  it("nothing goes in quiet hours; it waits", () => {
    const c = client({ signedUpAt: ago(1, 2) });
    const night = new Date("2026-12-06T04:00:00Z"); // 10 p.m. in Texas
    const plan = planDeliveries(c, night, ON);
    expect(plan.send).toEqual([]);
    expect(plan.waiting).toEqual(["quiet_hours"]);
    expect(planDeliveries(c, NOW, ON).send.map((m) => m.topic)).toEqual(["agreement_unsigned"]);
  });

  it("at most the daily cap per local day, status messages first", () => {
    const c = client({ signedUpAt: ago(1, 2) });
    const queued = (n: number): OutboundMessage => ({
      ...sent(c, "x", 1, ago(0, n)),
      id: `q${n}`,
      dedupeKey: `status:${c.id}:letters_mailed:r${n}`,
      kind: "status",
      topic: "letters_mailed",
      step: null,
      channel: null,
      template: "credalti_cartas_enviadas",
      params: ["Rosa", "la carta", String(n), "/rounds"],
      status: "queued",
      sentAt: null,
    });
    const withQueue = { ...c, outbound: [queued(3), queued(2)] };
    const plan = planDeliveries(withQueue, NOW, ON);
    expect(plan.send.map((m) => m.kind)).toEqual(["status", "status"]);
    expect(plan.waiting).toContain("daily_cap");
    // One already sent today: room for one.
    const today = { ...withQueue, outbound: [...withQueue.outbound, sent(c, "y:1", 1, ago(0, 2))] };
    expect(sentToday(today, NOW)).toBe(1);
    expect(planDeliveries(today, NOW, ON).send).toHaveLength(1);
  });

  it("an opted-out client gets nothing, and what was queued is cancelled", () => {
    const c = client({ signedUpAt: ago(1, 2), optOut: { at: ago(0, 5), keyword: "STOP", channel: "whatsapp" } });
    const withQueue = { ...c, outbound: [{ ...sent(c, "x", 1, ago(0, 1)), id: "q1", kind: "status" as const, step: null, status: "queued" as const, sentAt: null }] };
    const plan = planDeliveries(withQueue, NOW, ON);
    expect(plan.send).toEqual([]);
    expect(plan.cancel).toEqual([{ id: "q1", note: "opted_out" }]);
  });

  it("a hold stops reminders, not status messages; old status messages expire", () => {
    const c = client({ signedUpAt: ago(1, 2), holds: [{ id: "h", at: ago(0, 1), by: "carmen", reason: "Lo llamo yo" }] });
    expect(planDeliveries(c, NOW, ON).send).toEqual([]);
    const old = { ...sent(c, "x", 1, ago(4)), id: "q-old", kind: "status" as const, step: null, status: "queued" as const, sentAt: null, template: "credalti_cartas_enviadas" };
    expect(planDeliveries({ ...c, outbound: [old] }, NOW, ON).cancel).toEqual([{ id: "q-old", note: "expired" }]);
  });

  it("BAJA / STOP only when it is the whole message; ALTA / START bring them back", () => {
    for (const text of ["BAJA", "baja", " Baja. ", "STOP", "stop!", "No más", "Opt out", "CANCELAR"]) expect(parseOptKeyword(text)?.kind, text).toBe("opt_out");
    for (const text of ["ALTA", "start", "Start."]) expect(parseOptKeyword(text)?.kind, text).toBe("opt_in");
    for (const text of ["no puedo parar de pensar en esto", "stop by tomorrow", "¿cómo me doy de baja del monitoreo?", "sí", "yes"]) expect(parseOptKeyword(text), text).toBeNull();
    expect(OPT_OUT_WORDS).toContain("BAJA");
    expect(currentOptOut([{ kind: "opt_out", at: ago(3) }, { kind: "opt_in", at: ago(1) }])).toBeNull();
    expect(currentOptOut([{ kind: "opt_in", at: ago(3) }, { kind: "opt_out", at: ago(1) }])?.at).toBe(ago(1));
    for (const kind of ["opt_out", "opt_in"] as const) for (const locale of ["es", "en"] as const) expect(checkClaimGuardrails(optReply(kind, locale))).toEqual([]);
  });
});

// ── The words ───────────────────────────────────────────────────────────

describe("autopilot: every automatic message passes the claim rules", () => {
  const filled = (params: readonly string[]) => params.map((p, i) => (p === "enlace" ? "https://app.credalti.test/acuerdo" : i === 0 ? "Rosa" : "3"));

  it("each template, in Spanish and English: no promise, no score, no pressure; says it is automatic and how to stop", () => {
    expect(ALL_TEMPLATES.length).toBe(24);
    expect(new Set(ALL_TEMPLATES.map((t) => t.name)).size).toBe(ALL_TEMPLATES.length);
    for (const t of ALL_TEMPLATES) {
      expect(t.name).toMatch(/^credalti_[a-z_0-9]+$/);
      for (const locale of ["es", "en"] as const) {
        const text = renderTemplate(t, locale, filled(t.params));
        expect(checkClaimGuardrails(text), `${t.name} ${locale}`).toEqual([]);
        expect(checkMarketingCopy(text), `${t.name} ${locale}`).toEqual([]);
        expect(text).not.toMatch(/puntaje|score|puntos? de cr[eé]dito|garantiz|guarantee|últim[ao] oportunidad|urgente|hoy mismo|last chance|act now/i);
        expect(text.endsWith(FOOTER[locale])).toBe(true);
        // Every parameter is used, in order of appearance or not, and nothing is left unfilled.
        for (let n = 1; n <= t.params.length; n += 1) expect(t.body[locale], `${t.name} {{${n}}}`).toContain(`{{${n}}}`);
        expect(text).not.toMatch(/\{\{\d+\}\}/);
      }
    }
    // The AI assistant is named as AI wherever he is mentioned.
    expect(FOLLOWUP_TEMPLATES.review_unfinished[0].body.es).toMatch(/asistente con IA/);
  });

  it("status messages: only facts; 'ya no aparece en tu reporte' always with 'los resultados varían'", () => {
    const events: StatusEvent[] = [
      { kind: "letters_mailed", roundNumber: 1, letterCount: 1 },
      { kind: "letters_mailed", roundNumber: 2, letterCount: 4 },
      { kind: "certified_delivered", letterId: "l1", recipient: "Equifax Information Services LLC", deliveredAt: ago(1) },
      { kind: "report_changes", pullId: "p1", goneCount: 0 },
      { kind: "report_changes", pullId: "p2", goneCount: 1 },
      { kind: "report_changes", pullId: "p3", goneCount: 3 },
      { kind: "next_round_prepared", roundNumber: 2, planKey: "pabcdef013" },
      { kind: "payment_receipt", chargeId: "ch1", receiptNumber: "R-CH1", amount: "$89.00", date: { es: "4 de diciembre de 2026", en: "December 4, 2026" }, work: { es: "Ronda 1: 3 cartas enviadas", en: "Round 1: 3 letters mailed" } },
    ];
    for (const event of events) {
      for (const locale of ["es", "en"] as const) {
        const m = statusMessage("u1", "Rosa", locale, event, "https://app.credalti.test");
        expect(checkClaimGuardrails(m.body), `${event.kind} ${locale}`).toEqual([]);
        expect(checkMarketingCopy(m.body), `${event.kind} ${locale}`).toEqual([]);
        expect(m.body).not.toMatch(/puntaje|score|🎉|buenas noticias|good news/i);
        expect(m.link.startsWith("https://app.credalti.test/")).toBe(true);
      }
    }
    const gone = statusMessage("u1", "Rosa", "es", events[5]!);
    expect(gone.body).toContain("3 de los puntos que nos indicaste ya no aparecen en tu reporte");
    expect(gone.body).toContain("Los resultados varían");
    expect(statusMessage("u1", "Rosa", "es", events[3]!).template.name).toBe(STATUS_TEMPLATES.report_new.name);
    // Once per fact.
    expect(statusMessage("u1", "Rosa", "es", events[0]!).dedupeKey).toBe("status:u1:letters_mailed:r1");
    expect(appLink("/rounds", "https://app.test/")).toBe("https://app.test/rounds");
  });

  it("the demo's messages pass too, in the client's language", () => {
    const clients = buildDemoClients(NOW);
    const all = clients.flatMap((c) => c.outbound ?? []);
    expect(all.length).toBeGreaterThan(20);
    for (const m of all) expect(checkClaimGuardrails(m.body), m.dedupeKey).toEqual([]);
    expect(all.filter((m) => m.locale === "en").length).toBeGreaterThan(0);
  });
});

// ── Automatic sending ───────────────────────────────────────────────────

describe("autopilot: automatic sending", () => {
  const round = { number: 1, status: "ready", mailedAt: null, respondedAt: null, letters: [] } as StaffRound;
  const c = client();
  it("off by default; a hold stops it; the review window counts from when the round was first seen ready", () => {
    expect(autoSendState(c, round, NOW, DEFAULT_AUTOPILOT).status).toBe("off");
    const on = { ...DEFAULT_AUTOPILOT, roundsEnabled: true };
    expect(autoSendState({ ...c, holds: [{ id: "h", at: ago(0, 1), by: "carmen", reason: "Revisa una carta" }] }, { ...round, readyAt: ago(3) }, NOW, on)).toMatchObject({
      status: "held",
      text: "Detenida por carmen: «Revisa una carta»",
    });
    expect(autoSendState(c, { ...round, readyAt: ago(0, 20) }, NOW, on)).toMatchObject({ status: "waiting", at: new Date(NOW.getTime() + 4 * HOUR - 0).toISOString() });
    expect(autoSendState(c, { ...round, readyAt: ago(0, 20) }, NOW, on).text).toMatch(/^Sale sola hoy a las 4:00/);
    expect(autoSendState(c, { ...round, readyAt: ago(1, 1) }, NOW, on).status).toBe("due");
    // Never seen yet: the window starts now.
    expect(autoSendState(c, round, NOW, on).status).toBe("waiting");
    // A released hold no longer holds.
    expect(autoSendState({ ...c, holds: [{ id: "h", at: ago(2), by: "carmen", reason: "x", releasedAt: ago(1), releasedBy: "carmen" }] }, { ...round, readyAt: ago(2) }, NOW, on).status).toBe("due");
  });

  it("different letters are a different round to review", () => {
    const demo = buildDemoClients(NOW);
    const ready = demo.flatMap((d) => d.rounds.filter((r) => r.status === "ready"));
    const keys = ready.map(roundPlanKey);
    for (const key of keys) expect(key).toMatch(/^p[0-9a-f]{8}[0-9]{1,3}$/);
    expect(roundPlanKey(ready[0]!)).toBe(roundPlanKey(structuredClone(ready[0]!)));
    expect(roundPlanKey({ letters: ready[0]!.letters.slice(1) })).not.toBe(roundPlanKey(ready[0]!));
  });

  it("the send module is reused unchanged, and every gate stays in it", () => {
    const server = readFileSync("src/lib/autopilot/server.ts", "utf8");
    expect(server).toMatch(/import \{ sendRound, type SendRoundOptions, type SendRoundResult \} from "\.\.\/rounds\/send"/);
    expect(server).toMatch(/requireAgreement: true/);
    expect(server).toMatch(/sendableRound\(client, now, \{ furnishers \}\)/);
    expect(server).not.toMatch(/mailLetter|from\("letters"\)\.insert/);
  });
});

// ── The queue and the demo ──────────────────────────────────────────────

describe("autopilot: the one-person work queue", () => {
  const later = new Date(NOW.getTime() + 5 * 60 * 1000);
  const demo = demoClientsWithMail(buildDemoClients(NOW), NOW);
  const env: AutopilotEnv = { settings: DEMO_SETTINGS, channels: DEMO_CHANNELS };
  const queue = workQueue(demo, later, { furnishers: seededBook(), autopilot: env });

  it("shrinks the demo's list to what only a person can decide (12 notices → 8)", () => {
    const raw = demo.flatMap((c) => clientExceptions(c, later, { furnishers: seededBook() }).map((e) => ({ ...e, id: `${c.id}:${e.key}` })));
    expect(raw).toHaveLength(12);
    expect(queue).toHaveLength(8);
    expect(queue.map((i) => i.exception.kind).sort()).toEqual(
      ["agreement_unsigned", "furnisher_address_missing", "identity_theft_report_missing", "letter_returned", "payment_past_due", "question_waiting", "response_overdue", "service_end_requested"].sort(),
    );
    // Left to the system: documents, a review, monitoring, a payment method.
    const off = raw.filter((e) => !queue.some((i) => i.id === e.id)).map((e) => e.kind).sort();
    expect(off).toEqual(["documents_missing", "payment_method_missing", "report_stale", "review_stalled"]);
  });

  it("each item says why, what the system tried, minutes, waiting time and a due time; overdue first", () => {
    for (const item of queue) {
      expect(item.why.length).toBeGreaterThan(20);
      expect(item.minutes).toBe(MINUTES_BY_KIND[item.exception.kind]);
      expect(item.exception.severity).toBe(SEVERITY_BY_KIND[item.exception.kind]);
      expect(new Date(item.dueBy).getTime()).toBeGreaterThan(new Date(item.since).getTime());
      expect(item.action.href.length).toBeGreaterThan(3);
    }
    const firstNotOverdue = queue.findIndex((i) => !i.overdue);
    if (firstNotOverdue >= 0) expect(queue.slice(firstNotOverdue).every((i) => !i.overdue)).toBe(true);
    const yolanda = queue.find((i) => i.client.id === "c02")!;
    expect(yolanda.triedSummary).toBe("Se le escribió 3 veces sin respuesta.");
    const heriberto = queue.find((i) => i.client.id === "c12")!;
    expect(heriberto.triedSummary).toMatch(/BAJA/);
    const dolores = queue.find((i) => i.client.id === "c16")!;
    expect(dolores.tried.length).toBeGreaterThan(0);
    expect(workSummary(queue)).toEqual({ count: 8, minutes: queue.reduce((n, i) => n + i.minutes, 0), overdue: queue.filter((i) => i.overdue).length });
  });

  it("a role sees only its own kinds of notice", () => {
    const sales = workQueue(demo, later, { furnishers: seededBook(), autopilot: env }, "sales");
    expect(sales.every((i) => ["agreement_unsigned", "documents_missing"].includes(i.exception.kind))).toBe(true);
  });

  it("the demo shows the system's work: messages, a hold, an opt-out, a round it mailed itself", () => {
    const by = (id: string) => demo.find((c) => c.id === id)!;
    expect(by("c02").outbound!.filter((m) => m.kind === "followup")).toHaveLength(3);
    expect(by("c08").holds?.[0]?.by).toBe("carmen");
    expect(by("c12").optOut?.keyword).toBe("BAJA");
    expect(by("c12").outbound!.every((m) => (m.sentAt ?? "") <= by("c12").optOut!.at)).toBe(true);
    expect(by("c21").rounds[0]!.sentBy).toBe("sistema");
    // Every simulated message went at an allowed hour on the client's clock.
    for (const c of demo) for (const m of c.outbound ?? []) expect(isQuietHour(new Date(m.sentAt!), clientTimeZone(c.state), DEMO_SETTINGS), m.dedupeKey).toBe(false);
    // And the log shows it as the system.
    const members = buildDemoTeam(NOW).members;
    expect(clientActivity(by("c02"), members).filter((e) => e.type === "auto_message").every((e) => e.actor === "system")).toBe(true);
    expect(clientActivity(by("c21"), members).find((e) => e.type === "round_sent")).toMatchObject({ actor: "system", text: expect.stringMatching(/^El sistema envió la ronda 1/) });
    expect(activityFeed(demo, members).some((e) => e.type === "autopilot_hold" && e.actor === "carmen")).toBe(true);
  });

  it("holds and opt-outs a person records in the demo are applied over the invented clients", () => {
    const after = applyAutopilotDemoActions(demo, {
      ...EMPTY_AUTOPILOT_ACTIONS,
      holds: { c08: { kind: "release", at: later.toISOString(), by: "marta" }, c07: { kind: "hold", at: later.toISOString(), by: "marta", reason: "Pidió esperar" } },
      optOuts: { c12: { kind: "opt_in", at: later.toISOString(), by: "carmen" } },
    });
    const by = (id: string) => after.find((c) => c.id === id)!;
    expect(by("c08").holds![0]!.releasedBy).toBe("marta");
    expect(by("c07").holds!.at(-1)).toMatchObject({ by: "marta", reason: "Pidió esperar" });
    expect(by("c12").optOut).toBeNull();
    expect(applyAutopilotDemoActions(demo, EMPTY_AUTOPILOT_ACTIONS)).toEqual(demo);
  });

  it("the business dashboard: minutes of a person's work per active client, defined plainly", () => {
    expect(METRIC_INFO.humanMinutesPerActive.label).toBe("Minutos de trabajo humano por cliente activo");
    expect(METRIC_INFO.humanMinutesPerActive.definition).toMatch(/minutos estimados/);
    const members = buildDemoTeam(NOW).members;
    const withAutopilot = businessMetrics(demo, members, "month", later, env);
    const without = businessMetrics(demo, members, "month", later);
    expect(withAutopilot.work.humanMinutes).toBeGreaterThan(0);
    expect(withAutopilot.work.humanMinutes).toBeLessThan(without.work.humanMinutes);
    expect(withAutopilot.work.humanMinutesPerActive).toBeCloseTo(withAutopilot.work.humanMinutes / withAutopilot.clients.active, 6);
  });
});

describe("autopilot: settings", () => {
  it("start off; values out of range fall back to the defaults", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_AUTOPILOT);
    expect(normalizeSettings({ reviewWindowHours: 0, dailyCap: 9, quietStartHour: 30 })).toMatchObject({ reviewWindowHours: 24, dailyCap: 2, quietStartHour: 21 });
    expect(normalizeSettings({ followups: { review_unfinished: false } as never }).followups).toMatchObject({ review_unfinished: false, agreement_unsigned: true });
  });

  it("the migration starts every new automatic action off and keeps the records append-only", () => {
    const sql = readFileSync("supabase/migrations/0015_autopilot.sql", "utf8");
    expect(sql).toMatch(/rounds_enabled boolean not null default false/);
    expect(sql).toMatch(/followups_enabled boolean not null default false/);
    expect(sql).toMatch(/dedupe_key text not null unique/);
    expect(sql).not.toMatch(/for (insert|update|delete|all)/i);
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}
