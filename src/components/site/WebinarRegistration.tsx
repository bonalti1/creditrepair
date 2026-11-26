"use client";

import Link from "next/link";
import { useState } from "react";
import { attributionFromSearch, readAttribution, sanitizeAttribution } from "@/lib/ads/capture";
import { ALL_STATES, stateLaw, stateStatus } from "@/lib/compliance/states";
import { REMINDERS_CONSENT, WEBINAR_PUBLIC_COPY } from "@/lib/webinars/publicCopy";
import { GOALS, TIMELINES, type RegistrantGoal, type RegistrantTimeline } from "@/lib/webinars/types";

// The registration form of /webinar/<slug> (docs/WEBINARS.md). Phone first:
// big fields, one column, labels above. The reminders box is never
// pre-ticked. Georgia gets the restricted explanation and no button; any
// other state outside Texas may register to learn and is told so. An ad
// link's marketing tags travel with it (src/lib/ads/capture.ts, first touch).

const STATES = ["TX", ...ALL_STATES.filter((s) => s !== "TX")];
const FIELD = "h-12 w-full rounded-2xl bg-white px-4 text-[16px] text-slate-900 shadow-[0_0_0_1px_rgba(0,0,0,0.14)] outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-blue-300";

type Problem = keyof (typeof WEBINAR_PUBLIC_COPY)["en"]["problems"];

