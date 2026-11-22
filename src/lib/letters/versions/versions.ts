import { sha256Hex } from "../../agreement/sha256";
import type { LetterContext } from "../parts";
import { renderLetter, TEMPLATES } from "../templates";
import { builtinSource, chipsUsed, normalizeSource, renderSource, type LetterSource } from "./source";
import { validateLetterSource, type SourceProblem } from "./validate";

// Versions of a letter, and which one is mailed.
//
//   version 1   the text in code ("incluida"). It has a row only once it is
//               sent to the attorney.
//   version 2+  an edit made in /equipo/cartas.
//
// A version is a draft while it is being written (it can be changed or
// thrown away), then "sent" to the attorney, then approved or rejected with
// the attorney's name, the date and a note. Once sent, its text never changes
// (migration 0019 enforces it): a change is a new version.
//
// What is mailed (resolveLetter): the newest approved version whose text is
// intact. An approval of version 1 counts only while the text in code is the
// text the attorney approved (same hash); a developer's change to a template
// needs a new approval, as a new agreement version does (docs/AGREEMENT.md).
// With no approved version the letter is version 1, unapproved, and a round
// that uses it cannot be mailed with a database (lettersMayBeMailed).

export type LetterVersionStatus = "draft" | "sent" | "approved" | "rejected";

export interface LetterVersion {
  id: string;
  templateKey: string;
  version: number;
  origin: "builtin" | "edited";
  locale: "en";
  subject: string;
  body: string;
  /** The chips the text uses. */
  variables: string[];
  /** The version this one was edited from. Null for version 1. */
  basedOn: number | null;
  contentHash: string;
  status: LetterVersionStatus;
  authorName: string;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  sentByName: string | null;
  /** The attorney's name, as the owner recorded it. The attorney is not a user. */
  approvedBy: string | null;
  /** The day the attorney approved it (YYYY-MM-DD). */
  approvedAt: string | null;
  approvalNote: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectionNote: string | null;
  /** The teammate who recorded the attorney's decision, and when. */
  recordedByName: string | null;
  recordedAt: string | null;
}

export const STATUS_LABEL: Record<LetterVersionStatus, string> = {
  draft: "Borrador",
  sent: "Con el abogado",
  approved: "Aprobada",
  rejected: "Rechazada",
};

/** The text's fingerprint: what an approval is an approval of. */
export function contentHash(templateKey: string, source: LetterSource): string {
  const { subject, body } = normalizeSource(source);
  return sha256Hex([`template: ${templateKey}`, "locale: en", `subject: ${subject}`, "", body].join("\n"));
}

export function builtinHash(templateKey: string): string {
  return contentHash(templateKey, builtinSource(templateKey));
}

/** A version's text is the text its hash names: nobody changed the row after the fact. */
export function intact(version: Pick<LetterVersion, "templateKey" | "subject" | "body" | "contentHash" | "origin">): boolean {
  if (version.contentHash !== contentHash(version.templateKey, version)) return false;
  // Version 1's approval follows the text in code: a changed template is a different text.
  return version.origin !== "builtin" || version.contentHash === builtinHash(version.templateKey);
}

/** A complete approval: the attorney's name and the date, on a version whose text is intact. */
export function validApproval(version: LetterVersion): boolean {
  return version.status === "approved" && Boolean(version.approvedBy?.trim()) && Boolean(version.approvedAt) && intact(version);
}

export interface ResolvedLetter {
  templateKey: string;
  version: number;
  origin: "builtin" | "edited";
  contentHash: string;
  /** True when an attorney approved this text. */
  approved: boolean;
  source: LetterSource;
  approvedBy: string | null;
  approvedAt: string | null;
}

/** The versions of one letter, newest first. */
export function versionsOf(templateKey: string, versions: readonly LetterVersion[]): LetterVersion[] {
  return versions.filter((v) => v.templateKey === templateKey).sort((a, b) => b.version - a.version);
}

/** Which text a letter is mailed with: the newest approved version, else version 1 (unapproved). */
export function resolveLetter(templateKey: string, versions: readonly LetterVersion[]): ResolvedLetter {
  const approved = versionsOf(templateKey, versions).find(validApproval);
  if (approved) {
    return {
      templateKey,
      version: approved.version,
      origin: approved.origin,
      contentHash: approved.contentHash,
      approved: true,
      source: { subject: approved.subject, body: approved.body },
      approvedBy: approved.approvedBy,
      approvedAt: approved.approvedAt,
    };
  }
  return {
    templateKey,
    version: 1,
    origin: "builtin",
    contentHash: builtinHash(templateKey),
    approved: false,
    source: builtinSource(templateKey),
    approvedBy: null,
    approvedAt: null,
  };
}

/**
 * The letter as mailed. Version 1 is rendered by the template in code (the
 * same text, by the test in letterVersions.test.ts); an edited version by its
 * stored text.
 */
export function renderResolved(resolved: ResolvedLetter, ctx: LetterContext): string {
  return resolved.origin === "builtin" ? renderLetter(resolved.templateKey, ctx) : renderSource(resolved.templateKey, resolved.source, ctx);
}

