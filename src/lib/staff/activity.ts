import { outboundLine } from "../autopilot/queue";
import { formatCents } from "../billing/rules";
import { displayName } from "./conversation";
import { count } from "./format";
import { memberName, teamEventText, type TeamEvent, type TeamMember } from "./team";
import { fullName, type StaffClient } from "./types";
import { type StaffLocale, staffLocaleFallback } from "./i18n/locale";

// Who did what, and when: one feed for a client and one for the whole team.
//
// Read-only and built only from what is on record, like the client's history
// (timeline.ts): the agreement's dates, the reports staff brought in, the
// rounds and who sent them, the team's replies, refunds and pauses with the
// person who asked, assignments, notes, and the team's own changes. Nothing
// is typed into it and nothing can be removed from it. With a database the
// same records come from their tables and from events / team_audit.
//
// Every line is in the console's language (English unless the member chose
// Spanish); a reason someone typed is quoted as they typed it.

export const ACTIVITY_TYPES = [
  "lead",
  "account",
  "signed",
  "cancelled",
  "report_imported",
  "round_sent",
  "replied",
  "refunded",
  "billing_paused",
  "assigned",
  "note",
  "team",
  "auto_message",
  "autopilot_hold",
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

const ACTIVITY_LABEL_ES: Record<ActivityType, string> = {
  lead: "Prospecto nuevo",
  account: "Creó su cuenta",
  signed: "Firmó el acuerdo",
  cancelled: "Canceló o pidió terminar",
  report_imported: "Reporte importado",
  round_sent: "Ronda enviada",
  replied: "Respuesta al cliente",
  refunded: "Reembolso",
  billing_paused: "Cobros en pausa",
  assigned: "Asignación",
  note: "Nota",
  team: "Cambio en el equipo",
  auto_message: "Mensaje automático",
  autopilot_hold: "Piloto automático detenido",
};

const ACTIVITY_LABEL_EN: Record<ActivityType, string> = {
  lead: "New lead",
  account: "Created their account",
  signed: "Signed the agreement",
  cancelled: "Cancelled or asked to end",
  report_imported: "Report imported",
  round_sent: "Round sent",
  replied: "Reply to the client",
  refunded: "Refund",
  billing_paused: "Billing paused",
  assigned: "Assignment",
  note: "Note",
  team: "Team change",
  auto_message: "Automatic message",
  autopilot_hold: "Autopilot on hold",
};

export const ACTIVITY_LABELS: Record<StaffLocale, Record<ActivityType, string>> = { en: ACTIVITY_LABEL_EN, es: ACTIVITY_LABEL_ES };

export interface ActivityEntry {
  /** Stable within a feed. */
  id: string;
  at: string;
  type: ActivityType;
  /** Who did it: a teammate's handle, "client", or "system". */
  actor: string;
  /** The client it is about; null for a change to the team. */
  clientId: string | null;
  clientName: string | null;
  /** One line, starting with who did it. */
  text: string;
}

/** The kinds of actor that are not a teammate. */
export const CLIENT_ACTOR = "client";
export const SYSTEM_ACTOR_KEY = "system";

/**
 * The teammate a recorded name belongs to: records keep a handle ("carmen"),
 * a reply keeps the name it was signed with ("Carmen"). Matched on the handle
 * or the first name; anything else is kept as recorded. "equipo" and "" are
 * the team with no name given.
 */
export function actorHandle(members: TeamMember[], recorded: string | null | undefined): string {
  const value = (recorded ?? "").trim().toLowerCase();
  if (!value || value === "equipo") return "equipo";
  if (value === "sistema") return SYSTEM_ACTOR_KEY;
  const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const match = members.find((m) => m.handle === value || plain(m.name.split(" ")[0] ?? "") === plain(value) || plain(m.name) === plain(value));
  return match?.handle ?? value;
}

const ACTOR_WORDS: Record<StaffLocale, { client: string; system: string; team: string }> = {
  en: { client: "The client", system: "The system", team: "The team" },
  es: { client: "El cliente", system: "El sistema", team: "El equipo" },
};

/** "Carmen Ruiz", "The team", "The system", "The client" (or in Spanish), or the name as recorded. */
export function actorLabel(members: TeamMember[], actor: string, locale: StaffLocale = staffLocaleFallback()): string {
  const words = ACTOR_WORDS[locale];
  if (actor === CLIENT_ACTOR) return words.client;
  if (actor === SYSTEM_ACTOR_KEY) return words.system;
  if (actor === "equipo") return words.team;
  const name = memberName(members, actor, locale);
  return name === actor ? displayName(actor) : name;
}

/** Everything on record about one client, newest first. */
export function clientActivity(client: StaffClient, members: TeamMember[], locale: StaffLocale = staffLocaleFallback()): ActivityEntry[] {
  const es = locale === "es";
  const L = (spanish: string, english: string) => (es ? spanish : english);
  const name = fullName(client);
  const entries: ActivityEntry[] = [];
  const add = (key: string, at: string | null | undefined, type: ActivityType, actor: string, text: string) => {
    if (at) entries.push({ id: `${client.id}:${key}`, at, type, actor, clientId: client.id, clientName: name, text });
  };
  const who = (actor: string) => actorLabel(members, actor, locale);
  const items = (n: number) => (es ? count(n, "punto", "puntos") : count(n, "item", "items"));
  const letters = (n: number) => (es ? count(n, "carta", "cartas") : count(n, "letter", "letters"));

  if (client.addedBy) {
    const by = actorHandle(members, client.addedBy);
    const seller = memberName(members, client.salesperson, locale);
    add("lead", client.createdAt, "lead", by, L(`${who(by)} agregó a ${name} a mano (ventas: ${seller})`, `${who(by)} added ${name} by hand (sales: ${seller})`));
  } else {
    const by = actorHandle(members, client.salesperson);
    add("lead", client.createdAt, "lead", by, L(`${who(by)} empezó la conversación con ${name}`, `${who(by)} started the conversation with ${name}`));
  }
  add("account", client.signedUpAt, "account", CLIENT_ACTOR, L(`${name} creó su cuenta`, `${name} created their account`));
  add("signed", client.agreementSignedAt, "signed", CLIENT_ACTOR, L(`${name} firmó el acuerdo de servicio`, `${name} signed the service agreement`));
  add(
    "cancelled",
    client.agreementCancelledAt,
    "cancelled",
    CLIENT_ACTOR,
    client.cancelledWithinWindow === false
      ? L(`${name} canceló su acuerdo, después del plazo de cancelación`, `${name} cancelled their agreement, after the cancellation period`)
      : L(`${name} canceló su acuerdo dentro del plazo de 3 días hábiles`, `${name} cancelled their agreement within the 3-business-day period`),
  );
  add("end", client.serviceEndRequestedAt, "cancelled", CLIENT_ACTOR, L(`${name} pidió terminar el servicio`, `${name} asked to end the service`));

  const imports = client.reportImports ?? [];
  imports.forEach((record, i) => {
    const by = actorHandle(members, record.by);
    add(`import-${i}`, record.at, "report_imported", by, L(`${who(by)} importó un reporte de ${name} (${items(record.itemCount)})`, `${who(by)} imported a report for ${name} (${items(record.itemCount)})`));
  });
  const closedByStaff = new Set(imports.flatMap((record) => (record.closedRound !== null ? [record.closedRound] : [])));

  for (const round of client.rounds) {
    if (round.mailedAt) {
      const by = round.sentBy ? actorHandle(members, round.sentBy) : "equipo";
      add(
        `round-${round.number}`,
        round.mailedAt,
        "round_sent",
        by,
        L(`${who(by)} envió la ronda ${round.number} de ${name} (${letters(round.letters.length)})`, `${who(by)} sent round ${round.number} for ${name} (${letters(round.letters.length)})`),
      );
    }
    if (round.respondedAt && !closedByStaff.has(round.number)) {
      add(
        `response-${round.number}`,
        round.respondedAt,
        "report_imported",
        SYSTEM_ACTOR_KEY,
        L(`El sistema importó el reporte nuevo de ${name}, con las respuestas a la ronda ${round.number}`, `The system imported ${name}'s new report, with the answers to round ${round.number}`),
      );
    }
  }

  for (const message of client.conversation ?? []) {
    if (message.source !== "human") continue;
    const by = actorHandle(members, message.authorName);
    add(`reply-${message.id}`, message.at, "replied", by, L(`${who(by)} le respondió a ${name} en la app`, `${who(by)} replied to ${name} in the app`));
  }

  for (const charge of client.billing.charges) {
    if (!charge.refund) continue;
    const by = actorHandle(members, charge.refund.by);
    add(
      `refund-${charge.id}`,
      charge.refund.at,
      "refunded",
      by,
      L(
        `${who(by)} devolvió el cobro de la ronda ${charge.roundNumber} de ${name} (${formatCents(charge.refund.amountCents)})`,
        `${who(by)} refunded ${name}'s round ${charge.roundNumber} charge (${formatCents(charge.refund.amountCents)})`,
      ),
    );
  }
  const pause = client.billing.pause;
  if (pause) {
    const by = actorHandle(members, pause.by);
    add("pause", pause.at, "billing_paused", by, L(`${who(by)} puso en pausa los cobros de ${name}`, `${who(by)} paused billing for ${name}`));
  }

  (client.assignments ?? []).forEach((entry, i) => {
    const by = entry.auto ? SYSTEM_ACTOR_KEY : actorHandle(members, entry.by);
    const to = entry.to ? memberName(members, entry.to, locale) : null;
    const text = es
      ? !to
        ? `${who(by)} dejó el caso de ${name} sin asignar`
        : entry.to === by
          ? `${who(by)} tomó el caso de ${name}`
          : `${who(by)} ${i === 0 ? "asignó" : "pasó"} el caso de ${name} a ${to}${entry.auto ? " (por turno)" : ""}`
      : !to
        ? `${who(by)} left ${name}'s case unassigned`
        : entry.to === by
          ? `${who(by)} took ${name}'s case`
          : `${who(by)} ${i === 0 ? "assigned" : "passed"} ${name}'s case to ${to}${entry.auto ? " (by rotation)" : ""}`;
    add(`assigned-${i}`, entry.at, "assigned", by, text);
  });

  // What the autopilot did: every automatic message that went out, and each hold.
  for (const message of client.outbound ?? []) {
    if (message.status !== "sent" && message.status !== "simulated") continue;
    add(`out-${message.id}`, message.sentAt, "auto_message", SYSTEM_ACTOR_KEY, L(`El sistema le escribió a ${name}: ${outboundLine(message, "es")}`, `The system messaged ${name}: ${outboundLine(message, "en")}`));
  }
  for (const hold of client.holds ?? []) {
    const by = actorHandle(members, hold.by);
    add(`hold-${hold.id}`, hold.at, "autopilot_hold", by, L(`${who(by)} detuvo el piloto automático para ${name}: «${hold.reason}»`, `${who(by)} put the autopilot on hold for ${name}: “${hold.reason}”`));
    if (hold.releasedAt) {
      const releasedBy = actorHandle(members, hold.releasedBy ?? "equipo");
      add(`release-${hold.id}`, hold.releasedAt, "autopilot_hold", releasedBy, L(`${who(releasedBy)} soltó el piloto automático para ${name}`, `${who(releasedBy)} released the autopilot for ${name}`));
    }
  }

  for (const note of client.notes) {
    const by = actorHandle(members, note.author);
    add(`note-${note.id}`, note.at, "note", by, L(`${who(by)} dejó una nota sobre ${name}`, `${who(by)} left a note about ${name}`));
  }

  return entries.sort(newestFirst);
}

/** Newest first; at the same moment, in a fixed order. */
function newestFirst(a: ActivityEntry, b: ActivityEntry): number {
  return b.at.localeCompare(a.at) || a.id.localeCompare(b.id);
}

/** The team's own changes, newest first. */
export function teamActivity(events: TeamEvent[], members: TeamMember[], locale: StaffLocale = staffLocaleFallback()): ActivityEntry[] {
  return events
    .map((event) => ({
      id: `team:${event.id}`,
      at: event.at,
      type: "team" as const,
      actor: event.by,
      clientId: null,
      clientName: null,
      text: teamEventText(event, members, locale),
    }))
    .sort(newestFirst);
}

/** One feed: every client given, and the team's changes when given. Newest first. */
export function activityFeed(clients: StaffClient[], members: TeamMember[], events: TeamEvent[] = [], locale: StaffLocale = staffLocaleFallback()): ActivityEntry[] {
  return [...clients.flatMap((client) => clientActivity(client, members, locale)), ...teamActivity(events, members, locale)].sort(newestFirst);
}

export interface ActivityFilter {
  /** A teammate's handle, "client" or "system". */
  actor?: string;
  clientId?: string;
  type?: ActivityType;
}

export function filterActivity(entries: ActivityEntry[], filter: ActivityFilter): ActivityEntry[] {
  return entries.filter(
    (entry) =>
      (!filter.actor || entry.actor === filter.actor) &&
      (!filter.clientId || entry.clientId === filter.clientId) &&
      (!filter.type || entry.type === filter.type),
  );
}
