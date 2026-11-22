import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { DEMO_CHANNELS, DEMO_SETTINGS } from "../autopilot/demo";
import { workQueue, workSummary } from "../autopilot/queue";
import { DEFAULT_AUTOPILOT, type AutopilotEnv } from "../autopilot/types";
import { checkClaimGuardrails } from "../compliance/guardrails";
import { seededBook } from "../mail/data";
import { demoClientsWithMail } from "../mail/demo";
import { withDemoPulses } from "../pulse/demo";
import {
  ALTIBOT_MIN_OVERLAP,
  answerFromRow,
  answerProblems,
  bestMatch,
  DEMO_SAVED_ANSWERS,
  keyWords,
  libraryReplyFor,
  libraryReplyText,
  mayChange,
  similarity,
  statusOnSave,
  type SavedAnswer,
} from "../staff/answers";
import { checkStaffReply } from "../staff/conversation";
import { buildDemoClients } from "../staff/demoClients";
import { DIGEST_TEMPLATE, DIGEST_TEMPLATE_BODY, digestChannel, digestDue, morningSummary, shortClientName } from "../staff/digest";
import {
  conversationLines,
  DRAFT_SYSTEM_PROMPT,
  draftFacts,
  draftProblems,
  draftReply,
  draftUserMessage,
  NO_KEY_MESSAGE,
  questionToAnswer,
  type DraftCall,
  type DraftCaller,
} from "../staff/drafts";
import { businessMetrics, METRIC_INFO } from "../staff/metrics";
import { can, CAPABILITIES, ROLE_PERMISSIONS } from "../staff/permissions";
import { HOUSE_RULES, helpForPath, NEW_HIRE_CHECKLIST, PLAYBOOK, SCREEN_HELP, TOUR_STEPS } from "../staff/playbook";
import { applyPreferencesUpdate, DEFAULT_PREFERENCES, formatDigestTime, normalizePreferences, preferencesFromRow, preferencesUpdateSchema } from "../staff/preferences";
import { EXCEPTION_KINDS } from "../staff/stage";
import { buildDemoTeam } from "../staff/team";
import type { StaffClient } from "../staff/types";

// The one-person console (docs/STAFF.md): AltiBot's drafts, saved answers,
// the «Cómo se resuelve» cards, the morning summary and the pulse on the
// dashboard. The database side is in db/staffAssist.test.ts.

// 9:00 a.m. in Texas, Monday 7 December 2026.
const NOW = new Date("2026-12-07T15:00:00.000Z");
const demoClients = () => withDemoPulses(demoClientsWithMail(buildDemoClients(NOW), NOW), NOW);
const itzel = () => demoClients().find((c) => c.id === "c04")!;
const ADMIN = { handle: "carmen", name: "Carmen Ruiz", role: "admin" as const };
const MARTA = { handle: "marta", name: "Marta Leal", role: "specialist" as const };
const ANA = { handle: "ana", name: "Ana Prieto", role: "sales" as const };

// ── «Cómo se resuelve» ──────────────────────────────────────────────────

