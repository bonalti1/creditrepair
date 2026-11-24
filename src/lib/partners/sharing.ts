import { cancellationDeadline } from "../agreement/businessDays";
import { sha256Hex } from "../agreement/sha256";
import { caseDay, CASE_RESPONSE_DAYS, latestMailedRound, nextRoundAt, responseWindowStart, type CaseFacts } from "../case/timeline";
import { nextRoundDueForStaffRound } from "../rounds/timing";
import { GOALS, type GoalKey } from "../sales/invite";
import { REQUIRED_DOCUMENTS, type StaffClient } from "../staff/types";
import { BRAND } from "../brand";
import type { PartnerKind } from "./rules";

// A client lets a partner follow their progress. Pure rules: the levels, the
// exact consent text (versioned and hashed like the service agreement), what
// a partner's screen says, and how the same limited facts are built from the
// database row (migration 0023, partner_progress_rows), from the client's own
// case (the preview) and from the demo's invented clients.
//
// What a partner may see is decided by the database, not by this file:
// partner_clients() and partner_client_view() return only these columns, and
// the counts only at the "summary" level. This file only words them.
//
// Wording: facts and dates of the process, third person, never an outcome.
// "Ya no aparece en su reporte más reciente" is a fact about a report; it is
// never called a deletion, a removal or a result, and never a percentage.

export type L = "es" | "en";

export const SHARE_LEVELS = ["none", "progress", "summary"] as const;
export type ShareLevel = (typeof SHARE_LEVELS)[number];
export type SharingLevel = Exclude<ShareLevel, "none">;
export type ShareHow = "referred" | "added_by_code";

/** Change it whenever any word of the consent text changes. Stored with every record (partner_share_consents.text_version). */
export const SHARING_CONSENT_VERSION = "2026-11-compartir-v1";

export const SHARE_LEVEL_LABEL: Record<L, Record<ShareLevel, string>> = {
  es: { none: "No compartir", progress: "Solo el avance", summary: "Avance y resumen" },
  en: { none: "Don't share", progress: "Progress only", summary: "Progress and summary" },
};

export interface SharePartner {
  id: string;
  name: string;
  company: string | null;
  kind: PartnerKind;
}

