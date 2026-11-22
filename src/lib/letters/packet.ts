import type { ItemCategory, LetterTarget, ReportItem, UserProfile } from "../domain/types";
import {
  CATEGORY_LABELS,
  LETTER_CATALOGUE,
  ORIGINAL_TEMPLATE_KEYS,
  renderLetter,
  type LetterContext,
  type LetterCategory,
  type LetterMeta,
  type LetterRecipient,
} from "./library";

// The attorney review packet: every template in the library, with its metadata
// and the letter rendered for one fictional consumer. `npm run letters:packet`
// writes the Markdown to docs/LETTER-LIBRARY.md; a test asserts the committed
// file equals this output, so the packet cannot drift from the templates.
//
// Everything here is fixed (date, consumer, items, recipients) so the output is
// the same on every run.

export const PACKET_PATH = "docs/LETTER-LIBRARY.md";
export const PACKET_DATE = "2026-01-15T12:00:00.000Z";

/** Where the client's own words go. Shown in brackets so the attorney can see the position. */
export const PACKET_DETAILS =
  "[The client's own words appear here: what is wrong and what the correct information is, or the client's statement or offer.]";

export const DECISION_LINE = "Attorney decision: ☐ approve ☐ approve with changes ☐ do not use — notes:";

const SAMPLE_CONSUMER: UserProfile = {
  id: "sample",
  fullName: "Elena Marisol Vargas",
  addressLines: ["1420 Sample Street, Apt 3B", "San Antonio, TX 78205"],
  locale: "es",
};

// Recipients are written out here instead of read from the bureau registry: the
// packet must not change when a mailing address is re-verified.
const SAMPLE_TARGETS: Record<LetterRecipient, LetterTarget> = {
  bureau: {
    type: "bureau",
    key: "equifax",
    name: "Equifax Information Services LLC",
    addressLines: ["P.O. Box 740256", "Atlanta, GA 30374-0256"],
  },
  secondary_bureau: {
    type: "secondary_bureau",
    key: "sample_specialty_agency",
    name: "Sample Specialty Reporting Agency",
    addressLines: ["P.O. Box 1000", "Atlanta, GA 30301"],
  },
  furnisher: {
    type: "furnisher",
    key: "Northgate Bank",
    name: "Northgate Bank",
    addressLines: ["Attn: Credit Reporting Disputes", "P.O. Box 2500", "Wilmington, DE 19801"],
  },
  collector: {
    type: "furnisher",
    key: "Summit Recovery Services",
    name: "Summit Recovery Services",
    addressLines: ["P.O. Box 4400", "Columbus, OH 43216"],
  },
};

const sampleItem = (category: ItemCategory, name: string, data: Record<string, unknown>): ReportItem => ({
  fingerprint: `sample:${category}:${name}`,
  bureau: "equifax",
  category,
  name,
  data,
  negative: true,
});

const SAMPLE_ACCOUNT = sampleItem("tradeline", "Northgate Bank", { accountNumberMasked: "****4821", status: "charged off" });
const SAMPLE_COLLECTION = sampleItem("tradeline", "Summit Recovery Services", { accountNumberMasked: "****7730", status: "collection" });
const SAMPLE_BY_CATEGORY: Record<ItemCategory, ReportItem> = {
  tradeline: SAMPLE_ACCOUNT,
  inquiry: sampleItem("inquiry", "Lakeshore Auto Finance", { date: "2025-09-03" }),
  public_record: sampleItem("public_record", "Bexar County Court — civil judgment", { date: "2021-04-12", status: "filed" }),
  personal_info: sampleItem("personal_info", "Address: 77 Other Road, Dallas, TX 75201", {}),
};

export const RECIPIENT_LABELS: Record<LetterRecipient, string> = {
  bureau: "Credit bureau (Equifax, Experian or TransUnion)",
  secondary_bureau: "Secondary or specialty reporting agency",
  furnisher: "Creditor or other furnisher",
  collector: "Debt collector",
};

export const STAGE_LABELS: Record<NonNullable<LetterMeta["stageHint"]>, string> = {
  dispute: "First dispute",
  mov: "After the bureau says 'verified'",
  furnisher_direct: "Direct to the furnisher",
  follow_up: "Follow-up",
};

/** The one sample item a letter of this kind lists (none for letters that list no items). */
export function sampleItemsFor(meta: LetterMeta): ReportItem[] {
  if (meta.appliesTo.length === 0) return [];
  if (meta.recipient === "collector" || meta.key === "bureau_medical_collection") return [SAMPLE_COLLECTION];
  return [SAMPLE_BY_CATEGORY[meta.appliesTo[0]]];
}

/**
 * The fictional consumer's letter context for this template: the packet's,
 * and the letter editor's preview (with the parts it can switch off).
 */
