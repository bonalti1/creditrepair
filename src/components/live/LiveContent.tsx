"use client";

import { useEffect, useRef, useState } from "react";
import { readAttribution } from "@/lib/ads/capture";
import { ALL_STATES, NOT_OPEN_COPY, stateLaw } from "@/lib/compliance/states";
import { useOpenStates } from "@/lib/compliance/useOpenStates";
import { useLocale } from "@/lib/i18n";
import { CONSENT_TEXT, LIVE_COPY } from "@/lib/live/copy";
import { LIVE_SOURCES } from "@/lib/live/text";
import { AltiWaveLoop, CharacterAvatar } from "@/components/Character";
import Icon from "@/components/Icon";
import LocaleToggle from "@/components/LocaleToggle";
import Logo from "@/components/Logo";

// /live's page (docs/LIVE-FUNNEL.md). Phone first: one column, 56 px buttons,
// no sideways scroll at 390 px. Alti greets as "Alti · AI assistant"; the
// actions are a person's (the team on WhatsApp) or the review form. Nothing
// here asks for a Social Security number, a date of birth or a card number,
// and nothing is called free: the review is at no cost, and
// annualcreditreport.com is where the law lets people get their reports.

type Step = "home" | "form" | "report" | "done" | "later";
type Goal = "mortgage" | "auto" | "card" | "general";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const BIG_BUTTON = "pressable flex min-h-14 w-full items-center justify-center gap-2 rounded-full px-6 text-[17px] font-semibold";
const FIELD = "h-12 w-full rounded-2xl bg-white px-4 text-[16px] text-slate-900 shadow-[0_0_0_1px_rgba(0,0,0,0.12)] outline-none focus:ring-2 focus:ring-blue-300";