/** "María López, ABC Realty" */
export function partnerDisplay(p: Pick<SharePartner, "name" | "company">): string {
  return p.company ? `${p.name}, ${p.company}` : p.name;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

// ── The consent text ────────────────────────────────────────────────────

export interface ConsentText {
  /** The one-line summary of the choice. */
  lead: string;
  will: string[];
  never: string[];
  notes: string[];
}

/**
 * Exactly what the client reads before choosing a level for this partner.
 * Its hash is what the record keeps; the server recomputes it from the
 * partner's name in the database and refuses a choice made on other words.
 */
export function consentText(level: ShareLevel, partner: Pick<SharePartner, "name" | "company">, locale: L): ConsentText {
  const who = partnerDisplay(partner);
  const first = firstName(partner.name);
  if (locale === "en") {
    const never = [
      "Your scores, your report or any account on it: no creditors, account numbers or amounts.",
      "Your letters, your documents, your Social Security number, your date of birth or your address.",
      "Your payments, your messages with the team, or your answers and reasons.",
    ];
    const notes = [
      `Every time ${first} opens your progress, it is recorded and you can see it here.`,
      "You can change or stop this whenever you want, in More → Who can see your progress. It takes effect right away.",
      "Sharing is your choice. It does not change your service or what you pay.",
    ];
    if (level === "none") {
      return {
        lead: `You share nothing with ${who}.`,
        will: [`${first} only sees the step you are at: whether we are in touch, whether you signed, whether your service is active, or whether you did not continue.`],
        never,
        notes: notes.slice(1),
      };
    }
    const will = [
      "Your full name.",
      "Which step your case is at, in plain words.",
      "The date of each step: when you signed, when your documents were complete, when you finished your review, when each round of letters was mailed, the bureaus' time to answer, and when the next round is expected.",
      "Your goal, if you gave us one (for example, buying a home).",
    ];
    if (level === "summary") {
      will.push(
        "Two numbers: how many items you are disputing in the current round, and how many of the items you disputed no longer appear on your most recent report. Only the numbers, never which ones.",
      );
    }
    return { lead: `${who} will be able to see your progress.`, will, never, notes };
  }
  const never = [
    "Tus puntajes, tu reporte ni ninguna cuenta: ni acreedores, ni números de cuenta, ni montos.",
    "Tus cartas, tus documentos, tu número de Seguro Social, tu fecha de nacimiento ni tu dirección.",
    "Tus pagos, tus mensajes con el equipo, ni tus respuestas o razones.",
  ];
  const notes = [
    `Cada vez que ${first} abre tu avance, queda registrado y lo ves aquí.`,
    "Puedes cambiarlo o quitarlo cuando quieras, en Más → Quién puede ver tu progreso. El cambio vale de inmediato.",
    "Compartir es tu decisión. No cambia tu servicio ni lo que pagas.",
  ];
  if (level === "none") {
    return {
      lead: `No compartes nada con ${who}.`,
      will: [`${first} solo ve en qué paso vas: si estamos en contacto, si firmaste, si tu servicio está activo o si no seguiste.`],
      never,
      notes: notes.slice(1),
    };
  }
  const will = [
    "Tu nombre completo.",
    "En qué paso va tu caso, en palabras sencillas.",
    "La fecha de cada paso: cuándo firmaste, cuándo completaste tus documentos, cuándo terminaste tu revisión, cuándo salió cada ronda de cartas, el plazo de respuesta de los burós y cuándo se espera la siguiente ronda.",
    "Tu meta, si nos la diste (por ejemplo, comprar casa).",
  ];
  if (level === "summary") {
    will.push(
      "Dos números: cuántos puntos estás disputando en la ronda actual y cuántos de los puntos que disputaste ya no aparecen en tu reporte más reciente. Solo los números, nunca cuáles.",
    );
  }
  return { lead: `${who} podrá ver tu avance.`, will, never, notes };
}

/** The text as one string, as it is hashed. */
export function consentPlainText(level: ShareLevel, partner: Pick<SharePartner, "name" | "company">, locale: L): string {
  const t = consentText(level, partner, locale);
  const heads = locale === "es" ? ["Verá:", "Nunca verá:"] : ["Will see:", "Will never see:"];
  return [t.lead, heads[0], ...t.will.map((x) => `- ${x}`), heads[1], ...t.never.map((x) => `- ${x}`), ...t.notes].join("\n");
}

/** SHA-256 of exactly what the client was shown for this choice. */
export function consentHash(level: ShareLevel, partner: Pick<SharePartner, "name" | "company">, locale: L, version: string = SHARING_CONSENT_VERSION): string {
  return sha256Hex([`version: ${version}`, `locale: ${locale}`, `level: ${level}`, consentPlainText(level, partner, locale)].join("\n\n"));
}

// ── What a partner sees ─────────────────────────────────────────────────

export interface PartnerRound {
  number: number;
  mailedAt: string;
  /** About 30 days after the round reached the bureaus. */
  answerDueAt: string;
  /** When the next round is due (rounds/timing.ts): about 35 to 45 days after mailing. */
  nextRoundAt: string;
}

/** One consenting client, as partner_clients() returns them. Nothing else exists for a partner. */
export interface PartnerProgress {
  clientId: string;
  name: string;
  level: SharingLevel;
  how: ShareHow;
  /** When the client started sharing (this time). */
  sharedAt: string;
  goal: GoalKey | null;
  agreementSignedAt: string | null;
  workStartsAt: string | null;
  serviceEndedAt: string | null;
  documentsCompleteAt: string | null;
  reviewFinishedAt: string | null;
  rounds: PartnerRound[];
  /** Summary level only; null otherwise (the database returns null). */
  disputingCount: number | null;
  noLongerReportedCount: number | null;
}

/** The exact keys the database may return. A test checks the function's columns against this list. */
export const PARTNER_PROGRESS_COLUMNS = [
  "client_id", "display_name", "level", "how", "shared_at", "goal", "agreement_signed_at", "work_starts_at",
  "service_ended_at", "documents_complete_at", "review_finished_at", "rounds", "disputing_count", "no_longer_reported_count",
] as const;

const isoOrNull = (v: unknown): string | null => (typeof v === "string" || v instanceof Date) && !Number.isNaN(new Date(v as string).getTime()) ? new Date(v as string).toISOString() : null;
const intOrNull = (v: unknown): number | null => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Math.max(0, Math.trunc(Number(v))));