describe("playbook cards", () => {
  it("every kind of notice in the queue has a card of 3 to 5 steps and a «Hecho cuando…» line", () => {
    expect(Object.keys(PLAYBOOK).sort()).toEqual([...EXCEPTION_KINDS].sort());
    for (const kind of EXCEPTION_KINDS) {
      const card = PLAYBOOK[kind];
      expect(card.steps.length, kind).toBeGreaterThanOrEqual(3);
      expect(card.steps.length, kind).toBeLessThanOrEqual(5);
      expect(card.doneWhen.length, kind).toBeGreaterThan(15);
      for (const step of card.steps) expect(step.length, `${kind}: ${step}`).toBeLessThan(260);
    }
  });

  it("promises nothing and never tells the client what to mark", () => {
    for (const card of Object.values(PLAYBOOK)) {
      for (const line of [...card.steps, card.doneWhen]) expect(checkClaimGuardrails(line), line).toEqual([]);
    }
    for (const line of HOUSE_RULES) expect(checkClaimGuardrails(line), line).toEqual([]);
    // The cards that touch the client's answers say whose they are.
    expect(PLAYBOOK.question_waiting.steps.join(" ")).toMatch(/la decisión es suya/);
    expect(PLAYBOOK.review_stalled.steps.join(" ")).toMatch(/nunca qué marcar/);
    // Money is never collected by hand, and cards are never asked for on the phone.
    expect(PLAYBOOK.payment_past_due.steps.join(" ")).toMatch(/Nadie cobra a mano/);
    expect(PLAYBOOK.payment_method_missing.steps.join(" ")).toMatch(/Nunca la pidas/);
  });

  it("is written from what the app does: the gates it mentions are the real ones", () => {
    expect(PLAYBOOK.report_stale.steps[0]).toMatch(/45 días/);
    expect(PLAYBOOK.report_stale.steps[0]).toMatch(/no sale ninguna carta/);
    expect(PLAYBOOK.identity_theft_report_missing.steps.join(" ")).toMatch(/IdentityTheft\.gov/);
    expect(PLAYBOOK.furnisher_address_missing.doneWhen).toMatch(/Listas para enviar/);
  });

  it("every staff screen has help, and its cards are real kinds", () => {
    for (const path of ["/equipo", "/equipo/clientes", "/equipo/clientes/c04", "/equipo/respuestas", "/equipo/enviar", "/equipo/perfil", "/equipo/negocio", "/equipo/cartas"]) {
      expect(helpForPath(path).title.length, path).toBeGreaterThan(3);
    }
    expect(helpForPath("/equipo/clientes/c04").title).toBe("El caso de un cliente");
    expect(helpForPath("/equipo/clientes").title).toBe("Clientes");
    expect(helpForPath("/equipo").playbooks).toHaveLength(EXCEPTION_KINDS.length);
    for (const help of Object.values(SCREEN_HELP)) for (const kind of help.playbooks) expect(EXCEPTION_KINDS).toContain(kind);
  });

  it("the first-day checklist covers the screens, the tour and the rules; the tour has five steps", () => {
    expect(NEW_HIRE_CHECKLIST.map((i) => i.id)).toEqual(["screens", "tour", "rules", "playbook", "summary"]);
    expect(TOUR_STEPS).toHaveLength(5);
    expect(HOUSE_RULES.join(" ")).toMatch(/No prometas/);
    expect(HOUSE_RULES.join(" ")).toMatch(/qué marcar/);
    expect(HOUSE_RULES.join(" ")).toMatch(/No vendas por teléfono/);
  });
});

// ── Permissions ─────────────────────────────────────────────────────────

describe("the letters capability", () => {
  it("is decided for every role, and only an administrator edits templates", () => {
    expect(CAPABILITIES).toContain("letters.edit");
    expect(can("admin", "letters.edit")).toBe(true);
    expect(can("specialist", "letters.edit")).toBe(false);
    expect(can("sales", "letters.edit")).toBe(false);
    expect(ROLE_PERMISSIONS.specialist.can["letters.edit"]).toBe(false);
  });

  it("the console's frame lists «Cartas» behind it", () => {
    const shell = readFileSync("src/components/staff/StaffShell.tsx", "utf8");
    expect(shell).toMatch(/href: "\/equipo\/cartas", label: "Cartas", icon: "clipboard", needs: "letters\.edit"/);
  });
});

// ── Saved answers ───────────────────────────────────────────────────────

const approved = (question: string, answer: string, extra: Partial<SavedAnswer> = {}): SavedAnswer => ({
  id: "00000000-0000-4000-a000-0000000000aa",
  question,
  answer,
  status: "approved",
  createdBy: "marta",
  createdAt: NOW.toISOString(),
  approvedBy: "carmen",
  approvedAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  ...extra,
});

