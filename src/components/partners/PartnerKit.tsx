"use client";

import { useMemo, useState } from "react";
import { kitMessages, TEAM_PROMISE, type L } from "@/lib/partners/portal";
import { PORTAL_COPY } from "@/lib/partners/portalCopy";
import { PARTNER_COPY } from "@/lib/partners/copy";
import { qrSvg } from "@/lib/partners/qr";
import { PARTNER_SHARING_COPY } from "@/lib/partners/sharingCopy";
import Icon from "@/components/Icon";

// "Share Credalti", the partner kit: their link and its QR code, three
// ready-to-send messages in English and in Spanish (each passes the claim
// rules and says whether the partner is paid: portal.ts kitMessages), the
// printable flyer (/conoce/<code>/imprimir) and the "How Credalti works" page.

function CopyButton({ text, label, done, className = "" }: { text: string; label: string; done: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          // The text is on screen to select by hand.
        }
      }}
      className={`pressable inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[14px] font-semibold ${className}`}
    >
      <Icon name={copied ? "check" : "clipboard"} size={16} />
      <span aria-live="polite">{copied ? done : label}</span>
    </button>
  );
}

export function TeamPromiseCard({ locale }: { locale: L }) {
  const p = TEAM_PROMISE[locale];
  return (
    <section className="rounded-3xl bg-blue-900 p-5 text-white" aria-labelledby="promise" data-testid="team-promise">
      <h2 id="promise" className="flex items-center gap-2 text-[16px] font-semibold">
        <span data-on-navy className="text-amber-300"><Icon name="team" size={19} /></span>
        {p.title}
      </h2>
      <ul className="mt-3 space-y-2">
        {p.lines.map((line) => (
          <li key={line} className="flex gap-2.5 text-[14px] leading-snug text-blue-50">
            <span data-on-navy className="mt-0.5 shrink-0 text-amber-300"><Icon name="check" size={16} /></span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function PartnerKit({
  locale,
  link,
  code,
  partner,
  commissionsEnabled,
}: {
  locale: L;
  link: string;
  code: string;
  partner: { name: string; kind: string };
  commissionsEnabled: boolean;
}) {
  const c = PORTAL_COPY[locale];
  const portal = PARTNER_COPY[locale].portal;
  const s = PARTNER_SHARING_COPY[locale];
  const [lang, setLang] = useState<L>(locale);
  const qr = useMemo(() => qrSvg(link, { title: portal.qrAlt }), [link, portal.qrAlt]);
  const messages = useMemo(() => kitMessages(partner, link, commissionsEnabled), [partner, link, commissionsEnabled]);

  return (
    <section className="card p-5" aria-labelledby="kit" id="kit" data-testid="partner-kit">
      <h2 id="kit" className="text-[18px] font-semibold text-slate-900">{c.kitTitle}</h2>
      <p className="mt-1 text-[13.5px] leading-snug text-slate-600">{c.kitHelp}</p>

      <div className="mt-4" data-testid="partner-link">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{portal.linkTitle}</p>
        <p className="mt-0.5 break-all text-[16px] font-medium text-slate-900">{link}</p>
        <p className="mt-1 text-[12.5px] leading-snug text-slate-500">{portal.linkHelp}</p>
        <div className="mt-3 flex items-center gap-4">
          <div
            className="h-28 w-28 shrink-0 overflow-hidden rounded-xl border hairline bg-white"
            role="img"
            aria-label={portal.qrAlt}
            // Generated here from the partner's own validated code (lib/partners/qr.ts): no outside markup.
            dangerouslySetInnerHTML={{ __html: qr }}
          />
          <div className="min-w-0 space-y-2">
            <CopyButton text={link} label={portal.copy} done={portal.copied} className="bg-amber-400 text-blue-900 hover:bg-amber-500" />
            <p className="text-[12.5px] leading-snug text-slate-500">{portal.qrHelp}</p>
          </div>
        </div>
      </div>

      <div className="mt-5 border-t hairline pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[15px] font-semibold text-slate-900">{c.messagesTitle}</h3>
          <div className="inline-flex rounded-full bg-slate-100 p-1" role="group" aria-label={c.messagesTitle}>
            {(["en", "es"] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={lang === l}
                onClick={() => setLang(l)}
                className={`h-8 rounded-full px-3 text-[13px] font-semibold ${lang === l ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
              >
                {l === "en" ? c.english : c.spanish}
              </button>
            ))}
          </div>
        </div>
        <ul className="mt-3 space-y-3" data-testid="kit-messages">
          {messages
            .filter((m) => m.locale === lang)
            .map((m) => (
              <li key={`${m.locale}-${m.key}`} className="rounded-2xl bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">{m.title}</p>
                  <CopyButton text={m.text} label={c.copyText} done={c.copiedText} className="bg-white text-blue-700 shadow-[0_0_0_1px_rgba(0,0,0,0.08)]" />
                </div>
                <p className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-slate-800" lang={m.locale}>
                  {m.key === "email" ? m.text.split("\n\n").slice(0, 3).join("\n\n") + " …" : m.text}
                </p>
              </li>
            ))}
        </ul>
      </div>

      <div className="mt-5 grid gap-2 border-t hairline pt-4">
        <a href={`/conoce/${code}/imprimir`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 hover:bg-slate-100" data-testid="flyer-link">
          <Icon name="download" size={20} className="shrink-0 text-blue-700" />
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-slate-900">{c.flyerTitle}</span>
            <span className="block text-[12.5px] leading-snug text-slate-500">{c.flyerHelp}</span>
          </span>
        </a>
        <a href={`/conoce/${code}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 hover:bg-slate-100" data-testid="how-it-works-link">
          <Icon name="doc" size={20} className="shrink-0 text-blue-700" />
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-slate-900">{s.howTitle}</span>
            <span className="block text-[12.5px] leading-snug text-slate-500">{s.howHelp}</span>
          </span>
        </a>
      </div>
    </section>
  );
}
