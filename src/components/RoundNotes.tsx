import type { RoundNote } from "@/lib/ux/roundCopy";
import Icon from "@/components/Icon";

// Two plain notes about a round, shown the same way wherever they appear.

/**
 * "Not everything you confirmed is in these letters": what waits for the next
 * round and when. Sits directly above every approve button.
 */
export function WaitingNote({ note, className = "" }: { note: RoundNote; className?: string }) {
  return (
    <div
      role="note"
      data-testid="waiting-note"
      className={`rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3.5 ${className}`}
    >
      <p className="flex items-start gap-2 text-[16px] font-semibold leading-snug text-slate-900">
        <Icon name="clock" size={20} className="mt-px shrink-0 text-amber-700" />
        <span>{note.title}</span>
      </p>
      <p className="mt-1.5 text-[15px] leading-relaxed text-slate-800">{note.body}</p>
    </div>
  );
}

/** A quiet, neutral line of information on a card (same account on another bureau, letters already out…). */
export function InfoNote({
  children,
  className = "",
  testId,
}: {
  children: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <p
      role="note"
      data-testid={testId}
      className={`flex items-start gap-2.5 rounded-2xl bg-slate-100 px-4 py-3 text-[14px] leading-snug text-slate-700 ${className}`}
    >
      <Icon name="doc" size={18} className="mt-px shrink-0 text-slate-500" />
      <span>{children}</span>
    </p>
  );
}