export default function LiveContent({
  origin,
  prefill,
  whatsapp,
  smsEnabled,
  identityIq,
}: {
  origin: { src: string | null; kw: string | null; c: string | null; p: string | null };
  prefill: string;
  whatsapp: string | null;
  smsEnabled: boolean;
  identityIq: { url: string | null; disclosure: { en: string; es: string } };
}) {
  const { locale, setLocale } = useLocale();
  const c = LIVE_COPY[locale];
  const consent = CONSENT_TEXT[locale];
  const openStates = useOpenStates();
  const [step, setStep] = useState<Step>("home");
  const [firstName, setFirstName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState("TX");
  const [goal, setGoal] = useState<Goal>("general");
  const [okMessages, setOkMessages] = useState(false);
  const [okReport, setOkReport] = useState(false);
  const [okSms, setOkSms] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [waitEmail, setWaitEmail] = useState("");
  const [waitDone, setWaitDone] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const top = useRef<HTMLDivElement | null>(null);

  const chatHref = whatsapp ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(prefill)}` : null;
  const status = openStates.status(state);

  useEffect(() => {
    if (step !== "home") top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [step]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!firstName.trim()) next.firstName = c.form.errors.firstName;
    const digits = phone.replace(/\D/g, "");
    if (!/^1?[2-9]\d{2}[2-9]\d{6}$/.test(digits)) next.phone = c.form.errors.phone;
    if (email.trim() && !/^[^@\s]+@[^@\s]+\.[a-z]{2,24}$/i.test(email.trim())) next.email = c.form.errors.email;
    if (!okMessages) next.messages = c.form.errors.consent;
    if (!okReport) next.report = c.form.errors.consent;
    setErrors(next);
    if (Object.keys(next).length > 0 || status !== "open") return;
    setBusy(true);
    try {
      const res = await fetch("/api/live", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          phone,
          email: email.trim() || null,
          state,
          goal,
          locale,
          consentMessages: okMessages,
          consentReport: okReport,
          consentSms: smsEnabled && okSms,
          origin,
          attribution: readAttribution(),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { uploadToken?: string; error?: string };
      if (res.ok && body.uploadToken) {
        setToken(body.uploadToken);
        setStep("report");
      } else {
        setErrors({ server: res.status === 429 ? c.form.errors.tooMany : c.form.errors.server });
      }
    } catch {
      setErrors({ server: c.form.errors.server });
    } finally {
      setBusy(false);
    }
  };

  const addFiles = (list: FileList | null) => {
    setFileError(null);
    const picked = Array.from(list ?? []);
    const next = [...files];
    for (const f of picked) {
      if (f.size > MAX_FILE_BYTES) {
        setFileError(c.report.tooBig);
        continue;
      }
      if (!/\.(pdf|html?|txt)$/i.test(f.name) && !/^(application\/pdf|text\/html|text\/plain)$/.test(f.type)) {
        setFileError(c.report.wrongType);
        continue;
      }
      if (next.length < 3) next.push(f);
    }
    setFiles(next);
    if (fileInput.current) fileInput.current.value = "";
  };

  const upload = async () => {
    if (!token || files.length === 0) return;
    setBusy(true);
    setFileError(null);
    try {
      const form = new FormData();
      form.set("token", token);
      for (const f of files) form.append("file", f, f.name);
      const res = await fetch("/api/live/report", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) setStep("done");
      else setFileError(body.error === "token" ? c.report.expired : body.error === "too_large" ? c.report.tooBig : body.error === "file" ? c.report.wrongType : c.form.errors.server);
    } catch {
      setFileError(c.form.errors.server);
    } finally {
      setBusy(false);
    }
  };

  const joinWaitlist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,24}$/i.test(waitEmail.trim())) return;
    setBusy(true);
    await fetch("/api/waitlist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: waitEmail.trim(), state, locale }) }).catch(() => undefined);
    setBusy(false);
    setWaitDone(true);
  };

  return (
    <main className="min-h-screen bg-slate-50" data-testid="live-page">
      <section className="relative overflow-hidden bg-gradient-to-b from-blue-800 to-blue-900 px-4 pb-20 pt-4 text-white sm:px-6">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center justify-between gap-3">
            <Logo size={28} tone="dark" priority />
            <LocaleToggle tone="dark" />
          </div>
          <p className="mt-6 text-[13px] font-semibold uppercase tracking-[0.14em] text-amber-400" data-on-navy>{c.kicker}</p>
          <h1 className="mt-2 font-display text-[32px] font-bold leading-[1.1] sm:text-[48px]">{c.title}</h1>
          <p className="mt-3 max-w-2xl text-[17px] leading-relaxed text-blue-100">{c.sub}</p>
          <div className="mt-5 flex items-end gap-3">
            <AltiWaveLoop height={150} heightClassName="h-[120px] sm:h-[150px]" priority />
            <div className="mb-3 min-w-0 rounded-2xl rounded-bl-[6px] bg-white px-4 py-3 text-slate-900 shadow-lg">
              <p className="text-[12px] font-semibold text-slate-500">{c.altiTag}</p>
              <p className="mt-0.5 text-[16px] font-medium leading-snug">{c.altiHello}</p>
            </div>
          </div>
        </div>
        <svg viewBox="0 0 1440 120" preserveAspectRatio="none" aria-hidden="true" className="absolute inset-x-0 bottom-0 h-14 w-full sm:h-20">
          <path d="M0 62C380 132 1060 -8 1440 54V120H0Z" fill="var(--color-amber-400)" />
          <path d="M0 84C380 146 1060 14 1440 76V120H0Z" fill="var(--color-slate-50)" />
        </svg>
      </section>

      <div ref={top} className="mx-auto -mt-8 max-w-3xl scroll-mt-4 px-4 sm:px-6">
        {step === "home" && (
          <div className="relative space-y-3" data-testid="live-actions">
            {chatHref ? (
              <a href={chatHref} className={`${BIG_BUTTON} bg-white text-blue-900 shadow-[0_6px_20px_rgba(18,33,58,0.12)] ring-1 ring-blue-900/10 hover:bg-slate-50`} data-testid="live-chat">
                <Icon name="chat" size={20} />
                <span className="flex flex-col items-start leading-tight">
                  <span>{c.chat}</span>
                  <span className="text-[13px] font-medium text-slate-500">{c.chatSub}</span>
                </span>
              </a>
            ) : null}
            <button type="button" onClick={() => setStep("form")} className={`${BIG_BUTTON} bg-amber-400 text-blue-900 hover:bg-amber-300`} data-testid="live-review">
              <Icon name="doc" size={20} />
              <span className="flex flex-col items-start leading-tight">
                <span>{c.review}</span>
                <span className="text-[13px] font-medium text-blue-900/70">{c.reviewSub}</span>
              </span>
            </button>
            <ol className="card mt-6 divide-y divide-slate-200">
              {c.steps.map(([title, body], index) => (
                <li key={title} className="flex gap-3 px-5 py-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 font-display text-[15px] font-semibold text-blue-800">{index + 1}</span>
                  <span>
                    <span className="block text-[16px] font-semibold text-slate-900">{title}</span>
                    <span className="block text-[14.5px] leading-snug text-slate-600">{body}</span>
                  </span>
                </li>
              ))}
            </ol>
            <p className="px-1 text-[14px] leading-snug text-slate-600">{c.privacy}</p>
            <p className="px-1 text-[14px] leading-snug text-slate-600">{c.charges}</p>
          </div>
        )}

        {step === "form" && (
          <form onSubmit={submit} noValidate className="card relative space-y-4 px-5 py-5" data-testid="live-form">
            <h2 className="font-display text-[24px] font-bold text-blue-800">{c.form.title}</h2>
            <Field id="live-first" label={c.form.firstName} error={errors.firstName}>
              <input id="live-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" maxLength={40} className={FIELD} aria-invalid={Boolean(errors.firstName)} />
            </Field>
            <Field id="live-phone" label={c.form.phone} hint={c.form.phoneHint} error={errors.phone}>
              <input id="live-phone" value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel-national" maxLength={20} className={FIELD} aria-invalid={Boolean(errors.phone)} />
            </Field>
            <Field id="live-email" label={c.form.email} error={errors.email}>
              <input id="live-email" value={email} onChange={(e) => setEmail(e.target.value)} type="email" inputMode="email" autoComplete="email" maxLength={200} className={FIELD} aria-invalid={Boolean(errors.email)} />
            </Field>
            <Field id="live-state" label={c.form.state}>
              <select id="live-state" value={state} onChange={(e) => setState(e.target.value)} className={FIELD}>
                {ALL_STATES.map((s) => (
                  <option key={s} value={s}>{`${stateLaw(s)?.name ?? s} (${s})`}</option>
                ))}
              </select>
            </Field>

            {status === "blocked" && (
              <div className="rounded-2xl bg-slate-100 p-4" data-testid="live-state-blocked" role="status">
                <p className="text-[16px] font-semibold text-slate-900">{NOT_OPEN_COPY[locale].title(stateLaw(state)?.name ?? state)}</p>
                <p className="mt-1 text-[14.5px] text-slate-600">{state === "GA" ? c.stateBlocked : NOT_OPEN_COPY[locale].blocked}</p>
              </div>
            )}
            {status === "waitlist" && (
              <div className="rounded-2xl bg-slate-100 p-4" data-testid="live-state-waitlist">
                <p className="text-[16px] font-semibold text-slate-900">{NOT_OPEN_COPY[locale].title(stateLaw(state)?.name ?? state)}</p>
                <p className="mt-1 text-[14.5px] text-slate-600">{NOT_OPEN_COPY[locale].body}</p>
                {waitDone ? (
                  <p className="mt-3 text-[15px] font-semibold text-green-700" role="status">✓</p>
                ) : (
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <label htmlFor="live-wait" className="sr-only">{c.form.email}</label>
                    <input id="live-wait" type="email" value={waitEmail} onChange={(e) => setWaitEmail(e.target.value)} placeholder="name@example.com" className={FIELD} />
                    <button type="button" onClick={joinWaitlist} disabled={busy} className="pressable h-12 shrink-0 rounded-full bg-blue-900 px-5 text-[15px] font-semibold text-white">
                      {locale === "es" ? "Avísenme" : "Notify me"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {status === "open" && (
              <>
                <fieldset>
                  <legend className="mb-1.5 text-[15px] font-semibold text-slate-800">{c.form.language}</legend>
                  <div className="grid grid-cols-2 gap-2">
                    {(["en", "es"] as const).map((l) => (
                      <button key={l} type="button" aria-pressed={locale === l} onClick={() => setLocale(l)} className={`pressable h-12 rounded-2xl text-[16px] font-semibold ${locale === l ? "bg-blue-900 text-white" : "bg-white text-slate-800 shadow-[0_0_0_1px_rgba(0,0,0,0.12)]"}`}>
                        {l === "en" ? c.form.english : c.form.spanish}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <Field id="live-goal" label={c.form.goal}>
                  <select id="live-goal" value={goal} onChange={(e) => setGoal(e.target.value as Goal)} className={FIELD}>
                    {(Object.keys(c.form.goals) as Goal[]).map((g) => (
                      <option key={g} value={g}>
                        {c.form.goals[g]}
                      </option>
                    ))}
                  </select>
                </Field>
                <fieldset className="space-y-3">
                  <legend className="mb-1 text-[15px] font-semibold text-slate-800">{c.form.consentTitle}</legend>
                  <Consent id="live-ok-messages" checked={okMessages} onChange={setOkMessages} text={consent.messages} error={errors.messages} />
                  <Consent id="live-ok-report" checked={okReport} onChange={setOkReport} text={consent.report} error={errors.report} />
                  {smsEnabled && <Consent id="live-ok-sms" checked={okSms} onChange={setOkSms} text={consent.sms} />}
                </fieldset>
                <p className="flex gap-2 text-[13.5px] leading-snug text-slate-600">
                  <Icon name="info" size={16} className="mt-0.5 shrink-0 text-blue-700" />
                  {c.form.neverAsk}
                </p>
                {errors.server && (
                  <p className="text-[14px] font-medium text-red-700" role="alert">
                    {errors.server}
                  </p>
                )}
                <button type="submit" disabled={busy} className={`${BIG_BUTTON} bg-amber-400 text-blue-900 hover:bg-amber-300 disabled:opacity-60`} data-testid="live-submit">
                  {busy ? c.form.sending : c.form.submit}
                </button>
              </>
            )}
          </form>
        )}

        {step === "report" && (
          <div className="relative space-y-4" data-testid="live-report">
            <section className="card px-5 py-5">
              <h2 className="font-display text-[24px] font-bold text-blue-800">{c.report.title}</h2>
              <p className="mt-1 text-[15px] leading-relaxed text-slate-600">{c.report.intro}</p>
              <input ref={fileInput} id="live-file" type="file" accept=".pdf,.html,.htm,.txt,application/pdf,text/html" multiple className="sr-only" onChange={(e) => addFiles(e.target.files)} data-testid="live-file" />
              {files.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {files.map((f, i) => (
                    <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded-2xl bg-slate-100 px-3 py-2 text-[14.5px]">
                      <span className="flex min-w-0 items-center gap-2">
                        <Icon name="doc" size={18} className="shrink-0 text-blue-700" />
                        <span className="truncate">{f.name}</span>
                      </span>
                      <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} className="pressable min-h-11 shrink-0 px-2 text-[14px] font-semibold text-blue-700 underline">
                        {c.report.remove}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {files.length < 3 && (
                <label htmlFor="live-file" className={`${BIG_BUTTON} mt-3 cursor-pointer bg-white text-blue-900 ring-1 ring-blue-900/20 hover:bg-slate-50`}>
                  <Icon name="plus" size={20} />
                  {files.length === 0 ? c.report.choose : c.report.chooseMore}
                </label>
              )}
              {fileError && (
                <p className="mt-2 text-[14px] font-medium text-red-700" role="alert">
                  {fileError}
                </p>
              )}
              <button type="button" onClick={upload} disabled={busy || files.length === 0} className={`${BIG_BUTTON} mt-3 bg-amber-400 text-blue-900 hover:bg-amber-300 disabled:bg-slate-200 disabled:text-slate-500`} data-testid="live-upload">
                {busy ? c.report.uploading : c.report.upload}
              </button>
              <button type="button" onClick={() => setStep("later")} className="pressable mt-2 min-h-11 w-full text-[15px] font-semibold text-blue-700 underline">
                {c.report.later}
              </button>
              <p className="mt-2 text-[13.5px] leading-snug text-slate-500">{c.privacy}</p>
            </section>

            <details className="card group px-5 py-4" open data-testid="live-guide">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 font-display text-[18px] font-semibold text-blue-800">
                {c.guide.title}
                <Icon name="chevron" size={18} className="shrink-0 rotate-90 group-open:-rotate-90" />
              </summary>
              <p className="mt-1 text-[15px] leading-relaxed text-slate-600">{c.guide.intro}</p>
              <ol className="mt-3 space-y-2">
                {c.guide.steps.map((s, i) => (
                  <li key={s} className="flex gap-3 text-[15px] leading-snug text-slate-700">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[13px] font-semibold text-blue-800">{i + 1}</span>
                    {s}
                  </li>
                ))}
              </ol>
              <a href={LIVE_SOURCES.official} target="_blank" rel="noreferrer" className={`${BIG_BUTTON} mt-4 bg-blue-900 text-white hover:bg-blue-800`}>
                {c.guide.open}
              </a>
            </details>

            <section className="card px-5 py-4">
              {/* The provider is named only once its partner link exists (monitoring/offer.ts). */}
              <h3 className="font-display text-[17px] font-semibold text-blue-800">{identityIq.url ? c.guide.identityTitle : c.guide.monitorTitle}</h3>
              <p className="mt-1 text-[15px] leading-snug text-slate-600">{identityIq.url ? c.guide.identityBody : c.guide.monitorBody}</p>
              {identityIq.url && (
                <a href={identityIq.url} target="_blank" rel="noreferrer sponsored" className="pressable mt-2 inline-flex min-h-11 items-center text-[15px] font-semibold text-blue-700 underline">
                  {c.guide.identityLink}
                </a>
              )}
              <p className="mt-1 text-[13px] leading-snug text-slate-500">{identityIq.url ? c.guide.identityNote : c.guide.monitorNote}</p>
              <p className="mt-1 text-[13px] leading-snug text-slate-500">{identityIq.disclosure[locale]}</p>
            </section>
          </div>
        )}

        {(step === "done" || step === "later") && (
          <section className="card relative px-5 py-6 text-center" data-testid={step === "done" ? "live-done" : "live-later"} role="status">
            <div className="flex justify-center">
              <CharacterAvatar character="assistant" size={64} className="ring-4 ring-blue-100" />
            </div>
            <p className="mt-2 text-[12px] font-semibold text-slate-500">{c.altiTag}</p>
            <h2 className="mt-1 font-display text-[24px] font-bold text-blue-800">{step === "done" ? c.report.done : c.report.later}</h2>
            <p className="mx-auto mt-2 max-w-md text-[15.5px] leading-relaxed text-slate-600">{step === "done" ? c.report.doneBody : c.report.laterNote}</p>
            {step === "done" && <p className="mx-auto mt-2 max-w-md text-[14px] text-slate-500">{c.report.reading}</p>}
            {step === "later" && (
              <button type="button" onClick={() => setStep("report")} className={`${BIG_BUTTON} mx-auto mt-4 max-w-sm bg-amber-400 text-blue-900`}>
                {c.report.upload}
              </button>
            )}
            {chatHref && (
              <a href={chatHref} className={`${BIG_BUTTON} mx-auto mt-3 max-w-sm bg-white text-blue-900 ring-1 ring-blue-900/20`}>
                <Icon name="chat" size={20} />
                {c.report.doneChat}
              </a>
            )}
          </section>
        )}
      </div>

      <footer className="mx-auto max-w-3xl px-4 pb-10 pt-8 text-center sm:px-6">
        <p className="text-[12.5px] leading-relaxed text-slate-500">{c.footer}</p>
      </footer>
    </main>
  );
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[15px] font-semibold text-slate-800">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-[13px] text-slate-500">{hint}</p>}
      {error && (
        <p className="mt-1 text-[13.5px] font-medium text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function Consent({ id, checked, onChange, text, error }: { id: string; checked: boolean; onChange: (v: boolean) => void; text: string; error?: string }) {
  return (
    <div>
      <label htmlFor={id} className="flex cursor-pointer gap-3 rounded-2xl bg-slate-50 p-3 text-[14.5px] leading-snug text-slate-700">
        <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-6 w-6 shrink-0 accent-blue-900" aria-invalid={Boolean(error)} />
        <span>{text}</span>
      </label>
      {error && (
        <p className="mt-1 text-[13.5px] font-medium text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