export function sampleLetterContext(
  meta: LetterMeta,
  options: { details?: string | null; enclosures?: boolean; reasonCode?: string | null } = {},
): LetterContext {
  const items = sampleItemsFor(meta);
  return {
    user: SAMPLE_CONSUMER,
    target: SAMPLE_TARGETS[meta.recipient],
    items,
    date: PACKET_DATE,
    roundNumber: 1,
    enclosures: options.enclosures === false ? [] : meta.enclosures,
    ...(options.details === null ? {} : { details: options.details ?? PACKET_DETAILS }),
    ...(options.reasonCode ? { itemReasons: Object.fromEntries(items.map((i) => [i.fingerprint, options.reasonCode!])) } : {}),
  };
}

/** The letter exactly as it would be sent for the sample consumer. */
export function renderSampleLetter(meta: LetterMeta): string {
  return renderLetter(meta.key, sampleLetterContext(meta));
}

export interface PacketEntry {
  number: number;
  meta: LetterMeta;
  categoryLabel: string;
  recipientLabel: string;
  stageLabel: string | null;
  /** One of the ten letters the round engine already uses. */
  original: boolean;
  letter: string;
}

export const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS) as LetterCategory[];

/** Every template, grouped by category in a fixed order and numbered. */
export function packetEntries(): PacketEntry[] {
  const ordered = CATEGORY_ORDER.flatMap((category) => LETTER_CATALOGUE.filter((meta) => meta.category === category));
  return ordered.map((meta, index) => ({
    number: index + 1,
    meta,
    categoryLabel: CATEGORY_LABELS[meta.category].en,
    recipientLabel: RECIPIENT_LABELS[meta.recipient],
    stageLabel: meta.stageHint ? STAGE_LABELS[meta.stageHint] : null,
    original: ORIGINAL_TEMPLATE_KEYS.includes(meta.key),
    letter: renderSampleLetter(meta),
  }));
}

export const ORIGINAL_STATUS = "Original letter, in use today (wording unchanged)";
export const NEW_STATUS = "New draft, not in use";

export const COVER_TITLE = "Credalti letter library — attorney review packet";

/** The cover note, as paragraphs and lists, shared by the Markdown and PDF versions. */
export function coverNote(entries: PacketEntry[]): Array<{ heading: string; paragraphs?: string[]; bullets?: string[] }> {
  const flagged = entries.filter((e) => e.meta.attorneyAttention);
  return [
    {
      heading: "What this is",
      paragraphs: [
        `This packet contains all ${entries.length} letter templates in the Credalti letter library. Every one is a DRAFT pending attorney review; each is marked "attorney_pending" in the software. ${entries.filter((e) => e.original).length} of them, marked "${ORIGINAL_STATUS}", are the letters the software already sends. The rest are new and are not used anywhere yet.`,
        "Each letter is written in the consumer's own name and over the consumer's own signature, and no letter mentions Credalti. Credalti is a credit repair company. The client tells us which items are wrong and why, and that statement is recorded with a date before any letter is prepared. Credalti then prepares each letter and mails it for the client, under the client's written authorization.",
        "How the letters are sent is the point we most need your advice on: see the first item under \"What we are asking you to check\".",
        "This packet shows each letter as it is in the software (version 1). The owner can change a letter's wording in the software's letter editor; every change is a new version that comes to you in a separate, shorter packet showing exactly what changed. The software mails a letter to a real client only after your approval of that exact text has been recorded, with your name and the date; until then, a round of letters that uses it is not sent.",
      ],
    },
    {
      heading: "The rules these drafts were written to",
      paragraphs: [
        "The new drafts follow the rules below. The original letters were written before these rules and are reproduced unchanged; where an original departs from a rule, its note says so.",
      ],
      bullets: [
        "First person, plain and polite English, the consumer's own voice.",
        'A letter states a fact only if the client has stated it. Each entry lists the "facts the client must have provided"; without them the letter may not be used.',
        "The law is cited for what is being asked and not overstated. In particular, FCRA § 609 is treated only as a right to see the file. No new letter says or implies that § 609, or a missing original contract, requires anything to be deleted.",
        "No threats, no demands for money, no accusations that the recipient broke the law. Follow-up letters may say the consumer may submit a complaint to the Consumer Financial Protection Bureau.",
        "No promises about results, to anyone.",
      ],
    },
    {
      heading: "What we are asking you to check",
      bullets: [
        "Whether letters that Credalti prepares and mails may go out in the client's name without saying so; what authorization the client must sign for that (for example a limited power of attorney); and whether any of these letters should disclose Credalti's role.",
        "Each citation and each description of what a statute provides. The citations were checked by web search against passages quoted from the U.S. Code, the FTC, the CFPB and the Federal Reserve; the official texts could not be opened directly from our build environment, so please treat every citation as unconfirmed until you have checked it.",
        "Whether each letter says only what the listed client facts support, and whether the listed facts are the right ones to require.",
        "Tone: whether anything reads as a threat, a demand, an accusation or a promise.",
        `The ${flagged.length} letters carrying an "Attorney attention" note (${flagged.map((e) => `no. ${e.number}`).join(", ")}). These include the settlement offer, the goodwill request, the cease-communication request, the identity-theft letters and the medical-collection dispute.`,
        "The ten original letters. Their wording is unchanged because the software depends on them; where an original is firmer than the new drafts, or cites the law loosely, its note says so and asks whether it should be reworded or replaced.",
        "Direct disputes to furnishers: 12 C.F.R. § 1022.43(b)(2) lets a furnisher decline to investigate a direct dispute it reasonably believes was prepared by a credit repair organization. Please advise how that applies to letters a client prepares with our software.",
        "Anything state-specific. These drafts cite federal law only.",
      ],
    },
    {
      heading: "How to read each entry",
      paragraphs: [
        "Each entry gives the letter's title, its key in the software, who it is sent to, when staff may use it, the facts the client must have provided, the statutes it relies on, any note for you or for staff, and then the full letter as it would be mailed.",
        "The sample consumer, accounts, creditor and collector are fictional and the same throughout. The enclosure list under each signature shows the suggested enclosures; a real letter lists only what is actually attached. A paragraph in [square brackets] marks where the client's own words are inserted; when the client gives none, that paragraph is left out.",
        "One more thing to know: the software has two features, both switched off, that would make letters look less alike: automatic rewording of the prose, and rotating print and handwriting-style fonts. While they are off, every letter is mailed exactly as approved, in one plain print font. They stay off unless you advise that they are appropriate.",
        `Please mark each entry on its last line: "${DECISION_LINE}"`,
      ],
    },
  ];
}