export default function WebinarRegistration({ slug, locale, when, durationMinutes, demo }: { slug: string; locale: "en" | "es"; when: string; durationMinutes: number; demo: boolean }) {
  const c = WEBINAR_PUBLIC_COPY[locale];
  const [form, setForm] = useState({ firstName: "", lastName: "", phone: "", email: "", state: "TX", language: locale, goal: "" as RegistrantGoal | "", timeline: "" as RegistrantTimeline | "", question: "", consent: false });
  const [problems, setProblems] = useState<Problem[]>([]);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<{ already: boolean; consent: boolean } | null>(null);
  // The same rule as the server (webinars/register.ts servedFor): Georgia never; Texas served; others learn.
  const served = stateStatus(form.state) === "blocked" ? "refused" : form.state === "TX" ? "texas" : "out_of_state";
  const stateName = stateLaw(form.state)?.name ?? form.state;
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const local: Problem[] = [];
    if (form.firstName.trim().length < 1) local.push("firstName");
    if (form.phone.replace(/\D/g, "").length < 10) local.push("phone");
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(form.email.trim())) local.push("email");
    if (!form.goal) local.push("goal");
    if (!form.timeline) local.push("timeline");
    setProblems(local);
    if (local.length > 0 || served === "refused") return;
    setSending(true);
    const attribution = readAttribution() ?? sanitizeAttribution(attributionFromSearch(window.location.search));
    const res = await fetch("/api/webinars", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slug,
        firstName: form.firstName,
        lastName: form.lastName || null,
        phone: form.phone,
        email: form.email || null,
        state: form.state,
        locale: form.language,
        goal: form.goal,
        timeline: form.timeline,
        question: form.question || null,
        remindersConsent: form.consent,
        consentVersion: REMINDERS_CONSENT.version,
        ...(attribution ? { attribution } : {}),
      }),
    }).catch(() => null);
    setSending(false);
    const body = res ? ((await res.json().catch(() => ({}))) as { already?: boolean; problems?: string[] }) : null;
    if (res?.ok) {
      setDone({ already: Boolean(body?.already), consent: form.consent });
      return;
    }
    const fromServer = (body?.problems ?? []).filter((p): p is Problem => p in c.problems);
    setProblems(fromServer.length > 0 ? fromServer : ["server"]);
  };

  if (done) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_8px_24px_-14px_rgba(0,0,0,0.25)]" role="status" data-testid="webinar-done">
        <p className="font-display text-[24px] font-bold text-blue-700">{done.already ? c.already : c.doneTitle}</p>
        {!done.already && <p className="mt-2 text-[16px] leading-relaxed text-slate-700">{c.doneBody(when)}</p>}
        <p className="mt-2 text-[15px] text-slate-600">{done.consent ? c.doneReminders : c.doneNoReminders}</p>
        {served === "out_of_state" && <p className="mt-2 text-[15px] text-slate-600">{c.outOfState(stateName)}</p>}
        {demo && <p className="mt-3 rounded-2xl bg-amber-50 px-3 py-2 text-[13.5px] text-blue-900">{c.demo}</p>}
      </div>
    );
  }

  const err = (p: Problem) => (problems.includes(p) ? <span className="mt-1 block text-[14px] font-medium text-red-700">{c.problems[p]}</span> : null);

  return (
    <form onSubmit={submit} noValidate className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_8px_24px_-14px_rgba(0,0,0,0.25)] sm:p-6" aria-labelledby="register-title" data-testid="webinar-form-public">
      <h2 id="register-title" className="font-display text-[24px] font-bold text-blue-900">
        {c.formTitle}
      </h2>
      <p className="text-[14.5px] text-slate-600">{c.badge(durationMinutes)}</p>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[15px] font-semibold text-slate-800">{c.firstName}</span>
          <input className={FIELD} autoComplete="given-name" value={form.firstName} maxLength={60} onChange={(e) => set({ firstName: e.target.value })} aria-invalid={problems.includes("firstName")} data-testid="reg-first" />
          {err("firstName")}
        </label>
        <label className="block">
          <span className="mb-1 block text-[15px] font-semibold text-slate-800">{c.lastName}</span>
          <input className={FIELD} autoComplete="family-name" value={form.lastName} maxLength={80} onChange={(e) => set({ lastName: e.target.value })} />
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-[15px] font-semibold text-slate-800">{c.whatsapp}</span>
        <input className={FIELD} type="tel" inputMode="tel" autoComplete="tel" value={form.phone} maxLength={30} onChange={(e) => set({ phone: e.target.value })} placeholder="(713) 555-0142" aria-invalid={problems.includes("phone")} data-testid="reg-phone" />
        <span className="mt-1 block text-[13.5px] text-slate-500">{c.whatsappHint}</span>
        {err("phone")}
      </label>
      <label className="block">
        <span className="mb-1 block text-[15px] font-semibold text-slate-800">{c.email}</span>
        <input className={FIELD} type="email" inputMode="email" autoComplete="email" value={form.email} maxLength={254} onChange={(e) => set({ email: e.target.value })} aria-invalid={problems.includes("email")} />
        {err("email")}
      </label>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[15px] font-semibold text-slate-800">{c.state}</span>
          <select className={FIELD} value={form.state} onChange={(e) => set({ state: e.target.value })} data-testid="reg-state">
            {STATES.map((s) => (
              <option key={s} value={s}>{`${stateLaw(s)?.name ?? s} (${s})`}</option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend className="mb-1 block text-[15px] font-semibold text-slate-800">{c.languagePick}</legend>
          <div className="flex gap-2">
            {(["en", "es"] as const).map((l) => (
              <label key={l} className={`pressable flex h-12 flex-1 cursor-pointer items-center justify-center rounded-2xl text-[16px] font-semibold shadow-[0_0_0_1px_rgba(0,0,0,0.14)] ${form.language === l ? "bg-blue-700 text-white" : "bg-white text-slate-800"}`}>
                <input type="radio" name="language" value={l} checked={form.language === l} onChange={() => set({ language: l })} className="sr-only" />
                {l === "en" ? "English" : "Español"}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      {served === "refused" && (
        <div className="rounded-2xl bg-slate-100 px-4 py-3" role="alert" data-testid="reg-georgia">
          <p className="text-[16px] font-semibold text-slate-900">{c.georgiaTitle}</p>
          <p className="mt-1 text-[14.5px] text-slate-700">{c.georgia}</p>
        </div>
      )}
      {served === "out_of_state" && (
        <p className="rounded-2xl bg-blue-50 px-4 py-3 text-[14.5px] leading-snug text-blue-900" data-testid="reg-out-of-state">
          {c.outOfState(stateName)}
        </p>
      )}
      <label className="block">
        <span className="mb-1 block text-[15px] font-semibold text-slate-800">{c.goal}</span>
        <select className={FIELD} value={form.goal} onChange={(e) => set({ goal: e.target.value as RegistrantGoal })} aria-invalid={problems.includes("goal")} data-testid="reg-goal">
          <option value="" disabled>
            —
          </option>
          {GOALS.map((g) => (
            <option key={g} value={g}>
              {c.goals[g]}
            </option>
          ))}
        </select>
        {err("goal")}
      </label>
      <label className="block">
        <span className="mb-1 block text-[15px] font-semibold text-slate-800">{c.timeline}</span>
        <select className={FIELD} value={form.timeline} onChange={(e) => set({ timeline: e.target.value as RegistrantTimeline })} aria-invalid={problems.includes("timeline")} data-testid="reg-timeline">
          <option value="" disabled>
            —
          </option>
          {TIMELINES.map((t) => (
            <option key={t} value={t}>
              {c.timelines[t]}
            </option>
          ))}
        </select>
        {err("timeline")}
      </label>
      <label className="block">
        <span className="mb-1 block text-[15px] font-semibold text-slate-800">{c.question}</span>
        <textarea className="w-full rounded-2xl bg-white px-4 py-3 text-[16px] text-slate-900 shadow-[0_0_0_1px_rgba(0,0,0,0.14)] outline-none focus:ring-2 focus:ring-blue-300" rows={3} maxLength={500} value={form.question} onChange={(e) => set({ question: e.target.value })} aria-invalid={problems.includes("question")} />
        <span className="mt-1 block text-[13.5px] text-slate-500">{c.questionHint}</span>
        {err("question")}
      </label>
      <label className="flex items-start gap-3 rounded-2xl bg-slate-50 px-4 py-3">
        <input type="checkbox" checked={form.consent} onChange={(e) => set({ consent: e.target.checked })} className="mt-0.5 h-6 w-6 shrink-0 accent-blue-700" data-testid="reg-consent" />
        <span className="text-[14.5px] leading-snug text-slate-800">{c.consent}</span>
      </label>
      {problems.includes("server") && (
        <p className="text-[14.5px] font-medium text-red-700" role="alert">
          {c.problems.server}
        </p>
      )}
      <button type="submit" disabled={sending || served === "refused"} className="pressable flex h-14 w-full items-center justify-center rounded-full bg-amber-400 px-6 text-[17px] font-semibold text-blue-900 hover:bg-amber-500 disabled:bg-slate-200 disabled:text-slate-500" data-testid="reg-submit">
        {sending ? c.sending : c.submit}
      </button>
      <p className="text-[13px] text-slate-500">
        <Link href="/privacidad" className="underline underline-offset-2">
          {c.privacy}
        </Link>
      </p>
      {demo && <p className="rounded-2xl bg-amber-50 px-3 py-2 text-[13.5px] text-blue-900">{c.demo}</p>}
    </form>
  );
}