export function progressFromRow(row: Record<string, unknown>): PartnerProgress {
  const level: SharingLevel = row.level === "summary" ? "summary" : "progress";
  const rawRounds = Array.isArray(row.rounds) ? row.rounds : typeof row.rounds === "string" ? (JSON.parse(row.rounds) as unknown[]) : [];
  const rounds = (rawRounds as Array<Record<string, unknown>>).flatMap((r) => {
    const mailedAt = isoOrNull(r.mailed_at);
    const answerDueAt = isoOrNull(r.answer_due_at);
    const nextRoundAt = isoOrNull(r.next_round_at);
    return mailedAt && answerDueAt && nextRoundAt ? [{ number: Number(r.number), mailedAt, answerDueAt, nextRoundAt }] : [];
  });
  const goal = GOALS.find((g) => g.key === row.goal)?.key ?? null;
  return {
    clientId: String(row.client_id),
    name: String(row.display_name ?? "").trim(),
    level,
    how: row.how === "added_by_code" ? "added_by_code" : "referred",
    sharedAt: isoOrNull(row.shared_at) ?? new Date(0).toISOString(),
    goal,
    agreementSignedAt: isoOrNull(row.agreement_signed_at),
    workStartsAt: isoOrNull(row.work_starts_at),
    serviceEndedAt: isoOrNull(row.service_ended_at),
    documentsCompleteAt: isoOrNull(row.documents_complete_at),
    reviewFinishedAt: isoOrNull(row.review_finished_at),
    rounds: rounds.sort((a, b) => a.number - b.number),
    // Never trusted past the level, even if a row carried them.
    disputingCount: level === "summary" ? intOrNull(row.disputing_count) : null,
    noLongerReportedCount: level === "summary" ? intOrNull(row.no_longer_reported_count) : null,
  };
}

export type PartnerStageKey =
  | "ended"
  | "not_signed"
  | "in_window"
  | "getting_started"
  | "documents"
  | "reviewing"
  | "preparing"
  | "waiting_answers"
  | "window_over"
  | "next_round";

export interface PartnerStage {
  key: PartnerStageKey;
  /** One plain sentence, third person. */
  sentence: string;
  /** A short label for a chip. */
  label: string;
  /** The next date the process gives, if any. */
  next: { label: string; at: string } | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : Number.NaN);

const STAGE_LABEL: Record<L, Record<PartnerStageKey, string>> = {
  es: {
    ended: "Terminó",
    not_signed: "Por firmar",
    in_window: "Firmó",
    getting_started: "Empezando",
    documents: "Documentos",
    reviewing: "En revisión",
    preparing: "Cartas en preparación",
    waiting_answers: "Esperando respuestas",
    window_over: "Plazo cumplido",
    next_round: "Siguiente ronda",
  },
  en: {
    ended: "Ended",
    not_signed: "To sign",
    in_window: "Signed",
    getting_started: "Getting started",
    documents: "Documents",
    reviewing: "Reviewing",
    preparing: "Letters being prepared",
    waiting_answers: "Waiting for answers",
    window_over: "Time to answer passed",
    next_round: "Next round",
  },
};

