"use client";

import Link from "next/link";
import { useState } from "react";
import Icon from "@/components/Icon";
import { GeneralInfoNote, MarkButton, SourceList } from "@/components/aftercare/AftercareViews";
import { introText, type IntroPartner } from "@/lib/aftercare/connect";
import { homeReadyTrack, LENDER_NOTE, LENDER_TOPICS, MILESTONE_COPY, MILESTONE_MARK } from "@/lib/aftercare/homeReady";
import { useAftercare } from "@/lib/aftercare/useAftercare";
import { caseDay } from "@/lib/case/timeline";
import { useCase } from "@/lib/case/useCase";
import { useLocale } from "@/lib/i18n";
import { consentText, partnerDisplay } from "@/lib/partners/sharing";
import { PARTNER_KIND_LABEL } from "@/lib/partners/rules";

// "Home-ready" (/construir/casa): for clients whose goal is buying a home.
// The milestone track (three steps from the case, three the client marks),
// what lenders usually look at (general information, sourced, "requirements
// vary by lender"), sharing the milestones with a partner loan officer or
// real estate agent (the partner sharing consent, extended: never scores or
// report data), and "Connect me with a loan officer" with its disclosure.

export default function CasaPage() {
  const { locale } = useLocale();
  const es = locale === "es";
  const caseView = useCase(locale);
  const { state, mark, shareHome, requestIntro, withdrawIntro } = useAftercare();
  const [topic, setTopic] = useState<string | null>(null);
  const [sharing, setSharing] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<IntroPartner | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (!state || !caseView.ready) return null;
  const track = homeReadyTrack(caseView.facts, state.marks);
  const doneCount = track.filter((m) => m.done).length;

  return (
    <main className="animate-rise space-y-5" data-testid="home-ready">
      <Link href="/construir" className="inline-flex h-11 items-center gap-1 px-1 text-[15px] font-medium text-blue-700">
        <Icon name="chevron" size={16} className="rotate-180" />
        {es ? "Construye tu crédito" : "Build your credit"}
      </Link>
      <header className="px-1">
        <h1 className="font-display text-[30px] font-bold leading-tight text-blue-700">{es ? "Tu camino para comprar casa" : "Your path to buying a home"}</h1>
        <p className="mt-2 text-[16px] leading-relaxed text-slate-600">
          {es ? `Seis pasos para llegar preparado con un prestamista. Llevas ${doneCount} de 6.` : `Six steps to be ready when you talk to a lender. You have ${doneCount} of 6.`}
        </p>
      </header>

      <ol className="card overflow-hidden" data-testid="home-track">
        {track.map((m, i) => {
          const copy = MILESTONE_COPY[m.key];
          const markKey = MILESTONE_MARK[m.key];
          return (
            <li key={m.key} className={`px-4 py-4 ${i > 0 ? "border-t hairline" : ""}`} data-testid={`milestone-${m.key}`}>
              <div className="flex items-start gap-3">
                <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ${m.done ? "bg-blue-700 text-white" : "border-2 border-slate-300 text-slate-500"}`} aria-hidden="true">
                  {m.done ? <Icon name="check" size={14} strokeWidth={3} /> : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[17px] font-semibold leading-snug text-slate-900">{copy.title[locale]}</p>
                  <p className="text-[13px] text-slate-500">
                    {m.done && m.at ? (es ? `Hecho el ${caseDay(m.at, locale)}` : `Done ${caseDay(m.at, locale)}`) : m.clientMarks ? (es ? "Lo marcas tú" : "You mark it") : es ? "Lo marca tu caso" : "Your case marks it"}
                  </p>
                  <p className="mt-1.5 text-[15px] leading-relaxed text-slate-700">{copy.body[locale]}</p>
                  <ul className="mt-1.5 space-y-1">
                    {copy.tips[locale].map((t) => (
                      <li key={t} className="flex gap-2 text-[14px] leading-snug text-slate-600">
                        <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                        {t}
                      </li>
                    ))}
                  </ul>
                  {markKey && (
                    <div className="mt-3">
                      <MarkButton done={m.done} onToggle={() => mark(markKey, !m.done)} locale={locale} testId={`mark-${markKey}`} />
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <section aria-labelledby="lenders">
        <h2 id="lenders" className="px-1 pb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500">{es ? "Lo que suelen mirar los prestamistas" : "What lenders usually look at"}</h2>
        <p className="mb-3 rounded-2xl bg-blue-50 px-4 py-3 text-[14px] leading-snug text-blue-900" role="note">{LENDER_NOTE[locale]}</p>
        <ul className="space-y-3">
          {LENDER_TOPICS.map((t) => (
            <li key={t.key} className="card overflow-hidden" data-testid={`lender-${t.key}`}>
              <button type="button" aria-expanded={topic === t.key} onClick={() => setTopic(topic === t.key ? null : t.key)} className="pressable flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-slate-50">
                <span className="min-w-0 flex-1 text-[17px] font-semibold text-slate-900">{t.title[locale]}</span>
                <Icon name="chevron" size={18} className={`shrink-0 text-slate-400 transition-transform ${topic === t.key ? "rotate-90" : ""}`} />
              </button>
              {topic === t.key && (
                <div className="border-t hairline px-4 pb-4 pt-3">
                  <div className="space-y-2 text-[15px] leading-relaxed text-slate-800">
                    {t.body[locale].map((p) => (
                      <p key={p}>{p}</p>
                    ))}
                  </div>
                  <SourceList keys={t.sources} locale={locale} />
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="connect" className="card p-5" data-testid="connect-loan-officer">
        <h2 id="connect" className="text-[19px] font-semibold text-slate-900">{es ? "Conéctame con un oficial de préstamos" : "Connect me with a loan officer"}</h2>
        {state.introRequest ? (
          <>
            <p className="mt-2 text-[15px] leading-relaxed text-slate-700" data-testid="intro-open">
              {es
                ? `Le pedimos a ${state.introRequest.partnerName} que te contacte (${caseDay(state.introRequest.at, locale)}). Cuando hablen, marca el paso 6.`
                : `We asked ${state.introRequest.partnerName} to contact you (${caseDay(state.introRequest.at, locale)}). When you talk, mark step 6.`}
            </p>
            <button type="button" onClick={() => withdrawIntro()} className="pressable mt-3 inline-flex h-11 items-center text-[15px] font-semibold text-blue-700">
              {es ? "Retirar la solicitud" : "Withdraw the request"}
            </button>
          </>
        ) : state.intro.partners.length === 0 ? (
          <p className="mt-2 text-[15px] leading-relaxed text-slate-700">
            {es ? "Ahora no hay un oficial de préstamos disponible por aquí. Escríbele a tu equipo desde Más y te ayudamos." : "No loan officer is available here right now. Write to your team from More and we will help."}
          </p>
        ) : connecting ? (
          (() => {
            const t = introText(connecting, locale);
            return (
              <div className="mt-2" data-testid="intro-consent">
                <p className="text-[16px] font-medium leading-snug text-slate-900">{t.lead}</p>
                <p className="mt-3 text-[12px] font-semibold uppercase tracking-wide text-slate-500">{es ? "Qué se envía" : "What is sent"}</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-[15px] leading-snug text-slate-700">
                  {t.sends.map((x) => <li key={x}>{x}</li>)}
                </ul>
                <div className="mt-3 rounded-2xl bg-amber-50 px-4 py-3" role="note">
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-blue-900">{es ? "Aviso" : "Disclosure"}</p>
                  <ul className="mt-1 space-y-1 text-[14px] leading-snug text-blue-900">
                    {t.disclosure.map((x) => <li key={x}>{x}</li>)}
                  </ul>
                </div>
                <div className="mt-4 space-y-2">
                  <button
                    type="button"
                    data-testid="intro-confirm"
                    onClick={async () => {
                      const r = await requestIntro(connecting, locale, state.intro.how);
                      setConnecting(null);
                      setMessage(r.ok ? null : es ? "No se pudo enviar. Inténtalo otra vez." : "It could not be sent. Please try again.");
                    }}
                    className="pressable flex h-12 w-full items-center justify-center rounded-full bg-amber-400 text-[16px] font-semibold text-blue-900 hover:bg-amber-500"
                  >
                    {es ? "Sí, pídeles que me contacten" : "Yes, ask them to contact me"}
                  </button>
                  <button type="button" onClick={() => setConnecting(null)} className="pressable flex h-11 w-full items-center justify-center text-[15px] font-medium text-blue-700">
                    {es ? "Ahora no" : "Not now"}
                  </button>
                </div>
              </div>
            );
          })()
        ) : (
          <>
            <p className="mt-2 text-[15px] leading-relaxed text-slate-700">
              {state.intro.how === "referred"
                ? es
                  ? "Te recomendó un socio que ayuda con préstamos para casa. Le pedimos que te contacte, si quieres."
                  : "A partner who helps with home loans referred you. We can ask them to contact you, if you want."
                : es
                  ? "Estos oficiales de préstamos aceptan clientes nuevos. Van por nombre. Elige uno, si quieres."
                  : "These loan officers accept new clients. They are listed by name. Pick one, if you want."}
            </p>
            <ul className="mt-3 space-y-2">
              {state.intro.partners.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => setConnecting(p)} className="pressable flex w-full items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-left hover:bg-slate-100" data-testid="intro-partner">
                    <Icon name="person" size={20} className="shrink-0 text-blue-700" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[16px] font-semibold text-slate-900">{partnerDisplay(p)}</span>
                      <span className="block text-[13px] text-slate-500">{PARTNER_KIND_LABEL[locale][p.kind]}</span>
                    </span>
                    <Icon name="chevron" size={18} className="shrink-0 text-slate-400" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {message && <p className="mt-2 text-[14px] text-red-700" role="alert">{message}</p>}
      </section>

      {state.homeShares.length > 0 && (
        <section aria-labelledby="share-home" className="card p-5" data-testid="share-home">
          <h2 id="share-home" className="text-[19px] font-semibold text-slate-900">{es ? "Compartir estos pasos" : "Share these milestones"}</h2>
          <p className="mt-1 text-[14px] leading-snug text-slate-600">
            {es ? "Tu decisión. Lo puedes quitar cuando quieras. Nunca se comparten tus puntajes ni tu reporte." : "Your choice. You can stop any time. Your scores and your report are never shared."}
          </p>
          <ul className="mt-3 space-y-3">
            {state.homeShares.map((p) => {
              const level = p.level === "none" ? "progress" : (p.level as "progress" | "summary");
              const text = consentText(level, p, locale, { homeReady: true });
              const isOpen = sharing === p.partnerId;
              return (
                <li key={p.partnerId} className="rounded-2xl bg-slate-50 p-4" data-testid="share-home-partner">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[16px] font-semibold text-slate-900">{partnerDisplay(p)}</p>
                      <p className="text-[13px] text-slate-500">{p.homeReady ? (es ? "Ve tus pasos para comprar casa" : "Sees your home-buying milestones") : es ? "No ve tus pasos" : "Does not see your milestones"}</p>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        if (p.homeReady) await shareHome(p, false, locale);
                        else setSharing(isOpen ? null : p.partnerId);
                      }}
                      className="pressable h-11 shrink-0 rounded-full bg-white px-4 text-[14px] font-semibold text-blue-700 shadow-[0_0_0_1px_rgba(0,0,0,0.08)]"
                    >
                      {p.homeReady ? (es ? "Dejar de compartir" : "Stop sharing") : es ? "Compartir" : "Share"}
                    </button>
                  </div>
                  {isOpen && !p.homeReady && (
                    <div className="mt-3 border-t hairline pt-3" data-testid="share-home-consent">
                      <p className="text-[15px] font-medium text-slate-900">{text.lead}</p>
                      <p className="mt-2 text-[12px] font-semibold uppercase tracking-wide text-slate-500">{es ? "Verá" : "Will see"}</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-[14px] leading-snug text-slate-700">
                        {text.will.map((x) => <li key={x}>{x}</li>)}
                      </ul>
                      <p className="mt-2 text-[12px] font-semibold uppercase tracking-wide text-slate-500">{es ? "Nunca verá" : "Will never see"}</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-[14px] leading-snug text-slate-700">
                        {text.never.map((x) => <li key={x}>{x}</li>)}
                      </ul>
                      <ul className="mt-2 space-y-1 text-[13px] leading-snug text-slate-500">
                        {text.notes.map((x) => <li key={x}>{x}</li>)}
                      </ul>
                      <button
                        type="button"
                        data-testid="share-home-confirm"
                        onClick={async () => {
                          await shareHome(p, true, locale);
                          setSharing(null);
                        }}
                        className="pressable mt-3 flex h-12 w-full items-center justify-center rounded-full bg-amber-400 text-[16px] font-semibold text-blue-900 hover:bg-amber-500"
                      >
                        {es ? "Sí, compartir mis pasos" : "Yes, share my milestones"}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <Link href="/mas/compartir" className="mt-3 inline-flex h-11 items-center text-[14px] font-medium text-blue-700">
            {es ? "Ver todo lo que compartes" : "See everything you share"}
          </Link>
        </section>
      )}

      <GeneralInfoNote locale={locale} className="px-1" />
    </main>
  );
}
