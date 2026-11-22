import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  planDecision,
  planDiscard,
  planDraft,
  planSend,
  type DecisionInput,
  type LetterVersion,
  type LetterVersionStatus,
  type VersionResult,
} from "./versions";

// Letter versions in the database (migration 0019). Reads go through the
// member's own connection, so the read policies apply (an administrator sees
// every version, a specialist the approved ones). Writes go through the
// service role, after the route checked requireCapability("letters.edit"),
// and the table's trigger freezes a version once it is sent.

type Row = Record<string, unknown>;

export const TABLE = "letter_template_versions";

const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));

export function versionFromRow(row: Row): LetterVersion {
  return {
    id: String(row.id),
    templateKey: String(row.template_key),
    version: Number(row.version),
    origin: row.origin === "builtin" ? "builtin" : "edited",
    locale: "en",
    subject: String(row.subject ?? ""),
    body: String(row.body ?? ""),
    variables: Array.isArray(row.variables) ? (row.variables as unknown[]).map(String) : [],
    basedOn: row.based_on === null || row.based_on === undefined ? null : Number(row.based_on),
    contentHash: String(row.content_hash ?? ""),
    status: (["draft", "sent", "approved", "rejected"].includes(String(row.status)) ? row.status : "draft") as LetterVersionStatus,
    authorName: String(row.author_name ?? ""),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? row.created_at ?? ""),
    sentAt: text(row.sent_at),
    sentByName: text(row.sent_by_name),
    approvedBy: text(row.approved_by),
    approvedAt: text(row.approved_at)?.slice(0, 10) ?? null,
    approvalNote: text(row.approval_note),
    rejectedBy: text(row.rejected_by),
    rejectedAt: text(row.rejected_at)?.slice(0, 10) ?? null,
    rejectionNote: text(row.rejection_note),
    recordedByName: text(row.recorded_by_name),
    recordedAt: text(row.recorded_at),
  };
}

/** The columns a version is written with. */
function rowOf(version: LetterVersion, ids: { authorId?: string | null; recordedBy?: string | null } = {}): Row {
  return {
    id: version.id,
    template_key: version.templateKey,
    version: version.version,
    origin: version.origin,
    locale: version.locale,
    subject: version.subject,
    body: version.body,
    variables: version.variables,
    based_on: version.basedOn,
    content_hash: version.contentHash,
    status: version.status,
    ...(ids.authorId !== undefined ? { author_id: ids.authorId } : {}),
    author_name: version.authorName,
    created_at: version.createdAt,
    updated_at: version.updatedAt,
    sent_at: version.sentAt,
    sent_by_name: version.sentByName,
    approved_by: version.approvedBy,
    approved_at: version.approvedAt,
    approval_note: version.approvalNote,
    rejected_by: version.rejectedBy,
    rejected_at: version.rejectedAt,
    rejection_note: version.rejectionNote,
    ...(ids.recordedBy !== undefined ? { recorded_by: ids.recordedBy } : {}),
    recorded_by_name: version.recordedByName,
    recorded_at: version.recordedAt,
  };
}

/** Every version the connection may read, by letter and number. */
export async function listLetterVersions(db: SupabaseClient, filter: { templateKeys?: readonly string[]; approvedOnly?: boolean } = {}): Promise<LetterVersion[]> {
  let query = db.from(TABLE).select("*");
  if (filter.templateKeys) query = query.in("template_key", [...filter.templateKeys]);
  if (filter.approvedOnly) query = query.eq("status", "approved");
  const { data, error } = await query.order("template_key").order("version");
  if (error) throw new Error(`${TABLE}: ${error.message}`);
  return ((data as Row[] | null) ?? []).map(versionFromRow);
}

/** POST /api/staff/letters: what the editor asks for. Strict: a field the route does not expect is refused. */
export const lettersBodySchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("save_draft"),
      templateKey: z.string().regex(/^[a-z0-9_]{1,80}$/),
      subject: z.string().max(400),
      body: z.string().max(25_000),
    })
    .strict(),
  z.object({ action: z.literal("discard_draft"), id: z.string().uuid() }).strict(),
  z.object({ action: z.literal("send_to_attorney"), templateKeys: z.array(z.string().regex(/^[a-z0-9_]{1,80}$/)).min(1).max(60) }).strict(),
  z
    .object({
      action: z.literal("record_decision"),
      id: z.string().uuid(),
      decision: z.enum(["approved", "rejected"]),
      attorneyName: z.string().max(200),
      decidedOn: z.string().max(10),
      note: z.string().max(2_000),
      confirmed: z.boolean(),
    })
    .strict(),
]);

export type LettersBody = z.infer<typeof lettersBodySchema>;

export interface Actor {
  userId: string | null;
  name: string;
}

const uuid = () => crypto.randomUUID();

async function versionsForKey(db: SupabaseClient, templateKey: string): Promise<LetterVersion[]> {
  return listLetterVersions(db, { templateKeys: [templateKey] });
}

async function byId(db: SupabaseClient, id: string): Promise<LetterVersion[]> {
  const { data, error } = await db.from(TABLE).select("*").eq("id", id).limit(1);
  if (error) throw new Error(`${TABLE}: ${error.message}`);
  const row = ((data as Row[] | null) ?? [])[0];
  return row ? listLetterVersions(db, { templateKeys: [String(row.template_key)] }) : [];
}