/** Where the client is, in a partner's words. Only the dates of partner_progress_rows are used. */
export function partnerStage(p: PartnerProgress, locale: L, now: Date = new Date()): PartnerStage {
  const es = locale === "es";
  const n = firstName(p.name);
  const d = (iso: string) => caseDay(iso, locale);
  const t = now.getTime();
  const make = (key: PartnerStageKey, sentence: string, next: PartnerStage["next"] = null): PartnerStage => ({ key, sentence, label: STAGE_LABEL[locale][key], next });

  if (p.serviceEndedAt) {
    return make("ended", es ? `${n} terminó su servicio el ${d(p.serviceEndedAt)}.` : `${n} ended their service on ${d(p.serviceEndedAt)}.`);
  }
  if (!p.agreementSignedAt) {
    return make("not_signed", es ? `${n} todavía no firma su acuerdo de servicio.` : `${n} has not signed their service agreement yet.`);
  }
  if (p.workStartsAt && ms(p.workStartsAt) > t) {
    return make(
      "in_window",
      es
        ? `${n} firmó su acuerdo el ${d(p.agreementSignedAt)}. El equipo empieza el ${d(p.workStartsAt)}, cuando termina su plazo para cancelar.`
        : `${n} signed their agreement on ${d(p.agreementSignedAt)}. The team starts on ${d(p.workStartsAt)}, when their time to cancel ends.`,
      { label: es ? "El equipo empieza" : "The team starts", at: p.workStartsAt },
    );
  }
  const latest = [...p.rounds].sort((a, b) => b.number - a.number)[0];
  if (latest) {
    if (t >= ms(latest.nextRoundAt)) {
      return make(
        "next_round",
        es ? `El equipo prepara la ronda ${latest.number + 1} de ${n}.` : `The team is preparing ${n}'s round ${latest.number + 1}.`,
      );
    }
    if (t >= ms(latest.answerDueAt)) {
      return make(
        "window_over",
        es
          ? `Ya pasaron unos ${CASE_RESPONSE_DAYS} días desde la ronda ${latest.number}. La siguiente ronda se prepara alrededor del ${d(latest.nextRoundAt)}.`
          : `About ${CASE_RESPONSE_DAYS} days have passed since round ${latest.number}. The next round is prepared around ${d(latest.nextRoundAt)}.`,
        { label: es ? "Siguiente ronda, alrededor del" : "Next round, around", at: latest.nextRoundAt },
      );
    }
    return make(
      "waiting_answers",
      es
        ? `Las cartas de la ronda ${latest.number} de ${n} salieron el ${d(latest.mailedAt)}. Los burós tienen unos ${CASE_RESPONSE_DAYS} días para responder.`
        : `${n}'s round ${latest.number} letters were mailed on ${d(latest.mailedAt)}. The bureaus have about ${CASE_RESPONSE_DAYS} days to answer.`,
      { label: es ? "Plazo de los burós, alrededor del" : "Bureaus' time to answer, around", at: latest.answerDueAt },
    );
  }
  if (p.reviewFinishedAt && p.documentsCompleteAt) {
    return make("preparing", es ? `${n} terminó su revisión. El equipo prepara las cartas de su ronda 1.` : `${n} finished their review. The team is preparing their round 1 letters.`);
  }
  if (p.reviewFinishedAt) {
    return make("documents", es ? `${n} terminó su revisión. Faltan sus documentos de identidad para preparar las cartas.` : `${n} finished their review. Their identity documents are still needed to prepare the letters.`);
  }
  if (p.documentsCompleteAt) {
    return make("reviewing", es ? `${n} ya entregó sus documentos y está revisando su reporte con el equipo.` : `${n} handed in their documents and is reviewing their report with the team.`);
  }
  return make("getting_started", es ? `${n} está entregando sus documentos y revisando su reporte con el equipo.` : `${n} is handing in their documents and reviewing their report with the team.`);
}

export interface PartnerEvent {
  key: string;
  at: string;
  day: string;
  title: string;
  /** False for a date the process expects but that has not come yet. */
  done: boolean;
}

/** The partner's timeline of one client: what happened, and the dates the process expects. Oldest first. */
export function partnerTimeline(p: PartnerProgress, locale: L, now: Date = new Date()): PartnerEvent[] {
  const es = locale === "es";
  const t = now.getTime();
  const out: Array<Omit<PartnerEvent, "day" | "done"> & { done?: boolean }> = [];
  const push = (key: string, at: string | null, title: string, done?: boolean) => {
    if (at) out.push({ key, at, title, done });
  };
  push("shared", p.sharedAt, es ? "Empezó a compartir su avance contigo" : "Started sharing their progress with you", true);
  push("signed", p.agreementSignedAt, es ? "Firmó su acuerdo de servicio" : "Signed their service agreement");
  if (!p.serviceEndedAt) push("work_starts", p.workStartsAt, es ? "Terminó su plazo para cancelar; el equipo puede trabajar" : "Their time to cancel ended; the team can work");
  push("documents", p.documentsCompleteAt, es ? "Completó sus documentos" : "Documents complete");
  push("review", p.reviewFinishedAt, es ? "Terminó su revisión del reporte" : "Finished reviewing their report");
  const sorted = [...p.rounds].sort((a, b) => a.number - b.number);
  sorted.forEach((r, i) => {
    push(`round_${r.number}`, r.mailedAt, es ? `Salieron las cartas de la ronda ${r.number}` : `Round ${r.number} letters mailed`);
    push(
      `answer_${r.number}`,
      r.answerDueAt,
      ms(r.answerDueAt) <= t
        ? es ? `Se cumplió el plazo de los burós de la ronda ${r.number}` : `The bureaus' time to answer round ${r.number} passed`
        : es ? `Plazo de respuesta de los burós (ronda ${r.number})` : `Bureaus' time to answer (round ${r.number})`,
    );
    if (i === sorted.length - 1 && !p.serviceEndedAt) {
      push("next_round", r.nextRoundAt, es ? `Se espera preparar la ronda ${r.number + 1}` : `Round ${r.number + 1} expected to be prepared`);
    }
  });
  push("ended", p.serviceEndedAt, es ? "Terminó su servicio" : "Ended their service");
  return out
    .map((e) => ({ ...e, day: caseDay(e.at, locale), done: e.done ?? ms(e.at) <= t }))
    .sort((a, b) => ms(a.at) - ms(b.at));
}

