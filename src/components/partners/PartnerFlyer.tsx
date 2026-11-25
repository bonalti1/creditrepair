"use client";

import { useEffect, useMemo, useState } from "react";
import { CharacterFigure } from "@/components/Character";
import Logo from "@/components/Logo";
import LocaleToggle from "@/components/LocaleToggle";
import { aiByline, BRAND } from "@/lib/brand";
import { useLocale } from "@/lib/i18n";
import { demoProgram } from "@/lib/partners/data";
import { flyerCopy } from "@/lib/partners/portal";
import { qrSvg } from "@/lib/partners/qr";
import { partnerLink } from "@/lib/partners/rules";
import { demoPartnerByCode } from "@/lib/partners/sharingDemo";
import { isDemoMode } from "@/lib/supabase/config";
import { PartnerBadge, type SharePartnerFace } from "./ShareChoice";

// The partner's printable flyer (/conoce/<code>/imprimir): one letter-size
// page with their name (and logo, once an administrator approved it), Alti
// (labelled as the AI assistant), the QR code of their link, and the process
// in plain words, with whether the partner is paid. Print styles hide the
// buttons; the page fits one sheet. The words pass the claim rules (a test).

export default function PartnerFlyer({ code }: { code: string }) {
  const { locale } = useLocale();
  const [partner, setPartner] = useState<SharePartnerFace | null | "missing">(null);
  const [fees, setFees] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
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

  const link = origin && code ? partnerLink(origin, code) : "";
  const qr = useMemo(() => (link ? qrSvg(link, { title: locale === "es" ? "Código QR para empezar" : "QR code to get started" }) : ""), [link, locale]);

  if (partner === null) return null;
  if (partner === "missing") {
    return (
      <main className="mx-auto max-w-md px-6 py-16 text-center text-[16px] text-slate-600">
        <Logo size={28} />
        <p className="mt-6">{locale === "es" ? "Esta página no está disponible." : "This page is not available."}</p>
      </main>
    );
  }
  const c = flyerCopy(locale, partner, fees);

  return (
    <div className="flyer-page min-h-dvh bg-slate-100 py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-[8.5in] items-center justify-end gap-2 px-4 print:hidden">
        <LocaleToggle />
        <button type="button" onClick={() => window.print()} className="pressable inline-flex h-11 items-center rounded-full bg-amber-400 px-5 text-[15px] font-semibold text-blue-900 hover:bg-amber-500" data-testid="flyer-print">
          {c.print}
        </button>
      </div>
      <main
        className="mx-auto flex max-w-[8.5in] flex-col overflow-hidden bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12)] print:max-w-none print:shadow-none sm:min-h-[11in]"
        data-testid="partner-flyer"
      >
        <div className="bg-blue-900 px-8 pb-0 pt-8 text-white sm:px-12 sm:pt-10">
          <div className="flex items-start justify-between gap-6">
            <Logo size={34} tone="dark" priority />
            <p className="rounded-full bg-white/10 px-3 py-1 text-[13px] font-medium text-blue-100">{locale === "es" ? "En inglés o en español" : "In English or Spanish"}</p>
          </div>
          <div className="mt-6 grid items-end gap-4 sm:grid-cols-[1fr_auto]">
            <div className="pb-8">
              <h1 className="font-display text-[34px] font-bold leading-[1.1] sm:text-[42px]">{c.title}</h1>
              <p className="mt-4 max-w-[34ch] text-[17px] leading-relaxed text-blue-100">{c.lead}</p>
            </div>
            <figure className="hidden flex-col items-center sm:flex">
              <CharacterFigure character="assistant" pose="thumbsUp" height={250} />
              <figcaption className="-mt-1 mb-3 rounded-full bg-white px-3 py-1 text-[12px] font-semibold text-blue-900">{aiByline(locale)}</figcaption>
            </figure>
          </div>
        </div>

        <div className="grid flex-1 gap-8 px-8 py-8 sm:grid-cols-[1fr_auto] sm:px-12 sm:py-10">
          <div>
            <div className="rounded-2xl border hairline p-4">
              <PartnerBadge partner={partner} line={c.eyebrow.replace(`${partner.name}${partner.company ? `, ${partner.company}` : ""}`, "").trim()} />
            </div>
            <ul className="mt-6 space-y-3">
              {c.points.map((point) => (
                <li key={point} className="flex gap-3 text-[16px] leading-snug text-slate-800">
                  <span aria-hidden="true" className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-400 text-[13px] font-semibold text-blue-900">✓</span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-[14px] font-medium text-slate-700" data-testid="flyer-fees">{c.fees}</p>
          </div>
          <div className="flex flex-col items-center gap-3 sm:w-[2.4in]">
            {qr && (
              <div
                className="w-full max-w-[2.4in] overflow-hidden rounded-2xl border-2 border-blue-900 bg-white p-2"
                role="img"
                aria-label={locale === "es" ? "Código QR para empezar" : "QR code to get started"}
                // Generated here from the partner's validated code (lib/partners/qr.ts): no outside markup.
                dangerouslySetInnerHTML={{ __html: qr }}
              />
            )}
            <p className="text-center text-[16px] font-semibold text-blue-900">{c.scan}</p>
            <p className="break-all text-center text-[12.5px] text-slate-500">{link.replace(/^https?:\/\//, "")}</p>
            <figure className="mt-2 flex flex-col items-center sm:hidden">
              <CharacterFigure character="assistant" pose="thumbsUp" height={150} />
              <figcaption className="mt-1 text-[12px] font-semibold text-blue-900">{aiByline(locale)}</figcaption>
            </figure>
            <p className="text-center text-[12.5px] text-slate-600">{c.alti}</p>
          </div>
        </div>
        <p className="border-t hairline px-8 py-4 text-center text-[11.5px] leading-snug text-slate-500 sm:px-12">
          {locale === "es"
            ? `Los resultados varían según cada caso. ${BRAND.assistant} es inteligencia artificial, no una persona.`
            : `Results vary case by case. ${BRAND.assistant} is artificial intelligence, not a person.`}
        </p>
      </main>
    </div>
  );
}