describe("saved answers: similarity", () => {
  it("compares meaningful words, without accents, plurals or small words", () => {
    expect([...keyWords("¿Cuándo salen mis cartas?")]).toEqual(["cuand", "salen", "carta"]);
    expect(similarity("¿Cuándo salen mis cartas?", "cuando salen las cartas").score).toBe(1);
    expect(similarity("¿Cuándo salen mis cartas?", "¿Qué es una consulta dura?").score).toBe(0);
    expect(similarity("hola", "hola").score).toBe(0);
  });

  it("suggests the closest approved answer, never a proposal", () => {
    const match = bestMatch("¿Cuándo van a salir mis cartas?", DEMO_SAVED_ANSWERS);
    expect(match?.answer.question).toBe("¿Cuándo salen mis cartas?");
    expect(bestMatch("¿Puedo usar mi ITIN para el monitoreo?", DEMO_SAVED_ANSWERS)).toBeNull();
    expect(bestMatch("¿Qué es una cuenta de cobranza médica?", DEMO_SAVED_ANSWERS)).toBeNull();
  });
});

describe("saved answers: what AltiBot may send by itself", () => {
  it("only an approved answer, only a close match", () => {
    const library = DEMO_SAVED_ANSWERS;
    expect(libraryReplyFor("¿Cuánto tardan los burós en responder a mis cartas?", library)?.answer.id).toBe("00000000-0000-4000-a000-000000000002");
    // The proposal about the ITIN is never sent, however close.
    expect(libraryReplyFor("¿Puedo activar el monitoreo con mi ITIN?", library)).toBeNull();
    // A loose match is a suggestion for a person, not an answer for AltiBot: it shares words, not the question.
    const loose = bestMatch("¿Las cartas salen por correo certificado?", library);
    expect(loose?.answer.question).toBe("¿Cuándo salen mis cartas?");
    expect(loose!.overlap).toBeLessThan(ALTIBOT_MIN_OVERLAP);
    expect(libraryReplyFor("¿Las cartas salen por correo certificado?", library)).toBeNull();
    // The same question, worded a little differently, is answered.
    expect(libraryReplyFor("cuando salen mis cartas", library)?.answer.id).toBe("00000000-0000-4000-a000-000000000001");
  });

  it("checks the claim rules again when it is used: an approved answer that breaks one is not sent", () => {
    const bad = approved("¿Cuándo salen mis cartas?", "Salen esta semana y eliminamos lo negativo de tu reporte en 30 días.");
    expect(libraryReplyFor("¿Cuándo salen mis cartas?", [bad])).toBeNull();
    const unapproved = approved("¿Cuándo salen mis cartas?", DEMO_SAVED_ANSWERS[0]!.answer, { status: "proposed", approvedBy: null, approvedAt: null });
    expect(libraryReplyFor("¿Cuándo salen mis cartas?", [unapproved])).toBeNull();
  });

  it("is sent marked as the team's approved answer, and passes the rules as sent", () => {
    const match = libraryReplyFor("¿Cuándo salen mis cartas?", DEMO_SAVED_ANSWERS)!;
    const text = libraryReplyText(match);
    expect(text).toMatch(/Respuesta aprobada por el equipo de Credalti/);
    expect(checkClaimGuardrails(text)).toEqual([]);
  });
});

