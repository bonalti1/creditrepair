"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n";
import { useCase } from "@/lib/case/useCase";
import { caseDay } from "@/lib/case/timeline";
import { useClientSharing, type ClientPartner } from "@/lib/partners/clientSharing";
import { partnerDisplay, progressFromCaseFacts, SHARE_LEVEL_LABEL, type ShareLevel, type SharingLevel } from "@/lib/partners/sharing";
import { CLIENT_SHARING_COPY } from "@/lib/partners/sharingCopy";
import { openShareRequest, SHARE_REQUEST_CARD } from "@/lib/partners/portal";
import Icon from "@/components/Icon";
import ShareChoice, { PartnerBadge, type SaveResult } from "@/components/partners/ShareChoice";

// "Más → Quién puede ver tu progreso": the partner who referred the client
// (and any they added by code), what each one can see, a preview of exactly
// that, who looked and when, and every choice the client made. Changing or
// stopping takes effect at once (the database reads the newest record on
// every request a partner makes). When a partner asked to follow the client's
// progress (migration 0033), their section says so and opens; the choice is
// the same, off by default.

export default function CompartirPage() {
  const { locale } = useLocale();
  const c = CLIENT_SHARING_COPY[locale];
  const { demo, state, failed, save, lookup } = useClientSharing();
  const kase = useCase(locale);
  const [now, setNow] = useState<Date | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [found, setFound] = useState<Omit<ClientPartner, "status" | "referred" | "level" | "how"> | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => setNow(new Date()), []);
  const [autoOpened, setAutoOpened] = useState(false);
  // One partner: open their choice once, on arrival.
  useEffect(() => {
    if (!state || autoOpened) return;
    setAutoOpened(true);
    const asked = (state.requests ?? []).find((r) => !r.dismissedAt);
    if (asked && state.partners.some((p) => p.id === asked.partnerId && p.level === "none")) setOpen(asked.partnerId);
    else if (state.partners.length === 1) setOpen(state.partners[0]!.id);
  }, [state, autoOpened]);

  if (failed) return <p className="card p-5 text-[15px] text-slate-600">{c.error}</p>;
  if (!state || !now) return null;
  const request = openShareRequest(
    state.requests ?? [],
    state.history.map((h) => ({ partnerId: h.partnerId, at: h.at })),
    state.partners.map((p) => ({ partnerId: p.id, level: p.level })),
    now,
  );

  const nameOf = (id: string) => state.partners.find((p) => p.id === id)?.name ?? "";
  const preview = (level: SharingLevel) =>
    progressFromCaseFacts(kase.facts, { name: state.me.name || "—", goal: state.me.goal, level, sharedAt: now.toISOString(), counts: state.counts ?? undefined });
  const saveFor = (target: { partnerId?: string; code?: string }) => async (level: ShareLevel, hash: string): Promise<SaveResult> => {
    const result = await save(target, level, hash, locale);
    if (result.ok) return result;
    return { ok: false, message: result.code === "text_changed" || result.code === "version_changed" ? c.stale : c.error };
  };

  const find = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotFound(false);
    const partner = await lookup(code);
    if (!partner || state.partners.some((p) => p.id === partner.id)) {
      if (partner) setOpen(partner.id);
      setFound(null);
      setNotFound(!partner);
      return;
    }
    setFound(partner);
  };

  return (
    <main className="animate-rise space-y-6" data-testid="sharing-page">
      <div>
        <Link href="/mas" className="inline-flex items-center gap-1 text-[15px] font-medium text-blue-700">
          <Icon name="chevron" size={16} className="rotate-180" />
          {locale === "es" ? "Más" : "More"}
        </Link>
        <h1 className="mt-2 px-1 font-display text-[30px] font-bold leading-tight text-blue-700">{c.title}</h1>
        <p className="mt-2 px-1 text-[15px] leading-relaxed text-slate-600">{c.intro}</p>
        {demo && <p className="mt-2 px-1 text-[13px] text-slate-500">{c.demoNote}</p>}
      </div>

      {state.partners.length === 0 && <p className="card p-5 text-[15px] leading-relaxed text-slate-600">{c.nobody}</p>}

      {state.partners.map((p) => (
        <section key={p.id} className="space-y-3" data-testid="sharing-partner">
          {request?.partnerId === p.id && (
            <p className="flex gap-2.5 rounded-2xl bg-amber-50 px-4 py-3 text-[14.5px] leading-snug text-blue-900" data-testid="share-request-note">
              <Icon name="info" size={18} className="mt-0.5 shrink-0 text-amber-700" />
              <span>{SHARE_REQUEST_CARD[locale].asked(p.name, caseDay(request.at, locale))}</span>
            </p>
          )}
          <div className="card p-4">
            <PartnerBadge partner={p} line={p.referred ? (locale === "es" ? "Te recomendó" : "Referred you") : c.addedByYou} />
            <div className="mt-3 flex items-center justify-between gap-3 border-t hairline pt-3">
              <span className="text-[15px] text-slate-700">
                {SHARE_LEVEL_LABEL[locale][p.level]}
              </span>
              <button type="button" className="text-[15px] font-semibold text-blue-700" onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id}>
                {open === p.id ? (locale === "es" ? "Cerrar" : "Close") : locale === "es" ? "Cambiar" : "Change"}
              </button>
            </div>
            {p.status !== "approved" && <p className="mt-2 text-[13px] text-amber-700">{c.suspended}</p>}
          </div>
          {open === p.id && <ShareChoice partner={p} current={p.level} locale={locale} now={now} preview={preview} onSave={saveFor({ partnerId: p.id })} />}
        </section>
      ))}

      <section aria-labelledby="vistas">
        <h2 id="vistas" className="px-1 pb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500">{c.viewsTitle}</h2>
        <div className="card overflow-hidden" data-testid="view-log">
          {state.views.length === 0 ? (
            <p className="px-5 py-4 text-[14px] text-slate-500">{c.noViews}</p>
          ) : (
            <ul>
              {state.views.slice(0, 12).map((v, i) => (
                <li key={`${v.partnerId}-${v.at}`} className={`flex items-center gap-3 px-5 py-3 text-[15px] text-slate-800 ${i > 0 ? "border-t hairline" : ""}`}>
                  <Icon name="person" size={17} className="shrink-0 text-slate-400" />
                  {c.viewed(nameOf(v.partnerId) || "—", caseDay(v.at, locale))}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {state.history.length > 0 && (
        <section aria-labelledby="decisiones">
          <h2 id="decisiones" className="px-1 pb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500">{c.historyTitle}</h2>
          <ul className="card overflow-hidden text-[14px] text-slate-700">
            {state.history.slice(0, 10).map((h, i) => (
              <li key={`${h.partnerId}-${h.at}`} className={`px-5 py-2.5 ${i > 0 ? "border-t hairline" : ""}`}>
                {c.historyLine(`${nameOf(h.partnerId)} · ${SHARE_LEVEL_LABEL[locale][h.level]}`, caseDay(h.at, locale))}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="agregar" className="space-y-3">
        <h2 id="agregar" className="px-1 text-[13px] font-semibold uppercase tracking-wide text-slate-500">{c.addTitle}</h2>
        <form onSubmit={find} className="card space-y-3 p-4">
          <p className="text-[14px] leading-snug text-slate-600">{c.addHelp}</p>
          <div className="flex gap-2">
            <input
              aria-label={c.addTitle}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={c.addPlaceholder}
              className="h-11 min-w-0 flex-1 rounded-2xl bg-white px-4 text-[16px] shadow-[0_0_0_1px_rgba(0,0,0,0.1)] outline-none focus:ring-2 focus:ring-blue-300"
              autoCapitalize="none"
            />
            <button type="submit" className="pressable h-11 shrink-0 rounded-full bg-slate-900 px-5 text-[15px] font-semibold text-white">{c.find}</button>
          </div>
          {notFound && <p className="text-[14px] text-red-600">{c.notFound}</p>}
        </form>
        {found && (
          <>
            <div className="card p-4">
              <PartnerBadge partner={found} line={partnerDisplay(found)} />
            </div>
            <ShareChoice partner={found} current="none" locale={locale} now={now} preview={preview} onSave={async (level, hash) => {
                const result = await saveFor({ code: code.trim().toLowerCase() })(level, hash);
                if (result.ok && level !== "none") {
                  setOpen(found.id);
                  setFound(null);
                  setCode("");
                }
                return result;
              }} />
          </>
        )}
      </section>
    </main>
  );
}
