"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { renderLetter } from "@/lib/letters/templates";
import { useDiyRound } from "@/lib/diy/useDiyRound";
import { useLocale } from "@/lib/i18n";
import { useServiceOption } from "@/lib/service/useServiceOption";
import { useFlags } from "@/lib/ux/flagsStore";
import { useClientReport } from "@/lib/ux/reportStore";
import { sessionPlan } from "@/lib/ux/sessionPlan";

// Credalti DIY: "Print my letters". The letters exactly as they were prepared
// (with an account: the approved text the server rendered and saved; the
// demo: the same templates, with this device's answers), one per page, ready
// to print or save as a PDF from the browser. The screen's own controls do not
// print. Only for a DIY client: under Credalti Complete the team mails them.

export default function PrintMyLetters() {
  const { locale } = useLocale();
  const es = locale === "es";
  const { option, hydrated: optionReady } = useServiceOption();
  const diy = useDiyRound();
  const { roundFlags, hydrated } = useFlags();
  const view = useClientReport();
  const [today, setToday] = useState<Date | null>(null);
  useEffect(() => setToday(new Date()), []);

  const session = useMemo(() => sessionPlan(view.items, roundFlags, view.report.pulledAt), [view.items, roundFlags, view.report.pulledAt]);

  if (!hydrated || !view.ready || !diy.hydrated || !optionReady || !today) return null;

  const sender = view.profile?.fullName ? { id: "me", fullName: view.profile.fullName, addressLines: view.profile.addressLines, locale: "es" as const } : { id: "demo", fullName: es ? "Tu Nombre" : "Your Name", addressLines: [es ? "Tu dirección" : "Your address", "Houston, TX 77002"], locale: "es" as const };

  // With an account: the prepared letters on record. The demo: rendered here from the same templates.
  const letters: Array<{ key: string; to: string; address: string[]; body: string }> = diy.round
    ? diy.round.letters
        .filter((l) => l.status === "draft" && !l.requested)
        .map((l) => ({ key: l.id, to: l.targetName, address: l.targetAddressLines, body: l.body }))
    : session.plan.letters.map((letter, i) => ({
        key: `${letter.target.key}-${i}`,
        to: letter.target.name,
        address: letter.target.addressLines,
        body: renderLetter(letter.templateKey, {
          user: sender,
          target: letter.target,
          items: view.items.filter((item) => letter.itemFingerprints.includes(item.fingerprint)),
          date: today.toISOString(),
          roundNumber: session.roundNumber,
          itemReasons: session.itemReasons,
          itemDetails: session.itemDetails,
        }),
      }));

  if (option !== "diy" || !diy.prepared) {
    return (
      <main className="space-y-4">
        <h1 className="px-1 text-[28px] font-semibold leading-tight tracking-tight text-slate-900">{es ? "Imprimir mis cartas" : "Print my letters"}</h1>
        <p className="card px-5 py-5 text-[15px] leading-relaxed text-slate-600">
          {option !== "diy"
            ? es
              ? "Con Credalti Complete nuestro equipo imprime y envía tus cartas por ti."
              : "With Credalti Complete our team prints and mails your letters for you."
            : es
              ? "Primero prepara tus cartas en «Mis cartas»."
              : "Prepare your letters first, in \"My letters\"."}
        </p>
        <Link href="/attack" className="pressable flex h-12 items-center justify-center rounded-full bg-slate-100 text-[16px] font-medium text-slate-900">
          {es ? "Volver a mis cartas" : "Back to my letters"}
        </Link>
      </main>
    );
  }

  return (
    <main className="space-y-5">
      <header className="space-y-3 px-1 print:hidden">
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-slate-900">{es ? "Imprimir mis cartas" : "Print my letters"}</h1>
        <p className="text-[15px] leading-relaxed text-slate-600">
          {es
            ? `${letters.length === 1 ? "1 carta" : `${letters.length} cartas`}, una por página. Firma cada una, mete en cada sobre una copia de tu identificación y de tu comprobante de domicilio, y envíala a la dirección que aparece arriba de la carta. Después toca «Ya las envié».`
            : `${letters.length === 1 ? "1 letter" : `${letters.length} letters`}, one per page. Sign each one, put a copy of your ID and proof of address in each envelope, and mail it to the address at the top of the letter. Then tap "I mailed them".`}
        </p>
        <div className="flex flex-wrap gap-2.5">
          <button type="button" onClick={() => window.print()} className="pressable h-12 rounded-full bg-amber-400 px-6 text-[16px] font-semibold text-blue-900 hover:bg-amber-500">
            {es ? "Imprimir o guardar PDF" : "Print or save as PDF"}
          </button>
          <Link href="/attack" className="pressable flex h-12 items-center rounded-full bg-slate-100 px-5 text-[16px] font-medium text-slate-900 hover:bg-slate-200">
            {es ? "Volver a mis cartas" : "Back to my letters"}
          </Link>
        </div>
        {diy.demo && <p className="text-[13px] text-slate-500">{es ? "Demo: nombre y dirección de ejemplo." : "Demo: sample name and address."}</p>}
      </header>
      {letters.map((letter) => (
        <article key={letter.key} className="card break-after-page px-6 py-6 print:break-after-page print:rounded-none print:shadow-none print:ring-0">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-500 print:hidden">{es ? "Para" : "To"}</p>
          <p className="text-[15px] font-medium text-slate-900">{letter.to}</p>
          {letter.address.map((line) => (
            <p key={line} className="text-[14px] text-slate-700">
              {line}
            </p>
          ))}
          <pre className="mt-5 whitespace-pre-wrap break-words font-serif text-[14px] leading-relaxed text-slate-900">{letter.body}</pre>
        </article>
      ))}
    </main>
  );
}
