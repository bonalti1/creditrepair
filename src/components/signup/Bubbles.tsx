"use client";

import { CharacterAvatar } from "@/components/Character";
import { aiByline } from "@/lib/brand";
import type { ChatLine } from "@/lib/signup/copy";

// The chat's bubbles. Alti's lines are grouped in runs: "Alti · AI
// assistant" above the first line of every run (and inside each bubble for
// screen readers), his face beside the last. The person's own answers sit on
// the right. No other character appears in this chat (docs/BRAND.md).

export function AltiRun({ lines, locale, children }: { lines: string[]; locale: "en" | "es"; children?: React.ReactNode }) {
  if (lines.length === 0 && !children) return null;
  return (
    <div className="msg-in">
      <p data-testid="ai-byline" className="mb-1 ml-9 text-xs font-semibold text-slate-500">
        {aiByline(locale)}
      </p>
      <div className="space-y-1.5">
        {lines.map((text, i) => (
          <div key={i} className="flex items-end gap-1.5">
            {i === lines.length - 1 && !children ? (
              <CharacterAvatar character="assistant" size={28} decorative className="mb-0.5" />
            ) : (
              <span aria-hidden="true" className="w-7 shrink-0" />
            )}
            <p className="max-w-[85%] whitespace-pre-line break-words rounded-[22px] rounded-bl-md bg-slate-100 px-4 py-2.5 text-[16px] leading-snug text-slate-900">
              <span className="sr-only">{aiByline(locale)}: </span>
              {text}
            </p>
          </div>
        ))}
        {children && (
          <div className="flex items-end gap-1.5">
            <CharacterAvatar character="assistant" size={28} decorative className="mb-0.5" />
            <div className="min-w-0 max-w-[92%] flex-1">{children}</div>
          </div>
        )}
      </div>
    </div>
  );
}

export function YouBubble({ text }: { text: string }) {
  return (
    <div className="msg-in flex justify-end">
      <p className="max-w-[80%] whitespace-pre-line break-words rounded-[22px] rounded-br-md bg-blue-700 px-4 py-2.5 text-[16px] leading-snug text-white">{text}</p>
    </div>
  );
}

/** The transcript as runs: consecutive Alti lines together. */
export function Transcript({ lines, locale, lastRunChildren }: { lines: ChatLine[]; locale: "en" | "es"; lastRunChildren?: React.ReactNode }) {
  const runs: Array<{ who: "alti" | "you"; texts: string[]; key: string }> = [];
  for (const line of lines) {
    const last = runs[runs.length - 1];
    if (last && last.who === line.who && line.who === "alti") last.texts.push(line.text);
    else runs.push({ who: line.who, texts: [line.text], key: line.key });
  }
  return (
    <>
      {runs.map((run, i) =>
        run.who === "alti" ? (
          <AltiRun key={run.key} lines={run.texts} locale={locale}>
            {i === runs.length - 1 ? lastRunChildren : undefined}
          </AltiRun>
        ) : (
          <YouBubble key={run.key} text={run.texts[0]!} />
        ),
      )}
      {runs.length > 0 && runs[runs.length - 1]!.who === "you" && lastRunChildren && <AltiRun lines={[]} locale={locale}>{lastRunChildren}</AltiRun>}
    </>
  );
}

export function TypingDots({ label }: { label: string }) {
  return (
    <div className="flex items-end gap-1.5" role="status" aria-label={label}>
      <span aria-hidden="true" className="w-7 shrink-0" />
      <span className="flex gap-1 rounded-[22px] rounded-bl-md bg-slate-100 px-4 py-3.5" aria-hidden="true">
        <span className="typing-dot h-2 w-2 rounded-full bg-slate-400" />
        <span className="typing-dot h-2 w-2 rounded-full bg-slate-400 [animation-delay:150ms]" />
        <span className="typing-dot h-2 w-2 rounded-full bg-slate-400 [animation-delay:300ms]" />
      </span>
    </div>
  );
}
