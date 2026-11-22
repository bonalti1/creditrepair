import { CATEGORY_LABELS, getLetterMeta, type LetterMeta } from "../library";
import { CATEGORY_ORDER, DECISION_LINE, RECIPIENT_LABELS, sampleLetterContext, STAGE_LABELS } from "../packet";
import { renderLetter } from "../templates";
import { diffSources, type DiffPart } from "./diff";
import { CHIPS, isChipKey, renderSource, TOKEN, type LetterSource } from "./source";
import { resolveLetter, type LetterVersion } from "./versions";

// The attorney's packet for versions waiting on a decision ("Enviar al
// abogado" in /equipo/cartas). Built on the library packet (packet.ts): the
// same fictional consumer, recipients and decision line, so the attorney reads
// a change the way they read the library. Each entry gives the letter's
// details, the changes against the text in use, and the full new letter.

export const PENDING_COVER_TITLE = "Credalti letter changes — for attorney approval";

export interface PendingPacketEntry {
  number: number;
  meta: LetterMeta;
  version: LetterVersion;
  categoryLabel: string;
  recipientLabel: string;
  stageLabel: string | null;
  /** What the version would replace: the approved text in use, or version 1. */
  previous: { version: number; approved: boolean; approvedBy: string | null; approvedAt: string | null };
  /** The changes, in readable English (chips as bracketed descriptions). Empty for version 1 itself. */
  changes: { subject: DiffPart[]; body: DiffPart[] } | null;
  /** The letter for the fictional consumer, with the client's own words in brackets. */
  letter: string;
}

/** A version's text with each chip written out for the attorney: "[the client's own words]". */
export function attorneyText(source: LetterSource): LetterSource {
  const read = (text: string) => text.replace(TOKEN, (token, key: string) => (isChipKey(key) ? CHIPS[key].attorneyLabel : token));
  return { subject: read(source.subject), body: read(source.body) };
}

function sampleLetter(version: LetterVersion, meta: LetterMeta): string {
  const ctx = sampleLetterContext(meta);
  return version.origin === "builtin" ? renderLetter(version.templateKey, ctx) : renderSource(version.templateKey, version, ctx);
}

/** The versions with the attorney (or the ones named), in the library's order, numbered. */
export function pendingPacketEntries(versions: readonly LetterVersion[], ids?: readonly string[]): PendingPacketEntry[] {
  const wanted = versions.filter((v) => (ids ? ids.includes(v.id) : v.status === "sent"));
  const order = (v: LetterVersion) => {
    const meta = getLetterMeta(v.templateKey);
    return meta ? CATEGORY_ORDER.indexOf(meta.category) : 99;
  };
  const sorted = [...wanted].sort((a, b) => order(a) - order(b) || a.templateKey.localeCompare(b.templateKey) || a.version - b.version);
  const entries: PendingPacketEntry[] = [];
  for (const version of sorted) {
    const meta = getLetterMeta(version.templateKey);
    if (!meta) continue;
    // Compared with the text in use today, leaving this version itself out.
    const previous = resolveLetter(
      version.templateKey,
      versions.filter((v) => v.id !== version.id && v.version < version.version),
    );
    entries.push({
      number: entries.length + 1,
      meta,
      version,
      categoryLabel: CATEGORY_LABELS[meta.category].en,
      recipientLabel: RECIPIENT_LABELS[meta.recipient],
      stageLabel: meta.stageHint ? STAGE_LABELS[meta.stageHint] : null,
      previous: { version: previous.version, approved: previous.approved, approvedBy: previous.approvedBy, approvedAt: previous.approvedAt },
      changes: version.origin === "builtin" ? null : diffSources(attorneyText(previous.source), attorneyText(version)),
      letter: sampleLetter(version, meta),
    });
  }
  return entries;
}

/** The cover note, shared by the printed page and the Markdown. */
export function pendingCoverNote(entries: PendingPacketEntry[]): string[] {
  const edits = entries.filter((e) => e.version.origin === "edited").length;
  const builtins = entries.length - edits;
  return [
    `This packet asks for your decision on ${entries.length} letter text${entries.length === 1 ? "" : "s"}: ${edits} changed by the owner in the letter editor, and ${builtins} as the software has them today (version 1). Until you approve a letter's text, the software will not mail that letter to a real client.`,
    "Each entry gives the letter's purpose, who it is sent to, the facts the client must have provided and the statutes it relies on; then, for a changed letter, every change against the text in use (added words underlined, removed words struck through); then the full letter as it would be mailed for a fictional consumer. Bracketed text marks the parts filled in for each client: the items the client disputed with the reason the client chose, and the client's own words.",
    "The header (the client's name and address, the date and the recipient), the salutation and the signature with the enclosure list are added by the software to every letter and cannot be edited. The software's automatic rewording and font rotation are switched off, so a letter is mailed exactly as approved, in one plain print font.",
    `Please mark each entry on its last line: "${DECISION_LINE}" The owner records your decision, your name and the date in the software, against this exact text (its fingerprint is printed with each entry).`,
  ];
}

const markdownDiff = (parts: DiffPart[]) =>
  parts.map((p) => (p.kind === "same" ? p.text : p.kind === "added" ? `<ins>${p.text}</ins>` : `<del>${p.text}</del>`)).join("");

/** The packet as Markdown (for the record and the tests). Deterministic for the same versions. */
export function buildPendingPacketMarkdown(entries: PendingPacketEntry[]): string {
  const out: string[] = [`# ${PENDING_COVER_TITLE}`, "", ...pendingCoverNote(entries).flatMap((p) => [p, ""])];
  for (const entry of entries) {
    const { meta, version } = entry;
    out.push(
      "---",
      "",
      `## ${entry.number}. ${meta.title.en} — version ${version.version}`,
      "",
      `- **Key:** \`${meta.key}\``,
      `- **Version:** ${version.version} (${version.origin === "builtin" ? "the text in the software today" : `changed from version ${entry.previous.version}`})`,
      `- **Replaces:** version ${entry.previous.version}, ${entry.previous.approved ? `approved by ${entry.previous.approvedBy} on ${entry.previous.approvedAt}` : "not yet approved"}`,
      `- **Fingerprint (SHA-256):** \`${version.contentHash}\``,
      `- **Group:** ${entry.categoryLabel}`,
      `- **Sent to:** ${entry.recipientLabel}`,
      ...(entry.stageLabel ? [`- **Stage:** ${entry.stageLabel}`] : []),
      `- **When it is used:** ${meta.useWhen.en}`,
      `- **Statutes:** ${meta.statutes.length > 0 ? meta.statutes.join("; ") : "None cited (a request, not a statutory dispute)"}`,
      "",
      "**Facts the client must have provided:**",
      "",
      ...meta.requiresFacts.map((fact) => `- ${fact}`),
      "",
    );
    if (meta.attorneyAttention) out.push(`**Attorney attention:** ${meta.attorneyAttention}`, "");
    if (entry.changes) {
      out.push("**Changes:**", "", `Re: ${markdownDiff(entry.changes.subject)}`, "", markdownDiff(entry.changes.body), "");
    }
    out.push("**The letter (sample data):**", "", "```text", entry.letter, "```", "", `**${DECISION_LINE}**`, "");
  }
  return `${out.join("\n").trimEnd()}\n`;
}
