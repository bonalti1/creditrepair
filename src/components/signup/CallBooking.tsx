"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import LocaleToggle from "@/components/LocaleToggle";
import Logo from "@/components/Logo";
import { clientTimeZone } from "@/lib/autopilot/clock";
import { BRAND } from "@/lib/brand";
import { CALL_CONSENT, callConsentHash, CALL_TIME_ZONE, QUESTIONS_ONLY } from "@/lib/calls/config";
import { slotDay, slotsByDay, slotTime, zoneLabel, type CallSlot } from "@/lib/calls/slots";
import { useLocale } from "@/lib/i18n";
import { normalizeCaseRef } from "@/lib/signup/caseRef";
import { parseProgress, SIGNUP_STORAGE_KEY } from "@/lib/signup/steps";
import { PersonIcon } from "./TalkToPerson";

// Schedule a call with a person (/registro/llamada; off by default). The
// person picks a free slot from the hours the team set in /equipo/llamadas,
// shown on their own clock (Texas, Central time, by default), gives the
// number to call and ticks their consent to be called there (TCPA: its own
// box, never pre-ticked, not a condition of anything). The confirmation goes
// by WhatsApp (or email, signed in); never by text message.
//
// The page says it first and plainly: the call is for questions only.
// Signing up and any payment happen afterwards, in writing, in the app.

const ZONES = ["America/Chicago", "America/New_York", "America/Denver", "America/Phoenix", "America/Los_Angeles"] as const;

const COPY = {
  en: {
    title: "Schedule a call",
    lead: "A person on our team calls you at the time you pick.",
    zone: "Times shown in",
    zones: { "America/Chicago": "Central (Texas)", "America/New_York": "Eastern", "America/Denver": "Mountain", "America/Phoenix": "Arizona", "America/Los_Angeles": "Pacific" },
    pick: "Pick a time",
    none: "No times are open right now. Write to us on WhatsApp and a person answers.",
    loading: "Loading times…",
    firstName: "Your first name",
    phone: "The cell phone number to call",
    channel: "Send my confirmation by",
    whatsapp: "WhatsApp",
    email: "Email",
    emailLabel: "Your email",
    question: "What would you like to ask? (optional)",
    book: "Book this call",
    booking: "Booking…",
    chosen: "Your time",
    doneTitle: "Your call is booked",
    doneBody: (when: string) => `A person on our team will call you on ${when}.`,
    doneConfirm: "We'll send the confirmation by WhatsApp. Reply STOP any time to stop the messages.",
    doneConfirmEmail: "We'll send the confirmation by email.",
    demo: "Demo: this booking is an example. Nothing is saved or sent.",
    back: "Back to my signup",
    caseLabel: "Case",
    errors: {
      phone: "Please write a US cell phone number.",
      taken: "Someone just took that time. Please pick another.",
      too_soon: "That time is too soon. Please pick another.",
      consent_changed: "The consent text changed. Please reload the page.",
      email: "Please write your email.",
      generic: "It could not be booked. Nothing was saved. Please try again.",
    } as Record<string, string>,
  },
  es: {
    title: "Agenda una llamada",
    lead: "Una persona del equipo te llama a la hora que elijas.",
    zone: "Horas en",
    zones: { "America/Chicago": "Centro (Texas)", "America/New_York": "Este", "America/Denver": "Montaña", "America/Phoenix": "Arizona", "America/Los_Angeles": "Pacífico" },
    pick: "Elige una hora",
    none: "No hay horarios abiertos ahora. Escríbenos por WhatsApp y te responde una persona.",
    loading: "Cargando horarios…",
    firstName: "Tu nombre",
    phone: "El celular al que te llamamos",
    channel: "Mandar mi confirmación por",
    whatsapp: "WhatsApp",
    email: "Correo",
    emailLabel: "Tu correo",
    question: "¿Qué quieres preguntar? (opcional)",
    book: "Reservar esta llamada",
    booking: "Reservando…",
    chosen: "Tu hora",
    doneTitle: "Tu llamada quedó reservada",
    doneBody: (when: string) => `Una persona del equipo te llama el ${when}.`,
    doneConfirm: "Te mandamos la confirmación por WhatsApp. Responde BAJA cuando quieras para dejar de recibir mensajes.",
    doneConfirmEmail: "Te mandamos la confirmación por correo.",
    demo: "Demo: esta reserva es un ejemplo. No se guarda ni se envía nada.",
    back: "Volver a mi registro",
    caseLabel: "Caso",
    errors: {
      phone: "Escribe un número de celular de Estados Unidos.",
      taken: "Alguien acaba de tomar esa hora. Elige otra, por favor.",
      too_soon: "Esa hora está muy cerca. Elige otra, por favor.",
      consent_changed: "El texto del consentimiento cambió. Vuelve a cargar la página.",
      email: "Escribe tu correo.",
      generic: "No se pudo reservar. No se guardó nada. Inténtalo de nuevo.",
    } as Record<string, string>,
  },
} as const;

