"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n";
import { demoProgram } from "@/lib/partners/data";
import { howItWorksCopy } from "@/lib/partners/sharingCopy";
import { demoPartnerByCode } from "@/lib/partners/sharingDemo";
import { isDemoMode } from "@/lib/supabase/config";
import LocaleToggle from "@/components/LocaleToggle";
import Logo from "@/components/Logo";
import { PartnerBadge, type SharePartnerFace } from "./ShareChoice";

// "Cómo funciona Credalti": one page a partner shares with the people they
// refer, with the partner's name (and logo, once approved). The words are in
// sharingCopy.ts and pass the advertising claim rules. Whether the partner is
// paid for the referral is said plainly either way ("Comisiones a socios").
// The button goes through the partner's link (/r/<code>), which credits them.

export default function HowItWorks({ code }: { code: string }) {
  const { locale } = useLocale();
  const [partner, setPartner] = useState<SharePartnerFace | null | "missing">(null);
  const [fees, setFees] = useState(false);

  useEffect(() => {
    if (isDemoMode()) {
      const p = demoPartnerByCode(code);
      setPartner(p ? { name: p.name, company: p.company, logo: null } : "missing");
      setFees(demoProgram().commissionsEnabled);
      return;
    }
    fetch(`/api/partners/public?code=${encodeURIComponent(code)}`)
      .then(async (r) => {
        const body = (await r.json().catch(() => ({}))) as { partner?: SharePartnerFace; commissionsEnabled?: boolean };
        setFees(body.commissionsEnabled === true);
        setPartner(body.partner ?? "missing");
      })
      .catch(() => setPartner("missing"));
  }, [code]);

  if (partner === null) return null;
  if (partner === "missing") {
    return (
      <main className="mx-auto max-w-md px-6 py-16 text-center text-[16px] text-slate-600">
        <Logo size={28} />
        <p className="mt-6">{locale === "es" ? "Esta página no está disponible." : "This page is not available."}</p>
      </main>
    );
  }
  const c = howItWorksCopy(locale, partner, fees);
  return (
    <main className="mx-auto min-h-dvh max-w-md bg-white px-6 pb-12 pt-6" data-testid="how-it-works">
      <div className="flex items-center justify-between">
        <Logo size={26} priority />
        <LocaleToggle />
      </div>
      <div className="card mt-6 p-4">
        <PartnerBadge partner={partner} line={c.eyebrow.replace(`${partner.name}${partner.company ? `, ${partner.company}` : ""}`, "").trim()} />
      </div>
      <h1 className="mt-6 font-display text-[32px] font-bold leading-tight text-blue-700">{c.title}</h1>
      <p className="mt-3 text-[17px] leading-relaxed text-slate-600">{c.lead}</p>

      <h2 className="mt-8 text-[13px] font-semibold uppercase tracking-wide text-slate-500">{c.stepsTitle}</h2>
      <ol className="mt-3 space-y-4">
        {c.steps.map((step, i) => (
          <li key={step.title} className="flex gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-400 text-[15px] font-semibold text-blue-900">{i + 1}</span>
            <span>
              <strong className="block text-[16px] text-slate-900">{step.title}</strong>
              <span className="text-[15px] leading-snug text-slate-600">{step.body}</span>
            </span>
          </li>
        ))}
      </ol>

      <h2 className="mt-8 text-[13px] font-semibold uppercase tracking-wide text-slate-500">{c.honestTitle}</h2>
      <ul className="mt-3 space-y-2">
        {c.honest.map((line) => (
          <li key={line} className="flex gap-2.5 text-[15px] leading-snug text-slate-700">
            <span aria-hidden="true" className="mt-[8px] h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
            <span>{line}</span>
          </li>
        ))}
      </ul>

      <div className="mt-8 rounded-3xl bg-slate-50 p-5">
        <h2 className="text-[16px] font-semibold text-slate-900">{c.sharingTitle}</h2>
        <p className="mt-1 text-[15px] leading-relaxed text-slate-600">{c.sharing}</p>
        <p className="mt-3 text-[14px] font-medium text-slate-700" data-testid="fees-line">{c.fees}</p>
      </div>

      <a href={`/r/${code}`} className="pressable mt-8 flex h-14 w-full items-center justify-center rounded-full bg-amber-400 text-[17px] font-semibold text-blue-900 hover:bg-amber-500">
        {c.cta}
      </a>
      <p className="mt-4 text-center text-[12.5px] text-slate-500">{c.footer}</p>
    </main>
  );
}