export function goalLabel(goal: GoalKey | null, locale: L): string | null {
  const g = GOALS.find((x) => x.key === goal);
  return g ? (locale === "es" ? g.label : g.labelEn) : null;
}

// ── The same facts from other sources ───────────────────────────────────

const addDays = (iso: string, days: number) => new Date(ms(iso) + days * DAY_MS).toISOString();

/**
 * The client's own case as their partner would see it, for the preview next
 * to the choice. The same columns as the database function.
 */
export function progressFromCaseFacts(
  facts: CaseFacts,
  who: { clientId?: string; name: string; goal: string | null; level: SharingLevel; how?: ShareHow; sharedAt?: string; counts?: { disputing: number; noLongerReported: number } },
): PartnerProgress {
  const a = facts.agreement;
  const docs = new Map<string, string>();
  for (const d of facts.documents) {
    const prev = docs.get(d.kind);
    if (!prev || ms(d.receivedAt) < ms(prev)) docs.set(d.kind, d.receivedAt);
  }
  const documentsCompleteAt = REQUIRED_DOCUMENTS.every((k) => docs.has(k)) ? [...docs.entries()].filter(([k]) => (REQUIRED_DOCUMENTS as readonly string[]).includes(k)).map(([, at]) => at).sort().at(-1)! : null;
  const rounds = facts.rounds
    .filter((r) => r.mailedAt)
    .map((r) => ({ number: r.number, mailedAt: r.mailedAt!, answerDueAt: addDays(responseWindowStart(r), CASE_RESPONSE_DAYS), nextRoundAt: nextRoundAt(r) }));
  const mailed = latestMailedRound(facts);
  return {
    clientId: who.clientId ?? "preview",
    name: who.name,
    level: who.level,
    how: who.how ?? "referred",
    sharedAt: who.sharedAt ?? new Date().toISOString(),
    goal: GOALS.find((g) => g.key === who.goal)?.key ?? null,
    agreementSignedAt: a?.signedAt ?? null,
    workStartsAt: a?.signedAt && !a.cancelledAt ? (a.cancellationDeadline ?? null) : null,
    serviceEndedAt: a?.cancelledAt ?? a?.serviceEndRequestedAt ?? null,
    documentsCompleteAt,
    reviewFinishedAt: facts.review.finishedAt,
    rounds,
    disputingCount: who.level === "summary" ? (who.counts?.disputing ?? (mailed ? facts.review.confirmed : 0)) : null,
    noLongerReportedCount: who.level === "summary" ? (who.counts?.noLongerReported ?? 0) : null,
  };
}

