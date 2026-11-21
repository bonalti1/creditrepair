import { formatCents } from "../billing/rules";
import { displayName } from "./conversation";
import { count } from "./format";
import { memberName, teamEventText, type TeamEvent, type TeamMember } from "./team";
import { fullName, type StaffClient } from "./types";

// Who did what, and when: one feed for a client and one for the whole team.
//
// Read-only and built only from what is on record, like the client's history
// (timeline.ts): the agreement's dates, the reports staff brought in, the
// rounds and who sent them, the team's replies, refunds and pauses with the
// person who asked, assignments, notes, and the team's own changes. Nothing
// is typed into it and nothing can be removed from it. With a database the
// same records come from their tables and from events / team_audit.

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
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_LABEL: Record<ActivityType, string> = {
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
};

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

/** "Carmen Ruiz", "El equipo", "El sistema", "El cliente", or the name as recorded. */
export function actorLabel(members: TeamMember[], actor: string): string {
  if (actor === CLIENT_ACTOR) return "El cliente";
  if (actor === SYSTEM_ACTOR_KEY) return "El sistema";
  if (actor === "equipo") return "El equipo";
  const name = memberName(members, actor);
  return name === actor ? displayName(actor) : name;
}

/** Everything on record about one client, newest first. */
export function clientActivity(client: StaffClient, members: TeamMember[]): ActivityEntry[] {
  const name = fullName(client);
  const entries: ActivityEntry[] = [];
  const add = (key: string, at: string | null | undefined, type: ActivityType, actor: string, text: string) => {
    if (at) entries.push({ id: `${client.id}:${key}`, at, type, actor, clientId: client.id, clientName: name, text });
  };
  const who = (actor: string) => actorLabel(members, actor);

  if (client.addedBy) {
    const by = actorHandle(members, client.addedBy);
    add("lead", client.createdAt, "lead", by, `${who(by)} agregó a ${name} a mano (ventas: ${memberName(members, client.salesperson)})`);
  } else {
    const by = actorHandle(members, client.salesperson);
    add("lead", client.createdAt, "lead", by, `${who(by)} empezó la conversación con ${name}`);
  }
  add("account", client.signedUpAt, "account", CLIENT_ACTOR, `${name} creó su cuenta`);
  add("signed", client.agreementSignedAt, "signed", CLIENT_ACTOR, `${name} firmó el acuerdo de servicio`);
  add(
    "cancelled",
    client.agreementCancelledAt,
    "cancelled",
    CLIENT_ACTOR,
    client.cancelledWithinWindow === false
      ? `${name} canceló su acuerdo, después del plazo de cancelación`
      : `${name} canceló su acuerdo dentro del plazo de 3 días hábiles`,
  );
  add("end", client.serviceEndRequestedAt, "cancelled", CLIENT_ACTOR, `${name} pidió terminar el servicio`);

  const imports = client.reportImports ?? [];
  imports.forEach((record, i) => {
    const by = actorHandle(members, record.by);
    add(`import-${i}`, record.at, "report_imported", by, `${who(by)} importó un reporte de ${name} (${count(record.itemCount, "punto", "puntos")})`);
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
        `${who(by)} envió la ronda ${round.number} de ${name} (${count(round.letters.length, "carta", "cartas")})`,
      );
    }
    if (round.respondedAt && !closedByStaff.has(round.number)) {
      add(`response-${round.number}`, round.respondedAt, "report_imported", SYSTEM_ACTOR_KEY, `El sistema importó el reporte nuevo de ${name}, con las respuestas a la ronda ${round.number}`);
    }
  }

  for (const message of client.conversation ?? []) {
    if (message.source !== "human") continue;
    const by = actorHandle(members, message.authorName);
    add(`reply-${message.id}`, message.at, "replied", by, `${who(by)} le respondió a ${name} en la app`);
  }

  for (const charge of client.billing.charges) {
    if (!charge.refund) continue;
    const by = actorHandle(members, charge.refund.by);
    add(
      `refund-${charge.id}`,
      charge.refund.at,
      "refunded",
      by,
      `${who(by)} devolvió el cobro de la ronda ${charge.roundNumber} de ${name} (${formatCents(charge.refund.amountCents)})`,
    );
  }
  const pause = client.billing.pause;
  if (pause) {
    const by = actorHandle(members, pause.by);
    add("pause", pause.at, "billing_paused", by, `${who(by)} puso en pausa los cobros de ${name}`);
  }

  (client.assignments ?? []).forEach((entry, i) => {
    const by = entry.auto ? SYSTEM_ACTOR_KEY : actorHandle(members, entry.by);
    const to = entry.to ? memberName(members, entry.to) : null;
    const text = !to
      ? `${who(by)} dejó el caso de ${name} sin asignar`
      : entry.to === by
        ? `${who(by)} tomó el caso de ${name}`
        : `${who(by)} ${i === 0 ? "asignó" : "pasó"} el caso de ${name} a ${to}${entry.auto ? " (por turno)" : ""}`;
    add(`assigned-${i}`, entry.at, "assigned", by, text);
  });

  for (const note of client.notes) {
    const by = actorHandle(members, note.author);
    add(`note-${note.id}`, note.at, "note", by, `${who(by)} dejó una nota sobre ${name}`);
  }

  return entries.sort(newestFirst);
}

/** Newest first; at the same moment, in a fixed order. */
function newestFirst(a: ActivityEntry, b: ActivityEntry): number {
  return b.at.localeCompare(a.at) || a.id.localeCompare(b.id);
}

/** The team's own changes, newest first. */
export function teamActivity(events: TeamEvent[], members: TeamMember[]): ActivityEntry[] {
  return events
    .map((event) => ({
      id: `team:${event.id}`,
      at: event.at,
      type: "team" as const,
      actor: event.by,
      clientId: null,
      clientName: null,
      text: teamEventText(event, members),
    }))
    .sort(newestFirst);
}

/** One feed: every client given, and the team's changes when given. Newest first. */
export function activityFeed(clients: StaffClient[], members: TeamMember[], events: TeamEvent[] = []): ActivityEntry[] {
  return [...clients.flatMap((client) => clientActivity(client, members)), ...teamActivity(events, members)].sort(newestFirst);
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