const FIELD = "h-12 w-full rounded-2xl bg-white px-4 text-[16px] text-slate-900 shadow-[0_0_0_1px_rgba(0,0,0,0.12)] outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-blue-300";

export default function CallBooking() {
  const { locale } = useLocale();
  const t = COPY[locale];
  const q = QUESTIONS_ONLY[locale];
  const [slots, setSlots] = useState<CallSlot[] | null>(null);
  const [live, setLive] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [zone, setZone] = useState<string>(CALL_TIME_ZONE);
  const [picked, setPicked] = useState<CallSlot | null>(null);
  const [firstName, setFirstName] = useState("");
  const [phone, setPhone] = useState("");
  const [channel, setChannel] = useState<"whatsapp" | "email">("whatsapp");
  const [email, setEmail] = useState("");
  const [question, setQuestion] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ slotStart: string; caseRef: string | null } | null>(null);
  const [caseRef, setCaseRef] = useState<string | null>(null);
  const [state, setState] = useState<string | null>(null);

  useEffect(() => {
    const saved = (() => {
      try {
        return parseProgress(window.localStorage.getItem(SIGNUP_STORAGE_KEY));
      } catch {
        return null;
      }
    })();
    const fromLink = normalizeCaseRef(new URLSearchParams(window.location.search).get("caso") ?? "");
    setCaseRef(fromLink ?? saved?.caseRef ?? null);
    if (saved?.answers.firstName) setFirstName(saved.answers.firstName);
    if (saved?.answers.state) {
      setState(saved.answers.state);
      setZone(clientTimeZone(saved.answers.state));
    } else {
      const browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if ((ZONES as readonly string[]).includes(browser)) setZone(browser);
    }
    fetch("/api/calls", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ slots: CallSlot[]; live: boolean; signedIn: boolean }>) : null))
      .then((body) => {
        setSlots(body?.slots ?? []);
        setLive(body?.live ?? true);
        setSignedIn(body?.signedIn ?? false);
      })
      .catch(() => setSlots([]));
  }, []);

  const days = useMemo(() => slotsByDay(slots ?? [], zone), [slots, zone]);
  const when = (iso: string) => `${slotDay(iso, zone, locale)}, ${slotTime(iso, zone, locale)} (${zoneLabel(iso, zone, locale)})`;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!picked || !consent || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        windowId: picked.windowId,
        start: picked.start,
        firstName,
        phone,
        email: channel === "email" ? email : null,
        confirmChannel: channel,
        locale,
        timeZone: zone,
        state,
        question: question.trim() || null,
        caseRef,
        consent: true,
        consentTextHash: callConsentHash(locale),
      }),
    }).catch(() => null);
    const body = res ? ((await res.json().catch(() => ({}))) as { ok?: boolean; code?: string; booking?: { slotStart: string; caseRef: string | null } }) : null;
    setBusy(false);
    if (!res || !res.ok || !body?.booking) {
      setError(t.errors[body?.code ?? ""] ?? t.errors.generic);
      if (body?.code === "taken") setPicked(null);
      return;
    }
    setDone({ slotStart: body.booking.slotStart, caseRef: body.booking.caseRef ?? caseRef });
  };

  return (
    <main className="client-scale mx-auto min-h-dvh max-w-2xl px-4 pb-16 pt-4 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <Link href="/" aria-label={BRAND.name} className="flex h-11 items-center">
          <Logo size={24} priority />
        </Link>
        <div className="flex items-center gap-2">
          {caseRef && (
            <span className="flex h-9 items-center gap-1.5 rounded-full bg-white px-3 text-[13px] font-semibold shadow-[0_0_0_1px_rgba(0,0,0,0.08)]" data-testid="case-ref">
              <span className="font-medium text-slate-500">{t.caseLabel}</span>
              <span className="font-mono tracking-wide text-blue-900">{caseRef}</span>
            </span>
          )}
          <LocaleToggle />
        </div>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <PersonIcon size={48} />
        <div>
          <h1 className="font-display text-[30px] font-bold leading-tight text-blue-700">{t.title}</h1>
          <p className="text-[15px] text-slate-600">{t.lead}</p>
        </div>
      </div>

      {/* The rule, before anything else. */}
      <section className="mt-5 rounded-3xl bg-blue-700 px-5 py-4 text-white" aria-labelledby="questions-only" data-testid="questions-only">
        <h2 id="questions-only" className="flex items-center gap-2 text-[17px] font-semibold">
          <Icon name="info" size={20} />
          {q.title}
        </h2>
        <p className="mt-1 text-[15px] leading-relaxed text-blue-100">{q.body}</p>
      </section>

      {!live && <p className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-[14px] text-blue-900">{t.demo}</p>}

      {done ? (
        <section className="card mt-5 p-6 text-center" data-testid="call-booked">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-50 text-green-700">
            <Icon name="check" size={28} strokeWidth={2.5} />
          </span>
          <h2 className="mt-3 font-display text-[24px] font-bold text-blue-700">{t.doneTitle}</h2>
          <p className="mt-2 text-[16px] text-slate-700">{t.doneBody(when(done.slotStart))}</p>
          <p className="mt-2 text-[14px] text-slate-500">{channel === "email" ? t.doneConfirmEmail : t.doneConfirm}</p>
          <p className="mt-3 rounded-2xl bg-slate-100 px-4 py-3 text-[14px] text-slate-700">{q.short}</p>
          <Link href="/registro" className="pressable mt-5 inline-flex h-12 items-center rounded-full bg-amber-400 px-6 text-[16px] font-semibold text-blue-900 hover:bg-amber-500">
            {t.back}
          </Link>
        </section>
      ) : (
        <form onSubmit={submit} className="mt-5 space-y-5">
          <section className="card p-5" aria-labelledby="pick">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="pick" className="text-[18px] font-semibold text-slate-900">
                {t.pick}
              </h2>
              <label className="flex items-center gap-2 text-[14px] text-slate-600">
                {t.zone}
                <select value={zone} onChange={(e) => setZone(e.target.value)} className="h-10 rounded-xl bg-slate-100 px-3 text-[14px] text-slate-900" data-testid="zone-select">
                  {ZONES.map((z) => (
                    <option key={z} value={z}>
                      {t.zones[z]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {slots === null ? (
              <p className="mt-3 text-[15px] text-slate-500">{t.loading}</p>
            ) : days.length === 0 ? (
              <p className="mt-3 text-[15px] text-slate-600">{t.none}</p>
            ) : (
              <div className="mt-3 space-y-4" data-testid="slots">
                {days.slice(0, 7).map((d) => (
                  <fieldset key={d.day}>
                    <legend className="text-[14px] font-semibold capitalize text-slate-700">{slotDay(d.slots[0]!.start, zone, locale)}</legend>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {d.slots.map((s) => {
                        const on = picked?.start === s.start;
                        return (
                          <button
                            key={s.start}
                            type="button"
                            aria-pressed={on}
                            onClick={() => setPicked(s)}
                            className={`pressable h-11 rounded-full px-4 text-[15px] font-semibold tabular-nums ${on ? "bg-blue-700 text-white" : "bg-slate-100 text-slate-900 hover:bg-blue-50"}`}
                          >
                            {slotTime(s.start, zone, locale)}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                ))}
              </div>
            )}
          </section>

          {picked && (
            <section className="card space-y-4 p-5" aria-label={t.chosen}>
              <p className="rounded-2xl bg-blue-50 px-4 py-3 text-[15px] font-semibold text-blue-900" data-testid="picked">
                {t.chosen}: {when(picked.start)}
              </p>
              <label className="block text-[14px] font-medium text-slate-700">
                {t.firstName}
                <input required value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" maxLength={60} className={`${FIELD} mt-1.5`} />
              </label>
              <label className="block text-[14px] font-medium text-slate-700">
                {t.phone}
                <input required type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(713) 555-1234" className={`${FIELD} mt-1.5`} />
              </label>
              <fieldset>
                <legend className="text-[14px] font-medium text-slate-700">{t.channel}</legend>
                <div className="mt-1.5 flex gap-2">
                  {(["whatsapp", ...(signedIn ? ["email"] : [])] as Array<"whatsapp" | "email">).map((ch) => (
                    <label key={ch} className={`flex h-11 cursor-pointer items-center gap-2 rounded-full px-4 text-[15px] font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-300 ${channel === ch ? "bg-blue-700 text-white" : "bg-slate-100 text-slate-900"}`}>
                      <input type="radio" name="channel" value={ch} checked={channel === ch} onChange={() => setChannel(ch)} className="sr-only" />
                      {ch === "whatsapp" ? t.whatsapp : t.email}
                    </label>
                  ))}
                </div>
              </fieldset>
              {channel === "email" && (
                <label className="block text-[14px] font-medium text-slate-700">
                  {t.emailLabel}
                  <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className={`${FIELD} mt-1.5`} />
                </label>
              )}
              <label className="block text-[14px] font-medium text-slate-700">
                {t.question}
                <textarea value={question} onChange={(e) => setQuestion(e.target.value.slice(0, 500))} rows={3} className="mt-1.5 w-full rounded-2xl bg-white px-4 py-3 text-[16px] text-slate-900 shadow-[0_0_0_1px_rgba(0,0,0,0.12)] outline-none focus:ring-2 focus:ring-blue-300" />
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-slate-100 px-4 py-3">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-6 w-6 shrink-0 accent-blue-700" data-testid="call-consent" />
                <span className="text-[15px] leading-snug text-slate-800">{CALL_CONSENT[locale]}</span>
              </label>
              <p className="text-[13px] leading-snug text-slate-500">{q.short}</p>
              {error && (
                <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-[14px] text-red-700">
                  {error}
                </p>
              )}
              <button type="submit" disabled={!consent || busy || !firstName.trim() || phone.replace(/\D/g, "").length < 10} className="pressable h-14 w-full rounded-full bg-amber-400 text-[17px] font-semibold text-blue-900 hover:bg-amber-500 disabled:bg-slate-200 disabled:text-slate-500" data-testid="call-book">
                {busy ? t.booking : t.book}
              </button>
            </section>
          )}
          <p className="text-center">
            <Link href="/registro" className="text-[15px] font-medium text-blue-700 underline-offset-2 hover:underline">
              {t.back}
            </Link>
          </p>
        </form>
      )}
    </main>
  );
}
