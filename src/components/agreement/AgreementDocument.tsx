import { Fragment } from "react";
import { isTexasSpecific, type AgreementDocument, type Block } from "@/lib/agreement/documents";
import { PLACEHOLDER_PATTERN } from "@/lib/agreement/terms";

// One document of the agreement, set for reading on a phone: one comfortable
// column, generous line height, real headings. The same component draws the
// signing screens and the printable copy, so both show the same text.
//
// Two things are made visible while the text is still a draft:
//  - a business fact the owner has not filled in shows as a gold placeholder;
//  - a passage that is specific to Texas law, which the attorney has to check
//    with that law in hand, carries a gold rule on its left.

function withPlaceholders(text: string) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    parts.push(
      <mark key={at} className="rounded bg-amber-100 px-0.5 font-medium text-blue-900">
        {match[0]}
      </mark>,
    );
    last = at + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function isEnglishOfficial(block: Block): boolean {
  return block.origin === "federal_statute" || block.origin === "texas_statute";
}

function BlockView({ block, marks, locale, compact }: { block: Block; marks: boolean; locale: "es" | "en"; compact: boolean }) {
  const texas = marks && isTexasSpecific(block.origin) ? "border-l-2 border-amber-400 pl-3" : "";
  // Official English text inside a Spanish page is announced as English.
  const lang = locale === "es" && isEnglishOfficial(block) ? "en" : undefined;
  const weight = block.bold ? "font-semibold text-slate-900" : "text-slate-800";

  if (block.kind === "heading") {
    return (
      <h3 lang={lang} className={`mt-7 break-words text-[17px] font-semibold leading-snug text-slate-900 first:mt-0 ${texas}`}>
        {withPlaceholders(block.text)}
      </h3>
    );
  }
  if (block.kind === "blank") {
    return (
      <p lang={lang} className={`mt-1.5 break-words text-[16px] leading-relaxed ${weight} ${texas}`}>
        {withPlaceholders(block.text)}
      </p>
    );
  }
  if (compact) {
    return (
      <p lang={lang} className={`mt-2.5 break-words text-[15px] leading-snug first:mt-0 ${weight} ${texas}`}>
        {withPlaceholders(block.text)}
      </p>
    );
  }
  return (
    <p lang={lang} className={`mt-3 break-words text-[16px] leading-[1.65] ${weight} ${texas}`}>
      {withPlaceholders(block.text)}
    </p>
  );
}

/** A run of passages, with consecutive list items drawn as one list. */
export function Blocks({
  blocks,
  marks,
  locale,
  compact = false,
}: {
  blocks: Block[];
  marks: boolean;
  locale: "es" | "en";
  /** Tighter setting, for the statements that sit right next to the signature. */
  compact?: boolean;
}) {
  const groups: Array<Block | Block[]> = [];
  for (const block of blocks) {
    const last = groups[groups.length - 1];
    if (block.kind === "item" && Array.isArray(last)) last.push(block);
    else groups.push(block.kind === "item" ? [block] : block);
  }
  return (
    <>
      {groups.map((group, index) =>
        Array.isArray(group) ? (
          <ul key={index} className="mt-3 space-y-3">
            {group.map((block, i) => (
              <li
                key={i}
                className={`flex gap-3 break-words text-[16px] leading-[1.65] text-slate-800 ${
                  marks && isTexasSpecific(block.origin) ? "border-l-2 border-amber-400 pl-3" : ""
                }`}
              >
                <span className="mt-[11px] h-1.5 w-1.5 shrink-0 rounded-full bg-blue-700" aria-hidden="true" />
                <span className="min-w-0">{withPlaceholders(block.text)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Fragment key={index}>
            <BlockView block={group} marks={marks} locale={locale} compact={compact} />
          </Fragment>
        ),
      )}
    </>
  );
}

export default function AgreementDocumentCard({
  document,
  locale,
  marks,
  number,
  id,
}: {
  document: AgreementDocument;
  locale: "es" | "en";
  /** Show the draft markings (Texas rule, legend). Off once an attorney approved the version. */
  marks: boolean;
  /** "Documento 2 de 3". */
  number?: string;
  id?: string;
}) {
  const hasTexas = marks && document.blocks.some((b) => isTexasSpecific(b.origin));
  return (
    <section id={id} data-document={document.key} className="agreement-document card scroll-mt-20 px-5 py-6 sm:px-7">
      {number && <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">{number}</p>}
      <h2 className="mt-1 break-words text-[22px] font-semibold leading-tight text-slate-900">{document.title}</h2>
      <p className="mt-1.5 text-[13px] leading-snug text-slate-500">
        {locale === "es" ? "Lo exige: " : "Required by: "}
        {document.law}
      </p>
      {hasTexas && (
        <p className="mt-3 flex items-start gap-2.5 text-[13px] leading-snug text-slate-600 print:hidden">
          <span className="mt-0.5 h-4 w-0.5 shrink-0 bg-amber-400" aria-hidden="true" />
          {locale === "es"
            ? "La línea dorada marca lo que es propio de la ley de Texas y está pendiente de revisión por un abogado."
            : "The gold line marks what is specific to Texas law and is pending an attorney's review."}
        </p>
      )}
      <div className="mt-5">
        <Blocks blocks={document.blocks} marks={marks} locale={locale} />
      </div>
    </section>
  );
}

/** Shown wherever the text on screen has not been approved by an attorney. */
export function DraftBanner({ locale, demo }: { locale: "es" | "en"; demo: boolean }) {
  const es = locale === "es";
  return (
    <div role="note" data-testid="draft-banner" className="rounded-2xl bg-amber-100 px-4 py-3 text-blue-900">
      <p className="text-[15px] font-semibold">{es ? "Borrador: pendiente de revisión legal" : "Draft: pending legal review"}</p>
      <p className="mt-0.5 text-[14px] leading-snug">
        {demo
          ? es
            ? "Un abogado todavía no ha revisado este texto, y faltan datos de la empresa. En esta demostración puedes firmarlo para ver cómo funciona: se guarda solo en este dispositivo y no tiene validez."
            : "An attorney has not reviewed this text yet, and some company details are missing. In this demo you can sign it to see how it works: it is saved on this device only and has no legal effect."
          : es
            ? "Un abogado todavía no ha revisado este texto. No se puede firmar hasta que lo apruebe."
            : "An attorney has not reviewed this text yet. It cannot be signed until it is approved."}
      </p>
    </div>
  );
}