const conflict = (message: string): VersionResult<never> => ({ ok: false, status: 409, problems: [{ code: "conflict", message }] });

/** Saves the editor's text as a new draft, or rewrites the open one. `db` is the service role. */
export async function saveDraft(db: SupabaseClient, input: { templateKey: string; subject: string; body: string }, actor: Actor, now = new Date()): Promise<VersionResult<LetterVersion>> {
  const versions = await versionsForKey(db, input.templateKey);
  const plan = planDraft(versions, input, actor.name, now, uuid);
  if (!plan.ok) return plan;
  const { version, replaces } = plan.value;
  if (replaces) {
    const { data, error } = await db
      .from(TABLE)
      .update({
        subject: version.subject,
        body: version.body,
        variables: version.variables,
        content_hash: version.contentHash,
        based_on: version.basedOn,
        author_id: actor.userId,
        author_name: version.authorName,
        updated_at: version.updatedAt,
      })
      .eq("id", replaces.id)
      .eq("status", "draft")
      .select("*");
    if (error) throw new Error(`${TABLE}: ${error.message}`);
    const row = ((data as Row[] | null) ?? [])[0];
    return row ? { ok: true, value: versionFromRow(row) } : conflict("El borrador ya se envió al abogado. Vuelve a abrir la carta.");
  }
  const { data, error } = await db.from(TABLE).insert(rowOf(version, { authorId: actor.userId })).select("*").single();
  // Two saves at once: the unique (letter, number) or one-draft index refused the second.
  if (error || !data) return conflict("Alguien guardó otra versión de esta carta al mismo tiempo. Vuelve a abrirla.");
  return { ok: true, value: versionFromRow(data as Row) };
}

export async function discardDraft(db: SupabaseClient, id: string): Promise<VersionResult<LetterVersion>> {
  const plan = planDiscard(await byId(db, id), id);
  if (!plan.ok) return plan;
  const { error } = await db.from(TABLE).delete().eq("id", id).eq("status", "draft");
  if (error) throw new Error(`${TABLE}: ${error.message}`);
  return plan;
}

/** "Enviar al abogado": each letter's draft (or version 1) is sent and frozen. */
export async function sendToAttorney(db: SupabaseClient, templateKeys: readonly string[], actor: Actor, now = new Date()): Promise<VersionResult<LetterVersion[]>> {
  const sent: LetterVersion[] = [];
  for (const templateKey of [...new Set(templateKeys)]) {
    const plan = planSend(await versionsForKey(db, templateKey), templateKey, actor.name, now, uuid);
    if (!plan.ok) {
      if (templateKeys.length === 1) return plan;
      continue; // In a batch, a letter with nothing to send is skipped.
    }
    const { version, isNew } = plan.value;
    if (isNew) {
      const { data, error } = await db.from(TABLE).insert(rowOf(version, { authorId: null })).select("*").single();
      if (error || !data) return conflict("Otra persona envió esta carta al mismo tiempo. Vuelve a abrirla.");
      sent.push(versionFromRow(data as Row));
    } else {
      const { data, error } = await db
        .from(TABLE)
        .update({ status: "sent", sent_at: version.sentAt, sent_by_name: version.sentByName, updated_at: version.updatedAt })
        .eq("id", version.id)
        .eq("status", "draft")
        .select("*");
      if (error) throw new Error(`${TABLE}: ${error.message}`);
      const row = ((data as Row[] | null) ?? [])[0];
      if (!row) return conflict("El borrador cambió mientras lo enviabas. Vuelve a abrir la carta.");
      sent.push(versionFromRow(row));
    }
  }
  if (sent.length === 0) return { ok: false, status: 409, problems: [{ code: "nothing_to_send", message: "No hay nada que enviar al abogado." }] };
  return { ok: true, value: sent };
}

/** "Marcar aprobada" / "Marcar rechazada": the attorney's decision, recorded once. */
export async function recordDecision(db: SupabaseClient, id: string, input: DecisionInput, actor: Actor, now = new Date()): Promise<VersionResult<LetterVersion>> {
  const plan = planDecision(await byId(db, id), id, input, actor.name, now);
  if (!plan.ok) return plan;
  const v = plan.value;
  const { data, error } = await db
    .from(TABLE)
    .update({
      status: v.status,
      approved_by: v.approvedBy,
      approved_at: v.approvedAt,
      approval_note: v.approvalNote,
      rejected_by: v.rejectedBy,
      rejected_at: v.rejectedAt,
      rejection_note: v.rejectionNote,
      recorded_by: actor.userId,
      recorded_by_name: v.recordedByName,
      recorded_at: v.recordedAt,
      updated_at: v.updatedAt,
    })
    .eq("id", id)
    .eq("status", "sent")
    .select("*");
  if (error) throw new Error(`${TABLE}: ${error.message}`);
  const row = ((data as Row[] | null) ?? [])[0];
  return row ? { ok: true, value: versionFromRow(row) } : conflict("Otra persona registró la decisión al mismo tiempo. Vuelve a abrir la carta.");
}
