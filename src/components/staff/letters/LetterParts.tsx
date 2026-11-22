import { DEFAULT_LETTER_FONT } from "@/lib/letters/fonts";
import type { DiffPart } from "@/lib/letters/versions/diff";
import { CHIPS, isChipKey, TOKEN } from "@/lib/letters/versions/source";

// Small pieces of the letter editor and the attorney's packet.

/**
 * A letter as it prints: one plain print font (fonts.ts DEFAULT_LETTER_FONT,
 * never the rotation, which stays off), the text exactly as rendered, on a
 * sheet of paper.
 */
export function LetterPaper({ text, testId }: { text: string; testId?: string }) {
  return (
    <div
      data-testid={testId}
      className="overflow-x-auto rounded-xl border border-slate-200 bg-white px-5 py-6 shadow-sm sm:px-10 sm:py-10 print:rounded-none print:border-0 print:px-0 print:shadow-none"
    >
      <div
        className="min-w-0 whitespace-pre-wrap break-words text-slate-900"
        style={{ fontFamily: `'${DEFAULT_LETTER_FONT.family}', 'Times New Roman', serif`, fontSize: `${DEFAULT_LETTER_FONT.sizePt}pt`, lineHeight: 1.35 }}
      >
        {text}
      </div>
    </div>
  );
}

/** Text with its {chips} drawn as chips (labels in Spanish, or as written for the attorney). */
export function ChipText({ text, english = false }: { text: string; english?: boolean }) {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const match of text.matchAll(TOKEN)) {
    if (match.index! > last) out.push(text.slice(last, match.index));
    const key = match[1]!;
    out.push(
      <span
        key={`c${i++}`}
        className={`mx-0.5 inline-flex items-center whitespace-nowrap rounded-md border px-1.5 font-sans text-[12px] font-semibold leading-[1.45] ${
          isChipKey(key) ? "border-blue-200 bg-blue-50 text-blue-800" : "border-red-300 bg-red-50 text-red-700"
        }`}
      >
        {isChipKey(key) ? (english ? CHIPS[key].attorneyLabel : CHIPS[key].label) : `{${key}}`}
      </span>,
    );
    last = match.index! + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

/**
 * A comparison: added words underlined on green, removed words struck through
 * on red. Underline and strike-through also read on a black-and-white print.
 */
export function DiffView({ parts, chips = true, inline = false, testId }: { parts: DiffPart[]; chips?: boolean; inline?: boolean; testId?: string }) {
  const Box = inline ? "span" : "div";
  return (
    <Box data-testid={testId} className="whitespace-pre-wrap break-words font-serif text-[15px] leading-[1.65] text-slate-800">
      {parts.map((part, index) => {
        const content = chips ? <ChipText text={part.text} /> : part.text;
        if (part.kind === "same") return <span key={index}>{content}</span>;
        if (part.kind === "added") {
          return (
            <ins key={index} className="rounded-sm bg-green-100 text-green-900 underline decoration-green-700 decoration-2 underline-offset-2">
              {content}
            </ins>
          );
        }
        return (
          <del key={index} className="rounded-sm bg-red-50 text-red-700 line-through decoration-red-600 decoration-2">
            {content}
          </del>
        );
      })}
    </Box>
  );
}