describe("saved answers: what may be saved, and who decides", () => {
  it("every demo answer passes the rules", () => {
    for (const a of DEMO_SAVED_ANSWERS) expect(answerProblems(a), a.question).toEqual([]);
  });

  it("refuses a promise, the client's name, an amount, or a long number", () => {
    const q = "¿Cuándo salen mis cartas?";
    expect(answerProblems({ question: q, answer: "Te subimos el puntaje en 30 días." }).length).toBeGreaterThan(0);
    expect(answerProblems({ question: q, answer: "Hola Itzel, tus cartas salen pronto." }, "Itzel").map((p) => p.phrase)).toContain("Itzel");
    expect(answerProblems({ question: q, answer: "El plan cuesta $89 al mes y se cobra después." }).length).toBeGreaterThan(0);
    expect(answerProblems({ question: q, answer: "Tu cuenta 4417123456 está en revisión con el buró." }).length).toBeGreaterThan(0);
    expect(answerProblems({ question: q, answer: "Escríbenos a equipo@credalti.com para cualquier duda." }).length).toBeGreaterThan(0);
  });

  it("an administrator's goes in approved, a specialist's as a proposal, sales cannot", () => {
    expect(statusOnSave("admin")).toBe("approved");
    expect(statusOnSave("specialist")).toBe("proposed");
    expect(statusOnSave("sales")).toBeNull();
  });

  it("only an administrator approves; a specialist edits or withdraws only their own proposal", () => {
    const proposal = { status: "proposed" as const, createdBy: "marta" };
    const live = { status: "approved" as const, createdBy: "marta" };
    expect(mayChange("admin", "carmen", live, "edit")).toBe(true);
    expect(mayChange("admin", "carmen", proposal, "approve")).toBe(true);
    expect(mayChange("specialist", "marta", proposal, "approve")).toBe(false);
    expect(mayChange("specialist", "marta", proposal, "edit")).toBe(true);
    expect(mayChange("specialist", "marta", proposal, "delete")).toBe(true);
    expect(mayChange("specialist", "jorge", proposal, "edit")).toBe(false);
    expect(mayChange("specialist", "marta", live, "edit")).toBe(false);
    expect(mayChange("specialist", "marta", live, "delete")).toBe(false);
    expect(mayChange("sales", "ana", proposal, "edit")).toBe(false);
  });

  it("reads a database row", () => {
    const row = { id: "x1", question: "¿Cuándo salen mis cartas?", answer: "Pronto, en cuanto termines.", status: "approved", created_by_name: "carmen", created_at: NOW.toISOString(), approved_by_name: "carmen", approved_at: NOW.toISOString(), updated_at: NOW.toISOString() };
    expect(answerFromRow(row)).toMatchObject({ status: "approved", approvedBy: "carmen", createdBy: "carmen" });
    expect(answerFromRow({ ...row, status: "deleted" })).toBeNull();
  });
});

// ── AltiBot's drafts ────────────────────────────────────────────────────

/** A caller that returns these replies in order and records what it was sent. */
function scripted(replies: Array<string | null>, problem: string | null = null): DraftCaller & { calls: DraftCall[] } {
  const calls: DraftCall[] = [];
  const caller = vi.fn(async (call: DraftCall) => {
    calls.push(call);
    const reply = replies[calls.length - 1] ?? null;
    return { reply, problem: reply ? null : (problem ?? "empty") };
  });
  return Object.assign(caller, { calls });
}