/** Renders one letter with whatever versions are known: the one-call form for screens. */
export function renderWithVersions(templateKey: string, ctx: LetterContext, versions: readonly LetterVersion[] | undefined): string {
  if (!versions || versions.length === 0) return renderLetter(templateKey, ctx);
  return renderResolved(resolveLetter(templateKey, versions), ctx);
}

// ── The readiness rule ──────────────────────────────────────────────────

/** LETTERS_ALLOW_UNAPPROVED=1 lets unapproved letters mail. For testing with Lob's test key only. */
export function unapprovedLettersAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return env.LETTERS_ALLOW_UNAPPROVED === "1";
}

export type MailableCheck = { ok: true; allowedUnapproved: string[] } | { ok: false; unapproved: string[]; message: string };

/**
 * Whether a round that uses these templates may be mailed: every one has an
 * attorney-approved version, or LETTERS_ALLOW_UNAPPROVED=1 is set. Applied by
 * rounds/send.ts to every round, mailed or printed, before anything is sent.
 */
export function lettersMayBeMailed(
  templateKeys: readonly string[],
  versions: readonly LetterVersion[],
  env: Record<string, string | undefined> = process.env,
): MailableCheck {
  const unapproved = [...new Set(templateKeys)].filter((key) => !resolveLetter(key, versions).approved);
  if (unapproved.length === 0) return { ok: true, allowedUnapproved: [] };
  if (unapprovedLettersAllowed(env)) return { ok: true, allowedUnapproved: unapproved };
  return {
    ok: false,
    unapproved,
    message: `Esta ronda usa cartas que el abogado todavía no aprobó (${unapproved.join(", ")}). Un administrador las aprueba en Cartas (/equipo/cartas) y después se envía la ronda.`,
  };
}

// ── Changes, as pure functions (the demo applies them; the server writes them) ──

export type VersionResult<T> = { ok: true; value: T } | { ok: false; status: number; problems: SourceProblem[] };

const fail = (status: number, code: string, message: string): { ok: false; status: number; problems: SourceProblem[] } => ({
  ok: false,
  status,
  problems: [{ code, message }],
});

/** The open draft of a letter, if there is one. */
export function openDraft(templateKey: string, versions: readonly LetterVersion[]): LetterVersion | null {
  return versionsOf(templateKey, versions).find((v) => v.status === "draft") ?? null;
}

/** Versions sent to the attorney and not decided yet. */
export function pendingVersions(versions: readonly LetterVersion[]): LetterVersion[] {
  return versions.filter((v) => v.status === "sent");
}

/**
 * Saving the editor: a new draft, or the open draft changed. The text must
 * pass validateLetterSource and differ from the text in use.
 */
export function planDraft(
  versions: readonly LetterVersion[],
  input: { templateKey: string; subject: string; body: string },
  by: string,
  now: Date,
  newId: () => string,
): VersionResult<{ version: LetterVersion; replaces: LetterVersion | null }> {
  if (!TEMPLATES[input.templateKey]) return fail(404, "unknown_template", "Esa carta no existe en la biblioteca.");
  const source = normalizeSource(input);
  const check = validateLetterSource(input.templateKey, source);
  if (!check.ok) return { ok: false, status: 422, problems: check.errors };
  const current = resolveLetter(input.templateKey, versions);
  const hash = contentHash(input.templateKey, source);
  if (hash === current.contentHash) return fail(422, "unchanged", "No hay cambios respecto al texto en uso.");

  const draft = openDraft(input.templateKey, versions);
  const at = now.toISOString();
  if (draft) {
    return {
      ok: true,
      value: {
        replaces: draft,
        version: { ...draft, ...source, variables: chipsUsed(source), contentHash: hash, basedOn: current.version, updatedAt: at, authorName: by },
      },
    };
  }
  const highest = Math.max(1, ...versionsOf(input.templateKey, versions).map((v) => v.version));
  return {
    ok: true,
    value: {
      replaces: null,
      version: {
        id: newId(),
        templateKey: input.templateKey,
        version: highest + 1,
        origin: "edited",
        locale: "en",
        ...source,
        variables: chipsUsed(source),
        basedOn: current.version,
        contentHash: hash,
        status: "draft",
        authorName: by,
        createdAt: at,
        updatedAt: at,
        sentAt: null,
        sentByName: null,
        approvedBy: null,
        approvedAt: null,
        approvalNote: null,
        rejectedBy: null,
        rejectedAt: null,
        rejectionNote: null,
        recordedByName: null,
        recordedAt: null,
      },
    },
  };
}

/**
 * "Enviar al abogado" for one letter: its draft is sent; with no draft and
 * version 1 not yet approved or with the attorney, version 1 itself is sent
 * (it gets its row now). The text is frozen from here on.
 */