function entryMarkdown(entry: PacketEntry): string {
  const { meta } = entry;
  const lines: string[] = [
    `## ${entry.number}. ${meta.title.en}`,
    "",
    `*${meta.title.es}*`,
    "",
    `- **Key:** \`${meta.key}\``,
    `- **Status:** ${entry.original ? ORIGINAL_STATUS : NEW_STATUS}`,
    `- **Group:** ${entry.categoryLabel}`,
    `- **Sent to:** ${entry.recipientLabel}`,
  ];
  if (entry.stageLabel) lines.push(`- **Stage:** ${entry.stageLabel}`);
  lines.push(
    `- **When it is used:** ${meta.useWhen.en}`,
    `- **Statutes:** ${meta.statutes.length > 0 ? meta.statutes.join("; ") : "None cited (a request, not a statutory dispute)"}`,
    "",
    "**Facts the client must have provided:**",
    "",
    ...meta.requiresFacts.map((fact) => `- ${fact}`),
    "",
    `**Suggested enclosures:** ${meta.enclosures.length > 0 ? meta.enclosures.join("; ") : "None"}`,
    "",
  );
  if (meta.attorneyAttention) lines.push(`**Attorney attention:** ${meta.attorneyAttention}`, "");
  if (meta.staffNote) lines.push(`**Note to staff:** ${meta.staffNote}`, "");
  lines.push("**The letter (sample data):**", "", "```text", entry.letter, "```", "", `**${DECISION_LINE}**`, "");
  return lines.join("\n");
}

/** The whole packet as Markdown. Deterministic: same templates in, same text out. */
export function buildLetterPacket(): string {
  const entries = packetEntries();
  const out: string[] = [
    `# ${COVER_TITLE}`,
    "",
    "<!-- Generated by `npm run letters:packet` from src/lib/letters. Do not edit by hand: change the templates or the catalogue and run the script again. -->",
    "",
    "**Status: drafts pending attorney review.**",
    "",
  ];

  for (const section of coverNote(entries)) {
    out.push(`### ${section.heading}`, "");
    for (const paragraph of section.paragraphs ?? []) out.push(paragraph, "");
    if (section.bullets) out.push(...section.bullets.map((bullet) => `- ${bullet}`), "");
  }

  out.push("### Contents", "");
  for (const category of CATEGORY_ORDER) {
    const inCategory = entries.filter((e) => e.meta.category === category);
    if (inCategory.length === 0) continue;
    out.push(`**${CATEGORY_LABELS[category].en}**`, "");
    out.push(...inCategory.map((e) => `- ${e.number}. ${e.meta.title.en} (\`${e.meta.key}\`)${e.meta.attorneyAttention ? " — attorney attention" : ""}`), "");
  }

  for (const entry of entries) out.push("---", "", entryMarkdown(entry));

  return `${out.join("\n").trimEnd()}\n`;
}