describe("drafts: what the model is given", () => {
  it("the question is the one AltiBot passed to the team", () => {
    expect(questionToAnswer(itzel())).toMatch(/ITIN/);
    // Nothing waiting and the client was answered last: nothing to draft.
    const answered = { ...itzel(), questions: [], conversation: [...itzel().conversation!, { id: "x", at: NOW.toISOString(), role: "assistant" as const, source: "human" as const, authorName: "Marta", text: "Te escribo hoy." }] };
    expect(questionToAnswer(answered)).toBeNull();
  });

  it("admins and specialists get the case facts; sales gets no draft at all", () => {
    expect(draftFacts(itzel(), "admin", NOW)).not.toBeNull();
    expect(draftFacts(itzel(), "specialist", NOW)).not.toBeNull();
    expect(draftFacts(itzel(), "sales", NOW)).toBeNull();
    expect(draftFacts(itzel(), null, NOW)).toBeNull();
  });

  it("includes stage, agreement, documents, review, rounds and billing standing, never an amount", () => {
    const withRounds = demoClients().find((c) => c.rounds.some((r) => r.mailedAt) && c.billing.charges.length > 0)!;
    const facts = draftFacts(withRounds, "admin", NOW)!;
    expect(facts.stage.length).toBeGreaterThan(3);
    expect(facts.agreement).toMatch(/Vigente|periodo|Sin firmar|Cancelado|Recibió/);
    expect(facts.rounds.length).toBeGreaterThan(0);
    expect(facts.rounds[0]!.letters.length).toBeGreaterThan(0);
    expect(facts.billing).toMatch(/cobr/);
    const text = draftUserMessage({ facts, question: "¿Cuándo me cobran?", conversation: conversationLines(withRounds) });
    expect(text).not.toMatch(/\$\s?\d/);
    expect(text).not.toMatch(/89/);
  });

  it("never includes the phone, the address, the report's personal information or an SSN typed in the chat", () => {
    const client: StaffClient = {
      ...itzel(),
      conversation: [
        ...itzel().conversation!,
        { id: "ssn", at: NOW.toISOString(), role: "user", source: "coach", text: "Mi seguro social es 123-45-6789, ¿lo necesitan?" },
      ],
    };
    const facts = draftFacts(client, "admin", NOW)!;
    const text = draftUserMessage({ facts, question: questionToAnswer(client)!, conversation: conversationLines(client) });
    expect(text).not.toContain("123-45-6789");
    expect(text).toContain("[REDACTED]");
    expect(text).not.toContain(client.phone);
    for (const line of client.addressLines) expect(text).not.toContain(line);
    expect(JSON.stringify(facts)).not.toMatch(/ssn|social security|birth/i);
  });

  it("a role that may not see billing gets none, and the prompt says a person checks it", () => {
    const facts = { ...draftFacts(itzel(), "admin", NOW)!, billing: null, withheld: ["cobros y pagos"] };
    const text = draftUserMessage({ facts, question: "¿Cuándo me cobran?", conversation: [] });
    expect(text).not.toMatch(/- Cobros:/);
    expect(text).toMatch(/No tienes datos de: cobros y pagos/);
  });

  it("the instructions keep the rules: the client decides, no promises, no price, no SSN", () => {
    expect(DRAFT_SYSTEM_PROMPT).toMatch(/Nunca le digas al cliente qué marcar/);
    expect(DRAFT_SYSTEM_PROMPT).toMatch(/la decisión es suya/);
    expect(DRAFT_SYSTEM_PROMPT).toMatch(/Nunca prometas/);
    expect(DRAFT_SYSTEM_PROMPT).toMatch(/Nunca des un precio/);
    expect(DRAFT_SYSTEM_PROMPT).toMatch(/Seguro Social/);
    // Fixed text, so the prompt cache serves it: no date, no name.
    expect(DRAFT_SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}|Itzel/);
  });

  it("a matching saved answer goes with the question, as the base", () => {
    const facts = draftFacts(itzel(), "admin", NOW)!;
    const text = draftUserMessage({ facts, question: "¿Cuándo salen mis cartas?", conversation: [], savedAnswer: DEMO_SAVED_ANSWERS[0]! });
    expect(text).toMatch(/RESPUESTA APROBADA DEL EQUIPO/);
    expect(text).toContain(DEMO_SAVED_ANSWERS[0]!.answer);
  });
});

describe("drafts: checked before anyone sees them", () => {
  it("refuses a promise, advice on what to mark, an amount and an SSN", () => {
    expect(draftProblems("Hola Itzel, eliminamos esa cuenta pronto.").length).toBeGreaterThan(0);
    expect(draftProblems("Hola, te recomiendo marcarlo como inexacto.").length).toBeGreaterThan(0);
    expect(draftProblems("Hola, deberías disputar esa cobranza.").length).toBeGreaterThan(0);
    expect(draftProblems("Hi, you should mark it as inaccurate.").length).toBeGreaterThan(0);
    expect(draftProblems("El plan cuesta $89 al mes.").length).toBeGreaterThan(0);
    expect(draftProblems("Tu número es 123-45-6789.").length).toBeGreaterThan(0);
    // Explaining what to check and handing back the decision is fine.
    expect(draftProblems("Hola Itzel. Revisa si reconoces la cuenta y si las fechas coinciden; la decisión de marcarla es tuya.")).toEqual([]);
  });

  it("is the same check the send applies, plus the draft's own", () => {
    const text = "Te garantizamos la eliminación de esa cuenta.";
    expect(checkStaffReply(text).length).toBeGreaterThan(0);
    expect(draftProblems(text).length).toBeGreaterThanOrEqual(checkStaffReply(text).length);
  });
});

