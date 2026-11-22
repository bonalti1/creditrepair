"use client";

import { playbookFor } from "@/lib/staff/playbook";
import type { ExceptionKind } from "@/lib/staff/stage";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import Icon from "@/components/Icon";

// «Cómo se resuelve»: the short card for one kind of notice
// (src/lib/staff/playbook.ts). Open in focus mode and in the help panel;
// folded under each item of the queue, one tap away.

function Steps({ kind }: { kind: ExceptionKind }) {
  const { locale } = useStaffLocale();
  const t = useTx();
  const card = playbookFor(kind, locale);
  return (
    <>
      <ol className="mt-2 space-y-1.5">
        {card.steps.map((step, i) => (
          <li key={i} className="flex gap-2.5 text-[14px] leading-snug text-slate-700">
            <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[12px] font-semibold text-blue-700 tabular-nums">{i + 1}</span>
            <span className="min-w-0">{step}</span>
          </li>
        ))}
      </ol>
      <p className="mt-2.5 flex gap-2 rounded-xl bg-green-50 px-3 py-2 text-[13.5px] leading-snug text-green-800">
        <Icon name="check" size={16} className="mt-px shrink-0" />
        <span>
          <span className="font-semibold">{t("Hecho cuando… ", "Done when… ")}</span>
          {card.doneWhen}
        </span>
      </p>
    </>
  );
}

/** The card, always open (focus mode, help). */
export function PlaybookCard({ kind, title = true }: { kind: ExceptionKind; title?: boolean }) {
  const { locale } = useStaffLocale();
  const t = useTx();
  const heading = t("Cómo se resuelve", "How to handle it");
  const name = playbookFor(kind, locale).title;
  return (
    <section className="rounded-2xl border border-blue-100 bg-white px-4 py-3" data-testid="playbook-card" aria-label={`${heading}: ${name}`}>
      <p className="flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wide text-blue-700">
        <Icon name="book" size={15} />
        {heading}
        {title ? ` · ${name}` : ""}
      </p>
      <Steps kind={kind} />
    </section>
  );
}

/** The card folded, for a row of the queue: one tap opens it. */
export function PlaybookToggle({ kind }: { kind: ExceptionKind }) {
  const t = useTx();
  return (
    <details className="group mt-2" data-testid="playbook-toggle">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-full text-[13.5px] font-semibold text-blue-700 [&::-webkit-details-marker]:hidden">
        <Icon name="book" size={15} />
        <span className="group-open:hidden">{t("Cómo se resuelve", "How to handle it")}</span>
        <span className="hidden group-open:inline">{t("Ocultar cómo se resuelve", "Hide how to handle it")}</span>
      </summary>
      <div className="rounded-2xl border border-blue-100 bg-white px-4 py-3">
        <Steps kind={kind} />
      </div>
    </details>
  );
}