export function planSend(
  versions: readonly LetterVersion[],
  templateKey: string,
  by: string,
  now: Date,
  newId: () => string,
): VersionResult<{ version: LetterVersion; isNew: boolean }> {
  if (!TEMPLATES[templateKey]) return fail(404, "unknown_template", "Esa carta no existe en la biblioteca.");
  const at = now.toISOString();
  const draft = openDraft(templateKey, versions);
  if (draft) {
    const check = validateLetterSource(templateKey, draft);
    if (!check.ok) return { ok: false, status: 422, problems: check.errors };
    return { ok: true, value: { isNew: false, version: { ...draft, status: "sent", sentAt: at, sentByName: by, updatedAt: at } } };
  }
  const resolved = resolveLetter(templateKey, versions);
  const own = versionsOf(templateKey, versions);
  if (resolved.approved) return fail(409, "nothing_to_send", "No hay borrador: el texto en uso ya está aprobado.");
  if (own.some((v) => v.status === "sent")) return fail(409, "already_sent", "Esta carta ya está con el abogado.");
  const builtinRow = own.find((v) => v.version === 1);
  if (builtinRow && intact(builtinRow)) return fail(409, "already_decided", "El abogado ya revisó la versión incluida. Para cambiarla, edita la carta.");
  if (builtinRow) {
    // The template in code changed after version 1 was reviewed: its old row stays as the record.
    return fail(409, "builtin_changed", "La versión incluida cambió en el código después de la revisión. Edita la carta para enviar el texto nuevo.");
  }
  const source = builtinSource(templateKey);
  return {
    ok: true,
    value: {
      isNew: true,
      version: {
        id: newId(),
        templateKey,
        version: 1,
        origin: "builtin",
        locale: "en",
        ...source,
        variables: chipsUsed(source),
        basedOn: null,
        contentHash: builtinHash(templateKey),
        status: "sent",
        authorName: "incluida",
        createdAt: at,
        updatedAt: at,
        sentAt: at,
        sentByName: by,
        approvedBy: null,
        approvedAt: null,
        approvalNote: null,
        rejectedBy: null,
        rejectedAt: null,
        rejectionNote: null,
        recordedByName: null,
        recordedAt: null,
      },
    },
  };
}

export interface DecisionInput {
  decision: "approved" | "rejected";
  /** The attorney's name. */
  attorneyName: string;
  /** The day the attorney decided, YYYY-MM-DD. */
  decidedOn: string;
  note: string;
  /** The owner confirmed this is the attorney's decision, not their own. */
  confirmed: boolean;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Recording the attorney's decision on a version that is with the attorney. */
export function planDecision(versions: readonly LetterVersion[], id: string, input: DecisionInput, by: string, now: Date): VersionResult<LetterVersion> {
  const version = versions.find((v) => v.id === id);
  if (!version) return fail(404, "not_found", "No encontramos esa versión.");
  if (version.status !== "sent") return fail(409, "not_pending", "Solo se registra la decisión de una versión que está con el abogado.");
  if (!input.confirmed) return fail(422, "not_confirmed", "Confirma que es la decisión del abogado.");
  const attorney = input.attorneyName.replace(/\s+/g, " ").trim();
  if (attorney.length < 3 || attorney.length > 120) return fail(422, "attorney_name", "Escribe el nombre completo del abogado.");
  if (!DAY.test(input.decidedOn) || Number.isNaN(new Date(`${input.decidedOn}T12:00:00Z`).getTime())) {
    return fail(422, "decided_on", "Escribe la fecha en que decidió el abogado.");
  }
  if (new Date(`${input.decidedOn}T00:00:00Z`).getTime() > now.getTime() + 36 * 60 * 60 * 1000) {
    return fail(422, "decided_on_future", "La fecha de la decisión no puede ser futura.");
  }
  const note = input.note.trim();
  if (note.length > 2000) return fail(422, "note_long", "La nota es muy larga: máximo 2,000 caracteres.");
  if (input.decision === "rejected" && note.length === 0) return fail(422, "note_missing", "Anota qué pidió cambiar el abogado.");
  if (!intact(version)) return fail(409, "not_intact", "El texto de esta versión ya no coincide con el que se envió. No se puede aprobar.");
  const at = now.toISOString();
  return {
    ok: true,
    value:
      input.decision === "approved"
        ? { ...version, status: "approved", approvedBy: attorney, approvedAt: input.decidedOn, approvalNote: note || null, recordedByName: by, recordedAt: at, updatedAt: at }
        : { ...version, status: "rejected", rejectedBy: attorney, rejectedAt: input.decidedOn, rejectionNote: note, recordedByName: by, recordedAt: at, updatedAt: at },
  };
}

/** Throwing away a draft. Nothing else can be deleted. */
export function planDiscard(versions: readonly LetterVersion[], id: string): VersionResult<LetterVersion> {
  const version = versions.find((v) => v.id === id);
  if (!version) return fail(404, "not_found", "No encontramos esa versión.");
  if (version.status !== "draft") return fail(409, "not_draft", "Solo se descarta un borrador. Lo enviado al abogado queda como registro.");
  return { ok: true, value: version };
}