describe("drafts: the model, mocked", () => {
  const good = "Hola Itzel. Gracias por tu pregunta. Lo estoy confirmando con el servicio de monitoreo y te escribo aquí mismo en cuanto lo sepa.";

  it("a draft that passes comes back as is, after one call", async () => {
    const caller = scripted([good]);
    const outcome = await draftReply({ client: itzel(), role: "specialist", now: NOW, savedAnswers: DEMO_SAVED_ANSWERS }, caller);
    expect(outcome).toMatchObject({ ok: true, draft: good, retried: false });
    expect(caller.calls).toHaveLength(1);
    expect(caller.calls[0]!.system).toBe(DRAFT_SYSTEM_PROMPT);
    expect(caller.calls[0]!.user).toMatch(/ITIN/);
  });

  it("a draft that fails is written again once, with the reason", async () => {
    const caller = scripted(["Hola Itzel, no te preocupes: eliminamos esa cuenta de tu reporte.", good]);
    const outcome = await draftReply({ client: itzel(), role: "admin", now: NOW }, caller);
    expect(outcome).toMatchObject({ ok: true, draft: good, retried: true });
    expect(caller.calls).toHaveLength(2);
    expect(caller.calls[1]!.user).toMatch(/TU BORRADOR ANTERIOR NO SE PUDO MOSTRAR/);
    expect(caller.calls[1]!.user).toMatch(/eliminamos/);
    expect(caller.calls[0]!.user).not.toMatch(/TU BORRADOR ANTERIOR/);
  });

  it("two drafts that fail give no draft, and say why", async () => {
    const caller = scripted(["Te recomiendo marcarla como inexacta.", "Deberías marcar esa cuenta; la eliminamos."]);
    const outcome = await draftReply({ client: itzel(), role: "admin", now: NOW }, caller);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("failed_rules");
      expect(outcome.message).toMatch(/ninguno pasó las reglas/);
      expect(outcome.problems!.length).toBeGreaterThan(0);
    }
    expect(caller.calls).toHaveLength(2);
  });

  it("without a key: no draft, no call, a clear note, and the saved answer still offered", async () => {
    const question: StaffClient = { ...itzel(), questions: [{ id: "q2", askedAt: NOW.toISOString(), text: "¿Cuándo salen mis cartas?", answeredAt: null }] };
    const outcome = await draftReply({ client: question, role: "admin", now: NOW, savedAnswers: DEMO_SAVED_ANSWERS }, null);
    expect(outcome).toMatchObject({ ok: false, code: "not_configured", message: NO_KEY_MESSAGE });
    expect(NO_KEY_MESSAGE).toMatch(/ANTHROPIC_API_KEY/);
    if (!outcome.ok) expect(outcome.savedAnswer?.answer.question).toBe("¿Cuándo salen mis cartas?");
    // The real caller answers the same way when the key is missing.
    const caller = scripted([], "not_configured");
    expect(await draftReply({ client: question, role: "admin", now: NOW }, caller)).toMatchObject({ code: "not_configured" });
  });

  it("sales never reaches the model", async () => {
    const caller = scripted([good]);
    expect(await draftReply({ client: itzel(), role: "sales", now: NOW }, caller)).toMatchObject({ ok: false, code: "not_allowed" });
    expect(caller.calls).toHaveLength(0);
  });

  it("the real caller sends nothing without a key", async () => {
    const { callDraftModel } = await import("../staff/draftModel");
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(await callDraftModel({ system: "x", user: "y" })).toEqual({ reply: null, problem: "not_configured" });
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});

// ── The morning summary ─────────────────────────────────────────────────

const ENV: AutopilotEnv = { settings: DEMO_SETTINGS, channels: DEMO_CHANNELS };

describe("morning summary", () => {
  const context = { furnishers: seededBook(), autopilot: ENV };

  it("counts the member's own queue, names the first three, and links to «Siguiente»", () => {
    const clients = demoClients();
    const summary = morningSummary(ADMIN, clients, NOW, context, "https://app.test");
    const queue = workQueue(clients, NOW, context, "admin");
    expect(summary.count).toBe(workSummary(queue).count);
    expect(summary.minutes).toBe(workSummary(queue).minutes);
    expect(summary.top).toHaveLength(Math.min(3, queue.length));
    expect(summary.text).toMatch(new RegExp(`^Buenos días, Carmen\\. Hoy: ${summary.count} cosas · ~${summary.minutes} minutos\\.`));
    expect(summary.text).toContain("https://app.test/equipo?siguiente=1");
    expect(summary.text).toMatch(/En las últimas 24 horas el sistema/);
    expect(checkClaimGuardrails(summary.text)).toEqual([]);
    // Clients by first name and initial only.
    for (const item of queue.slice(0, 3)) expect(summary.text).not.toContain(`${item.client.firstName} ${item.client.lastName}`);
  });

  it("a specialist's counts only their clients; sales only their own notices", () => {
    const clients = demoClients();
    const marta = morningSummary(MARTA, clients, NOW, context);
    const mine = clients.filter((c) => c.assignedTo === "marta");
    expect(marta.count).toBe(workQueue(mine, NOW, context, "specialist").length);
    const ana = morningSummary(ANA, clients, NOW, context);
    expect(ana.count).toBe(workQueue(clients.filter((c) => c.salesperson === "ana"), NOW, context, "sales").length);
  });

  it("the template's values carry no line breaks, and the body names them in order", () => {
    const summary = morningSummary(ADMIN, demoClients(), NOW, context);
    expect(summary.params).toHaveLength(6);
    for (const p of summary.params) expect(p).not.toMatch(/\n/);
    expect(DIGEST_TEMPLATE_BODY.match(/\{\{\d\}\}/g)).toEqual(["{{1}}", "{{2}}", "{{3}}", "{{4}}", "{{5}}", "{{6}}"]);
    expect(checkClaimGuardrails(DIGEST_TEMPLATE_BODY)).toEqual([]);
    expect(shortClientName({ firstName: "Itzel", lastName: "Bahena" })).toBe("Itzel B.");
  });

  it("goes once a day, after the member's time on their clock, never in quiet hours", () => {
    const on = { ...DEFAULT_PREFERENCES, digestEnabled: true };
    const quiet = DEFAULT_AUTOPILOT;
    // 9:00 Texas: after 8:30.
    expect(digestDue(on, NOW, quiet, new Set())).toEqual({ due: true, day: "2026-12-07" });
    // 8:00 Texas: not yet.
    expect(digestDue(on, new Date("2026-12-07T14:00:00.000Z"), quiet, new Set())).toMatchObject({ due: false, why: "not_yet" });
    // Already sent today.
    expect(digestDue(on, NOW, quiet, new Set(["2026-12-07"]))).toMatchObject({ due: false, why: "already_sent" });
    // Off.
    expect(digestDue(DEFAULT_PREFERENCES, NOW, quiet, new Set())).toMatchObject({ due: false, why: "off" });
    // A 6:00 a.m. time waits for the end of quiet hours (8:00).
    const early = { ...on, digestTime: "06:00" };
    expect(digestDue(early, new Date("2026-12-07T13:00:00.000Z"), quiet, new Set())).toMatchObject({ due: false, why: "quiet_hours" });
    expect(digestDue(early, new Date("2026-12-07T14:05:00.000Z"), quiet, new Set())).toMatchObject({ due: true });
    // Another clock: 8:30 in Los Angeles is 10:30 in Texas.
    const west = { ...on, timeZone: "America/Los_Angeles" };
    expect(digestDue(west, NOW, quiet, new Set())).toMatchObject({ due: false, why: "not_yet" });
  });

  it("goes by the member's channel, else the other; WhatsApp outside 24 h only with the approved template; never SMS", () => {
    const member = { phone: "+17135550191", email: "marta@ejemplo.com" };
    const all = { whatsapp: true, email: true, approvedTemplates: [DIGEST_TEMPLATE], simulated: false };
    expect(digestChannel("whatsapp", member, all, NOW)).toEqual({ channel: "whatsapp", mode: "template" });
    expect(digestChannel("email", member, all, NOW)).toEqual({ channel: "email" });
    expect(digestChannel("whatsapp", member, { ...all, approvedTemplates: [] }, NOW)).toEqual({ channel: "email" });
    expect(digestChannel("whatsapp", { phone: member.phone, email: null }, { ...all, approvedTemplates: [] }, NOW)).toMatchObject({ channel: null });
    expect(digestChannel("email", { phone: null, email: null }, all, NOW)).toMatchObject({ channel: null });
    expect(readFileSync("src/lib/staff/digestServer.ts", "utf8")).not.toMatch(/sendSms|twilio|channel: "sms"/i);
    expect(readFileSync("supabase/migrations/0020_staff_assist.sql", "utf8")).toMatch(/channel in \('whatsapp', 'email'\)/);
  });
});

describe("member preferences", () => {
  it("start off, at 8:30 Texas, by WhatsApp", () => {
    expect(DEFAULT_PREFERENCES).toMatchObject({ digestEnabled: false, digestTime: "08:30", timeZone: "America/Chicago", digestChannel: "whatsapp" });
    expect(formatDigestTime("08:30")).toBe("8:30 a. m.");
    expect(formatDigestTime("13:05")).toBe("1:05 p. m.");
  });

  it("refuse anything out of bounds, and keep the dismissal date", () => {
    expect(preferencesUpdateSchema.strict().safeParse({ digestTime: "25:00" }).success).toBe(false);
    expect(preferencesUpdateSchema.strict().safeParse({ timeZone: "Europe/Madrid" }).success).toBe(false);
    expect(preferencesUpdateSchema.strict().safeParse({ userId: "someone-else" }).success).toBe(false);
    expect(normalizePreferences({ digestTime: "nope" as string }).digestTime).toBe("08:30");
    const next = applyPreferencesUpdate(DEFAULT_PREFERENCES, { digestEnabled: true, checklistDismissed: true }, NOW);
    expect(next).toMatchObject({ digestEnabled: true, checklistDismissedAt: NOW.toISOString() });
    expect(applyPreferencesUpdate(next, { checklistDismissed: false }, NOW).checklistDismissedAt).toBeNull();
    expect(preferencesFromRow({ digest_enabled: true, digest_channel: "email", digest_time: "07:45", time_zone: "America/Denver", checklist_dismissed_at: null })).toMatchObject({
      digestEnabled: true,
      digestChannel: "email",
      digestTime: "07:45",
      timeZone: "America/Denver",
    });
  });
});

// ── Pulse on the dashboard ──────────────────────────────────────────────

describe("pulse on the business dashboard", () => {
  it("has a written definition, and counts only answers in the period", () => {
    expect(METRIC_INFO.pulse.definition).toMatch(/1 = no muy bien, 2 = más o menos, 3 = bien/);
    expect(checkClaimGuardrails(METRIC_INFO.pulse.definition)).toEqual([]);
    const clients = demoClients();
    const members = buildDemoTeam(NOW).members;
    const all = businessMetrics(clients, members, "all", NOW);
    expect(all.pulse.count).toBe(clients.flatMap((c) => c.pulses ?? []).length);
    expect(all.pulse.count).toBeGreaterThan(3);
    expect(all.pulse.comments[0]!.createdAt >= all.pulse.comments[all.pulse.comments.length - 1]!.createdAt).toBe(true);
    // A specialist's clients carry only their own pulses (the 0018 read policy does this on the database).
    const old = clients.map((c) => ({ ...c, pulses: (c.pulses ?? []).map((p) => ({ ...p, createdAt: "2020-01-01T00:00:00.000Z" })) }));
    expect(businessMetrics(old, members, "month", NOW).pulse.count).toBe(0);
  });
});