/** A demo client (the staff console's invented records) as their partner would see them. Mirrors the SQL. */
export function progressFromStaffClient(client: StaffClient, share: { level: SharingLevel; how: ShareHow; sharedAt: string }): PartnerProgress {
  const signed = client.agreementSignedAt ?? null;
  const workStartsAt = signed && !client.agreementCancelledAt ? (client.cancellationDeadline ?? cancellationDeadline(new Date(signed)).toISOString()) : null;
  const hasDocs = REQUIRED_DOCUMENTS.every((k) => client.documents.includes(k));
  const items = client.report?.items ?? [];
  const answers = items.map((i) => client.answers[i.fingerprint]).filter((x) => x && x.status !== "pending");
  const answeredAt = answers.map((x) => (x!.status === "inaccurate" ? x!.confirmedAt : x!.status === "correct" ? x!.answeredAt : "")).filter(Boolean).sort();
  const reviewFinishedAt = items.length > 0 && answers.length === items.length ? (answeredAt.at(-1) ?? null) : null;
  const mailed = client.rounds.filter((r) => r.mailedAt && (r.status === "mailed" || r.status === "responded"));
  const rounds = mailed
    .map((r) => {
      let start = ms(r.mailedAt);
      for (const l of r.letters) {
        const cls = l.mail?.mailClass ?? l.mailClass;
        if ((cls === "certified" || cls === "certified_return_receipt") && l.mailStatus === "delivered" && ms(l.mail?.deliveredAt) > start) start = ms(l.mail?.deliveredAt);
      }
      return { number: r.number, mailedAt: r.mailedAt!, answerDueAt: new Date(start + CASE_RESPONSE_DAYS * DAY_MS).toISOString(), nextRoundAt: nextRoundDueForStaffRound(r)!.dueAt };
    })
    .sort((a, b) => a.number - b.number);
  const latest = [...mailed].sort((a, b) => b.number - a.number)[0];
  const disputed = new Set(latest ? latest.letters.flatMap((l) => l.items.map((i) => i.fingerprint)) : []);
  const gone = new Set(mailed.flatMap((r) => (r.results ?? []).map((x) => x.fingerprint)));
  return {
    clientId: client.id,
    name: `${client.firstName} ${client.lastName}`.trim(),
    level: share.level,
    how: share.how,
    sharedAt: share.sharedAt,
    goal: GOALS.find((g) => g.key === client.goal)?.key ?? null,
    agreementSignedAt: signed,
    workStartsAt,
    serviceEndedAt: client.agreementCancelledAt ?? client.serviceEndRequestedAt ?? null,
    documentsCompleteAt: hasDocs && signed ? addDays(signed, 1) : null,
    reviewFinishedAt,
    rounds,
    disputingCount: share.level === "summary" ? disputed.size : null,
    noLongerReportedCount: share.level === "summary" ? gone.size : null,
  };
}

// ── Milestone notices to a partner ──────────────────────────────────────

export interface PartnerMilestone {
  /** Stable key for dedupe: "signed", "documents", "review", "round_1", "answer_1". */
  key: string;
  at: string;
  text: Record<L, string>;
}

/** The milestones worth a message, already reached. Each has its own words, limited to the same facts. */
export function partnerMilestones(p: PartnerProgress, now: Date = new Date()): PartnerMilestone[] {
  const n = firstName(p.name);
  const out: PartnerMilestone[] = [];
  const t = now.getTime();
  const add = (key: string, at: string | null, es: string, en: string) => {
    if (at && ms(at) <= t) out.push({ key, at, text: { es, en } });
  };
  add("signed", p.agreementSignedAt, `${n} firmó su acuerdo de servicio con ${BRAND.name}.`, `${n} signed their service agreement with ${BRAND.name}.`);
  add("documents", p.documentsCompleteAt, `${n} completó sus documentos.`, `${n}'s documents are complete.`);
  add("review", p.reviewFinishedAt, `${n} terminó la revisión de su reporte.`, `${n} finished reviewing their report.`);
  for (const r of p.rounds) {
    add(
      `round_${r.number}`,
      r.mailedAt,
      `Salieron las cartas de la ronda ${r.number} de ${n}. Los burós tienen unos ${CASE_RESPONSE_DAYS} días para responder.`,
      `${n}'s round ${r.number} letters were mailed. The bureaus have about ${CASE_RESPONSE_DAYS} days to answer.`,
    );
    add(
      `answer_${r.number}`,
      r.answerDueAt,
      `Se cumplió el plazo de respuesta de los burós de la ronda ${r.number} de ${n}.`,
      `The bureaus' time to answer ${n}'s round ${r.number} has passed.`,
    );
  }
  return out;
}

/** The dedupe key of one notice: once per partner, client and milestone. */
export const partnerNoticeKey = (partnerId: string, clientId: string, milestone: string) => `${partnerId}:${clientId}:${milestone}`;

/**
 * Which milestones to tell a partner about now: reached, not told before, and
 * recent (no backlog of old news the day a partner turns notices on).
 */
export function noticesDue(p: PartnerProgress, partnerId: string, alreadySent: ReadonlySet<string>, now: Date, maxAgeDays = 3): PartnerMilestone[] {
  const since = Math.max(ms(p.sharedAt), now.getTime() - maxAgeDays * DAY_MS);
  return partnerMilestones(p, now).filter((m) => ms(m.at) >= since && !alreadySent.has(partnerNoticeKey(partnerId, p.clientId, m.key)));
}
