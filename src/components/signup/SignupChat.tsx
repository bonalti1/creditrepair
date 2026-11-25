"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CharacterAvatar, CharacterFigure } from "@/components/Character";
import Icon from "@/components/Icon";
import IdentityDocs from "@/components/IdentityDocs";
import LocaleToggle from "@/components/LocaleToggle";
import Logo from "@/components/Logo";
import MailingAddress from "@/components/MailingAddress";
import { ID_TYPE_QUESTION } from "@/lib/aftercare/itin";
import { ID_TYPE_KEY } from "@/lib/aftercare/useAftercare";
import { isFullName } from "@/lib/agreement/signature";
import { deadlineMoment } from "@/lib/agreement/format";
import { attributionFromSearch, readAttribution, sanitizeAttribution } from "@/lib/ads/capture";
import { aiByline, BRAND } from "@/lib/brand";
import { ALL_STATES, NOT_OPEN_COPY, stateLaw } from "@/lib/compliance/states";
import { useOpenStates } from "@/lib/compliance/useOpenStates";
import { NO_SOFT_PULL, reportStepMode, SOFT_PULL_CONSENT } from "@/lib/credit/softPull";
import { useLocale } from "@/lib/i18n";
import { AFFILIATE_DISCLOSURE, MONITORING_OFFER } from "@/lib/monitoring/offer";
import { GOALS, parseInvite } from "@/lib/sales/invite";
import { newCaseRef } from "@/lib/signup/caseRef";
import { reportLines, SIGNUP_COPY, stateName, transcript, type ChatLine } from "@/lib/signup/copy";
import { reportCounts } from "@/lib/signup/reportSummary";
import {
  currentQuestion,
  looksLikeEmail,
  newProgress,
  parseProgress,
  SIGNUP_STORAGE_KEY,
  stageOf,
  STEP_LABELS,
  SIGNUP_STEPS,
  stageRank,
  type GoalKey,
  type SignupProgress,
} from "@/lib/signup/steps";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { markMilestone } from "@/lib/ux/firstWeek";
import { useClientReport } from "@/lib/ux/reportStore";
import type { PublicPlan } from "@/lib/site/plans";
import AgreementFlow, { type SheetKind } from "./AgreementSheets";
import { AltiRun, Transcript, TypingDots, YouBubble } from "./Bubbles";
import PhoneSignIn from "./PhoneSignIn";
import ReferredShareOffer from "@/components/partners/ReferredShareOffer";
import SignupProgressBar from "./SignupProgressBar";
import TalkToPerson, { PersonIcon } from "./TalkToPerson";

// Sign up in one chat with Alti, the AI assistant (/registro,
// docs/SIGNUP-CHAT.md). One more way in, beside /onboarding, /acuerdo and the
// salesperson's invitation; it writes the same records they do:
//
//   Get started      first name, goal, state (the open-states switch of
//                    /equipo/estados: a closed state gets the waitlist,
//                    Georgia never opens)
//   Your info        last name, SSN or ITIN (the kind only), email (optional),
//                    then sign in with the phone (the /login code); the
//                    answers go to the profile through /api/profile/onboarding
//   Verify identity  mailing address and ID + proof of address (the existing
//                    intake: IdentityDocs → /api/intake/document)
//   Your report      the report in counts when one is on file; otherwise the
//                    monitoring subscription (IdentityIQ), turned on after
//                    signing; a soft-pull provider can be plugged in later
//                    (src/lib/credit/softPull.ts, `none` by default)
//   Sign up          the plan (attorney-approved plans only, else the rule),
//                    the disclosures sheet and the contract sheet: the
//                    agreement's own logic (AgreementSheets.tsx)
//
// The case reference is on screen from the first moment. "Rather talk to
// someone?" is at the bottom of every step. Progress is kept on the device
// and on the server, so the person picks up where they stopped. Alti is
// labelled as AI on every run of his messages; no other character appears.

const STATES = ["TX", ...ALL_STATES.filter((s) => s !== "TX")];

const PRIMARY =
  "pressable flex h-12 w-full items-center justify-center rounded-full bg-amber-400 px-6 text-[16px] font-semibold text-blue-900 hover:bg-amber-500 disabled:bg-slate-200 disabled:text-slate-500";
const SECONDARY = "pressable flex h-12 w-full items-center justify-center rounded-full bg-slate-100 px-5 text-[16px] font-semibold text-slate-900 hover:bg-slate-200";
const FIELD = "h-12 w-full rounded-2xl bg-white px-4 text-[16px] text-slate-900 shadow-[0_0_0_1px_rgba(0,0,0,0.12)] outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-blue-300";
const CARD = "rounded-3xl border hairline bg-white p-4 shadow-[0_8px_24px_-14px_rgba(0,0,0,0.25)]";

function save(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export interface SignupChatProps {
  plans: Record<"en" | "es", PublicPlan[]>;
  rules: Record<"en" | "es", Array<{ title: string; body: string }>>;
  callsEnabled: boolean;
  softPullProvider: string;
}

/** One line of text and a send button. */
function TextAnswer({ label, autoComplete, type = "text", onSubmit, send, initial = "", inputMode }: { label: string; autoComplete: string; type?: string; onSubmit: (v: string) => void; send: string; initial?: string; inputMode?: "email" | "text" }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSubmit(value.trim());
      }}
      className="flex gap-2"
    >
      <label className="min-w-0 flex-1">
        <span className="sr-only">{label}</span>
        <input ref={ref} type={type} inputMode={inputMode} autoComplete={autoComplete} value={value} onChange={(e) => setValue(e.target.value)} placeholder={label} className={FIELD} maxLength={80} />
      </label>
      <button type="submit" disabled={!value.trim()} className="pressable h-12 shrink-0 rounded-full bg-amber-400 px-5 text-[16px] font-semibold text-blue-900 hover:bg-amber-500 disabled:bg-slate-200 disabled:text-slate-500">
        {send}
      </button>
    </form>
  );
}

/** Choices as buttons (keyboard: Tab and Enter; each says whether it is chosen). */
function Choices<T extends string>({ options, onPick, testId }: { options: Array<{ key: T; label: string; sub?: string }>; onPick: (k: T) => void; testId: string }) {
  return (
    <div className="grid gap-2" data-testid={testId}>
      {options.map((o) => (
        <button key={o.key} type="button" onClick={() => onPick(o.key)} className="pressable flex min-h-12 w-full flex-col items-start justify-center rounded-2xl bg-white px-4 py-2.5 text-left shadow-[0_0_0_1px_rgba(0,0,0,0.12)] hover:bg-blue-50">
          <span className="text-[16px] font-semibold text-slate-900">{o.label}</span>
          {o.sub && <span className="text-[13px] leading-snug text-slate-500">{o.sub}</span>}
        </button>
      ))}
    </div>
  );
}

function ReportStep({ locale, softPullProvider, onDone }: { locale: "en" | "es"; softPullProvider: string; onDone: (r: { counts: ReturnType<typeof reportCounts> | null; demo: boolean }) => void }) {
  const c = SIGNUP_COPY[locale];
  const view = useClientReport();
  const [consent, setConsent] = useState(false);
  const [pulled, setPulled] = useState<string[] | null>(null);
  const [problem, setProblem] = useState(false);
  if (!view.ready) return <TypingDots label={locale === "es" ? "Alti está escribiendo" : "Alti is typing"} />;
  const hasReport = !view.waiting && view.items.length > 0;
  const mode = reportStepMode({ providerId: softPullProvider, hasReport });
  const demo = !view.live;
  const counts = hasReport ? reportCounts(view.items) : null;
  const monitoring = { provider: MONITORING_OFFER.providerName, price: MONITORING_OFFER.priceLabel };
  const lines = reportLines({ reportCounts: counts, reportDemo: demo }, locale, monitoring).map((l) => l.text);

  return (
    <AltiRun lines={mode === "soft_pull" ? [c.alti.reportSoftPull] : lines} locale={locale}>
      <div className={CARD} data-testid={`report-${mode}`}>
        {mode === "summary" && counts && (
          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[15px] font-semibold text-slate-900">{c.report.title}</p>
              {demo && <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[12px] font-semibold text-blue-900">{c.report.demoBadge}</span>}
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-[14px] sm:grid-cols-3">
              {(
                [
                  [locale === "es" ? "Cuentas" : "Accounts", counts.accounts],
                  [locale === "es" ? "Cobranzas" : "Collections", counts.collections],
                  [locale === "es" ? "Con pagos tardíos" : "With late payments", counts.latePayments],
                  [locale === "es" ? "Consultas" : "Inquiries", counts.inquiries],
                  [locale === "es" ? "Registros públicos" : "Public records", counts.publicRecords],
                  [locale === "es" ? "Datos personales" : "Personal details", counts.personalInfo],
                ] as Array<[string, number]>
              ).map(([label, n]) => (
                <div key={label} className="rounded-2xl bg-slate-50 px-3 py-2">
                  <dt className="text-[12px] text-slate-500">{label}</dt>
                  <dd className="text-[18px] font-semibold tabular-nums text-slate-900">{n}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        {mode === "monitoring" && (
          <div>
            <p className="text-[15px] font-semibold text-slate-900">{c.report.monitoringTitle}</p>
            <dl className="mt-2 divide-y divide-slate-100">
              {c.report.rows(MONITORING_OFFER.priceLabel).map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-3 py-2">
                  <dt className="text-[14px] text-slate-500">{label}</dt>
                  <dd className="text-right text-[15px] font-medium text-slate-900">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-[12px] leading-snug text-slate-500">{AFFILIATE_DISCLOSURE[locale]}</p>
          </div>
        )}
        {mode === "soft_pull" && (
          <div>
            {pulled ? (
              <p className="text-[15px] text-slate-800">{pulled.join(" ")}</p>
            ) : (
              <label className="flex items-start gap-3">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-6 w-6 shrink-0 accent-blue-700" />
                <span className="text-[15px] leading-snug text-slate-800">{SOFT_PULL_CONSENT[locale]}</span>
              </label>
            )}
            {problem && <p role="alert" className="mt-2 text-[14px] text-red-700">{c.alti.reportAfterSigning}</p>}
            {!pulled && (
              <button
                type="button"
                disabled={!consent}
                className={`${PRIMARY} mt-3`}
                onClick={async () => {
                  const res = await fetch("/api/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "soft_pull", consentVersion: SOFT_PULL_CONSENT.version, locale }) }).catch(() => null);
                  const body = res?.ok ? ((await res.json()) as { lines?: string[] }) : null;
                  if (body?.lines) setPulled(body.lines);
                  else setProblem(true);
                }}
              >
                {c.report.softPullConsent}
              </button>
            )}
          </div>
        )}
        <button type="button" onClick={() => onDone({ counts, demo })} className={`${PRIMARY} mt-4`} data-testid="report-continue">
          {c.report.continue}
        </button>
      </div>
    </AltiRun>
  );
}

export default function SignupChat({ plans, rules, callsEnabled, softPullProvider }: SignupChatProps) {
  const { locale } = useLocale();
  const c = SIGNUP_COPY[locale];
  const live = isSupabaseConfigured();
  const openStates = useOpenStates();
  const [progress, setProgress] = useState<SignupProgress | null>(null);
  const [resumed, setResumed] = useState(false);
  const [talk, setTalk] = useState(false);
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [asking, setAsking] = useState(false);
  const [qa, setQa] = useState<ChatLine[]>([]);
  const [thinking, setThinking] = useState(false);
  const [stateChoice, setStateChoice] = useState("TX");
  const [waitlistEmail, setWaitlistEmail] = useState("");
  const [waitlisted, setWaitlisted] = useState(false);
  const talkButton = useRef<HTMLButtonElement>(null);
  const end = useRef<HTMLDivElement>(null);

  // The device's signup, or a new one with a reference from the server.
  useEffect(() => {
    let cancelled = false;
    const saved = parseProgress(read(SIGNUP_STORAGE_KEY));
    if (saved) {
      setProgress(saved);
      setResumed(saved.path === "chat" && Boolean(saved.answers.firstName) && saved.stage !== "done");
      if (saved.answers.state) setStateChoice(saved.answers.state);
      return;
    }
    const invite = parseInvite(new URLSearchParams(window.location.search));
    if (invite?.ref) save("bonalti.ref", invite.ref);
    if (invite?.partner) save("bonalti.partner", invite.partner);
    // The ad that brought them, if a tagged link did (src/lib/ads/capture.ts): marketing tags only.
    const attribution = readAttribution() ?? sanitizeAttribution(attributionFromSearch(window.location.search));
    fetch("/api/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start", locale, ...(attribution ? { attribution } : {}) }) })
      .then((r) => (r.ok ? (r.json() as Promise<{ caseRef?: string; token?: string | null }>) : null))
      .catch(() => null)
      .then((body) => {
        if (cancelled) return;
        const fresh = newProgress(body?.caseRef ?? newCaseRef(), body?.token ?? null);
        if (invite) {
          const first = invite.name?.split(" ")[0] ?? null;
          fresh.answers = { ...fresh.answers, firstName: first, goal: invite.goal, state: null };
          if (invite.state) setStateChoice(invite.state);
          if (invite.name && isFullName(invite.name)) save("bonalti.inviteName", invite.name);
        }
        save(SIGNUP_STORAGE_KEY, JSON.stringify(fresh));
        setProgress(fresh);
      });
    return () => {
      cancelled = true;
    };
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Keep the change on the device, and tell the server the step reached. */
  const update = useCallback(
    (patch: Partial<SignupProgress> | ((p: SignupProgress) => SignupProgress), extra: { wantsPerson?: boolean } = {}) => {
      setProgress((current) => {
        if (!current) return current;
        const next = typeof patch === "function" ? patch(current) : { ...current, ...patch, answers: { ...current.answers, ...(patch.answers ?? {}) } };
        const stage = stageOf(currentQuestion(next));
        const withStage = { ...next, stage: next.stage === "done" ? "done" : stage } as SignupProgress;
        save(SIGNUP_STORAGE_KEY, JSON.stringify(withStage));
        void fetch("/api/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "progress", caseRef: withStage.caseRef, token: withStage.token, step: withStage.stage, state: withStage.answers.state, locale, ...(extra.wantsPerson ? { wantsPerson: true } : {}) }),
        }).catch(() => undefined);
        return withStage;
      });
    },
    [locale],
  );

  const question = progress ? currentQuestion(progress) : "choose";

  // Keep the newest message in view (instantly for people who asked for reduced motion).
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    end.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "end" });
  }, [question, qa.length, asking, talk, thinking]);

  const lines = useMemo(
    () => (progress ? transcript(progress, locale, { demo: !live, monitoring: { provider: MONITORING_OFFER.providerName, price: MONITORING_OFFER.priceLabel } }) : []),
    [progress, locale, live],
  );

  if (!progress) return null;
  const a = progress.answers;
  const monitoringUrl = MONITORING_OFFER.signupUrl;

  /** Signed in: the answers go to the profile, the same record onboarding writes. */
  const signedIn = async () => {
    if (a.goal) save("bonalti.goal", a.goal);
    if (a.state) save("bonalti.state", a.state);
    if (a.idType) save(ID_TYPE_KEY, a.idType);
    if (live) {
      const ref = read("bonalti.ref");
      const partner = read("bonalti.partner");
      await fetch("/api/profile/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: a.goal ?? undefined, state: a.state ?? undefined, idType: a.idType ?? undefined, referredBy: ref ?? undefined, partnerCode: partner ?? undefined }),
      })
        .then((res) => {
          if (res.ok) save("bonalti.onboardingSynced", [a.goal, a.state, null, ref, ...(partner ? [partner] : []), ...(a.idType ? [`id:${a.idType}`] : [])].join("|"));
        })
        .catch(() => undefined);
    }
    markMilestone("details_done");
    update({ signedIn: true });
  };

  const ask = async (q: string) => {
    setQa((list) => [...list, { key: `q${list.length}`, who: "you", text: q }]);
    setThinking(true);
    const history = [...qa, { key: "q", who: "you" as const, text: q }].slice(-8).map((l) => ({ role: l.who === "you" ? "user" : "assistant", content: l.text.slice(0, 500) }));
    const res = await fetch("/api/site/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: history, locale }) }).catch(() => null);
    const body = res?.ok ? ((await res.json()) as { reply?: string }) : null;
    setThinking(false);
    setQa((list) => [
      ...list,
      { key: `a${list.length}`, who: "alti", text: body?.reply ?? (locale === "es" ? "No pude responder ahora. Una persona del equipo puede ayudarte por WhatsApp." : "I couldn't answer right now. A person on our team can help on WhatsApp.") },
    ]);
  };

  const planList = plans[locale];
  const stateStatus = openStates.status(stateChoice);

  /** The answer widget under Alti's latest question. */
  const widget = (() => {
    switch (question) {
      case "firstName":
        return <TextAnswer key="first" label={c.input.firstName} autoComplete="given-name" send={c.input.send} onSubmit={(v) => update({ answers: { ...a, firstName: v.slice(0, 60) } })} />;
      case "goal":
        return <Choices testId="goal-choices" options={GOALS.map((g) => ({ key: g.key as GoalKey, label: locale === "es" ? g.label : g.labelEn }))} onPick={(k) => update({ answers: { ...a, goal: k } })} />;
      case "state":
        return (
          <div className="space-y-3">
            <label className="block">
              <span className="sr-only">{c.input.state}</span>
              <select value={stateChoice} onChange={(e) => setStateChoice(e.target.value)} className={FIELD} data-testid="state-select">
                {STATES.map((s) => (
                  <option key={s} value={s}>{`${stateLaw(s)?.name ?? s} (${s})`}</option>
                ))}
              </select>
            </label>
            {stateStatus === "open" ? (
              <button
                type="button"
                className={PRIMARY}
                onClick={() => {
                  save("bonalti.state", stateChoice);
                  update({ answers: { ...a, state: stateChoice } });
                }}
              >
                {c.input.next}
              </button>
            ) : stateStatus === "blocked" ? (
              <div className={CARD} data-testid="state-blocked">
                <p className="text-[16px] font-semibold text-slate-900">{NOT_OPEN_COPY[locale].title(stateName(stateChoice))}</p>
                <p className="mt-1 text-[14px] text-slate-600">{NOT_OPEN_COPY[locale].blocked}</p>
              </div>
            ) : waitlisted ? (
              <p className="rounded-2xl bg-blue-50 px-4 py-3 text-[15px] text-blue-900" data-testid="state-waitlisted">{c.alti.waitlistDone}</p>
            ) : (
              <form
                className={CARD}
                data-testid="state-waitlist"
                onSubmit={async (e) => {
                  e.preventDefault();
                  await fetch("/api/waitlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: waitlistEmail, state: stateChoice, locale }) }).catch(() => undefined);
                  setWaitlisted(true);
                }}
              >
                <p className="text-[16px] font-semibold text-slate-900">{NOT_OPEN_COPY[locale].title(stateName(stateChoice))}</p>
                <p className="mt-1 text-[14px] text-slate-600">{NOT_OPEN_COPY[locale].body}</p>
                <label className="mt-3 block">
                  <span className="sr-only">{c.waitlist.email}</span>
                  <input type="email" required value={waitlistEmail} onChange={(e) => setWaitlistEmail(e.target.value)} placeholder={c.waitlist.email} className={FIELD} />
                </label>
                <button type="submit" className={`${PRIMARY} mt-3`}>
                  {c.waitlist.notify}
                </button>
              </form>
            )}
          </div>
        );
      case "lastName":
        return (
          <TextAnswer
            key="last"
            label={c.input.lastName}
            autoComplete="family-name"
            send={c.input.send}
            onSubmit={(v) => {
              const full = `${a.firstName ?? ""} ${v}`.trim();
              // Fills in the signature later; the person checks it there.
              if (isFullName(full)) save("bonalti.inviteName", full);
              update({ answers: { ...a, lastName: v.slice(0, 80) } });
            }}
          />
        );
      case "idType":
        return (
          <div className="space-y-2">
            <Choices
              testId="idtype-choices"
              options={(["ssn", "itin"] as const).map((k) => ({ key: k, label: ID_TYPE_QUESTION[locale][k], sub: ID_TYPE_QUESTION[locale][k === "ssn" ? "ssnSub" : "itinSub"] }))}
              onPick={(k) => {
                save(ID_TYPE_KEY, k);
                update({ answers: { ...a, idType: k } });
              }}
            />
            <p className="px-1 text-[13px] leading-snug text-slate-500">{ID_TYPE_QUESTION[locale].note}</p>
          </div>
        );
      case "email":
        return (
          <div className="space-y-2">
            <TextAnswer key="email" label={c.input.email} type="email" inputMode="email" autoComplete="email" send={c.input.send} onSubmit={(v) => looksLikeEmail(v) && update({ answers: { ...a, email: v } })} />
            <button type="button" onClick={() => update({ answers: { ...a, email: "" } })} className="pressable h-11 w-full text-[15px] font-medium text-blue-700">
              {c.input.skipEmail}
            </button>
          </div>
        );
      case "phone":
        return live ? (
          <div className={CARD}>
            <PhoneSignIn locale={locale} onSignedIn={() => void signedIn()} />
          </div>
        ) : (
          <div className={CARD} data-testid="phone-demo">
            <p className="text-[14px] text-slate-600">{c.demoAccounts}</p>
            <button type="button" onClick={() => void signedIn()} className={`${PRIMARY} mt-3`}>
              {c.input.next}
            </button>
          </div>
        );
      case "identity":
        // Referred by a partner (their code in the link): first, whether they may follow the progress. Off by default.
        return (
          <ReferredShareOffer locale={locale} name={`${a.firstName ?? ""} ${a.lastName ?? ""}`.trim()} goal={a.goal}>
          <div className={`${CARD} space-y-4`} data-testid="identity-step">
            <MailingAddress />
            <IdentityDocs />
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => update({ identity: "done" })} className={PRIMARY} data-testid="identity-done">
                {c.input.next}
              </button>
              <button type="button" onClick={() => update({ identity: "later" })} className={SECONDARY} data-testid="identity-later">
                {locale === "es" ? "Lo hago después" : "I'll do this later"}
              </button>
            </div>
          </div>
          </ReferredShareOffer>
        );
      case "plan":
        return (
          <div className={CARD} data-testid="plan-step">
            {planList.length > 0 ? (
              <ul className="space-y-3" data-testid="plan-offered">
                {planList.map((p) => (
                  <li key={p.id} className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-[16px] font-semibold text-slate-900">{p.name}</p>
                    <ul className="mt-1.5 space-y-1 text-[14px] leading-snug text-slate-700">
                      {p.terms.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                    <p className="mt-2 text-[15px] font-semibold text-blue-900">{p.most}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <div data-testid="plan-rule">
                <p className="text-[15px] font-semibold text-slate-900">{c.plan.ruleTitle}</p>
                <ul className="mt-2 space-y-2">
                  {rules[locale].slice(0, 4).map((r) => (
                    <li key={r.title} className="flex gap-2.5 text-[14px] leading-snug text-slate-700">
                      <Icon name="check" size={18} className="mt-0.5 shrink-0 text-blue-700" strokeWidth={2.25} />
                      <span>
                        <strong className="text-slate-900">{r.title}.</strong> {r.body}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[14px] text-slate-600">{c.plan.none}</p>
              </div>
            )}
            <button
              type="button"
              className={`${PRIMARY} mt-4`}
              data-testid="plan-continue"
              onClick={() => {
                update({ planSeen: true });
                setSheet("rights");
              }}
            >
              {c.plan.continue}
            </button>
          </div>
        );
      default:
        return null;
    }
  })();

  const signedOff = progress.stage === "done";
  const asideSteps = SIGNUP_STEPS.map((s) => STEP_LABELS[locale][s]);

  return (
    <div className="client-scale min-h-dvh bg-slate-50">
      <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[18rem_minmax(0,1fr)] lg:px-6">
        {/* Wide screens: Alti, labelled as AI, the case number and the five steps beside the chat. */}
        <aside className="sticky top-6 hidden h-fit pt-6 lg:block" aria-label={c.progressAria}>
          <div className="card overflow-hidden">
            <div className="flex items-end justify-center bg-blue-50 pt-4">
              <CharacterFigure character="assistant" pose="wave" height={190} motion="idle" />
            </div>
            <div className="p-5">
              <p className="text-[14px] font-semibold text-blue-700">{aiByline(locale)}</p>
              <p className="mt-1 text-[13px] leading-snug text-slate-500">{locale === "es" ? "Inteligencia artificial, no una persona." : "Artificial intelligence, not a person."}</p>
              <ol className="mt-4 space-y-2">
                {asideSteps.map((label, i) => {
                  const rank = stageRank(progress.stage);
                  const done = i < rank;
                  const current = i === Math.min(rank, SIGNUP_STEPS.length - 1) && !signedOff;
                  return (
                    <li key={label} className="flex items-center gap-2.5 text-[14px]">
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${done || signedOff ? "bg-blue-700 text-white" : current ? "bg-amber-400 text-blue-900" : "bg-slate-100 text-slate-500"}`}>
                        {done || signedOff ? <Icon name="check" size={14} strokeWidth={3} /> : i + 1}
                      </span>
                      <span className={current ? "font-semibold text-slate-900" : "text-slate-600"}>{label}</span>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </aside>

        <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col">
          <header className="sticky top-0 z-30 border-b hairline bg-slate-50/95 px-4 pb-3 pt-3 backdrop-blur sm:px-6">
            <div className="flex items-center justify-between gap-3">
              <Link href="/" aria-label={BRAND.name} className="flex h-11 items-center">
                <Logo size={24} priority />
              </Link>
              <div className="flex items-center gap-2">
                <span className="flex h-9 items-center gap-1.5 rounded-full bg-white px-3 text-[13px] font-semibold text-slate-700 shadow-[0_0_0_1px_rgba(0,0,0,0.08)]" aria-label={c.caseAria(progress.caseRef)} data-testid="case-ref">
                  <span aria-hidden="true" className="font-medium text-slate-500">{c.caseLabel}</span>
                  <span aria-hidden="true" className="font-mono tabular-nums tracking-wide text-blue-900">{progress.caseRef}</span>
                </span>
                <LocaleToggle />
              </div>
            </div>
            <div className="mt-3">
              <SignupProgressBar stage={progress.stage} locale={locale} label={c.progressAria} />
            </div>
          </header>

          <div className="flex-1 space-y-3 px-3 py-5 sm:px-6" role="log" aria-live="polite" aria-relevant="additions" data-testid="signup-thread">
            {question === "choose" ? (
              <>
                <div className="flex items-center gap-3 px-1">
                  <CharacterAvatar character="assistant" size={52} decorative />
                  <div>
                    <p className="text-[15px] font-semibold text-slate-900" data-testid="chat-ai-title">{aiByline(locale)}</p>
                    <p className="text-[13px] text-slate-500">{locale === "es" ? "Inteligencia artificial, no una persona" : "Artificial intelligence, not a person"}</p>
                  </div>
                </div>
                <AltiRun lines={[c.alti.hello, c.alti.caseRef(progress.caseRef)]} locale={locale} />
                <h1 className="px-1 pt-3 font-display text-[28px] font-bold leading-tight text-blue-700">{c.choose.title}</h1>
                <div className="grid gap-3 sm:grid-cols-2" data-testid="signup-choose">
                  <button type="button" onClick={() => update({ path: "chat" })} className="card pressable flex items-center gap-4 p-5 text-left hover:bg-blue-50" data-testid="choose-alti">
                    <CharacterAvatar character="assistant" view="headThreeQuarter" size={52} decorative />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[17px] font-semibold text-slate-900">{c.choose.alti}</span>
                      <span className="block text-[14px] leading-snug text-slate-500">{c.choose.altiSub}</span>
                    </span>
                    <Icon name="chevron" size={18} className="shrink-0 text-slate-400" />
                  </button>
                  <button type="button" onClick={() => setTalk(true)} className="card pressable flex items-center gap-4 p-5 text-left hover:bg-blue-50" data-testid="choose-person">
                    <PersonIcon size={52} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[17px] font-semibold text-slate-900">{c.choose.person}</span>
                      <span className="block text-[14px] leading-snug text-slate-500">{callsEnabled ? c.choose.personSubCalls : c.choose.personSub}</span>
                    </span>
                    <Icon name="chevron" size={18} className="shrink-0 text-slate-400" />
                  </button>
                </div>
                <p className="px-1 text-[13px] leading-relaxed text-slate-500">{c.choose.lead}</p>
              </>
            ) : (
              <>
                {resumed && question !== "done" && a.firstName && (
                  <p className="rounded-2xl bg-blue-50 px-4 py-2.5 text-[14px] text-blue-900" data-testid="welcome-back">
                    <span className="font-semibold">{aiByline(locale)}: </span>
                    {c.alti.welcomeBack(a.firstName)}
                  </p>
                )}
                <Transcript lines={lines} locale={locale} lastRunChildren={question !== "report" && question !== "agreement" && question !== "done" ? widget : undefined} />
                {question === "report" && (
                  <ReportStep
                    locale={locale}
                    softPullProvider={softPullProvider || NO_SOFT_PULL.id}
                    onDone={(r) => update({ reportSeen: true, reportCounts: r.counts, reportDemo: r.demo })}
                  />
                )}
                {(question === "agreement" || question === "done") && (
                  <AgreementFlow
                    locale={locale}
                    sheet={sheet}
                    setSheet={(s) => {
                      setSheet(s);
                      if (s) setAsking(false);
                    }}
                    onAsk={() => setAsking(true)}
                    suggestedName={`${a.firstName ?? ""} ${a.lastName ?? ""}`.trim()}
                    onSigned={({ name, deadlineIso }) => {
                      if (progress.stage === "done") return;
                      update((p) => ({ ...p, stage: "done", signedName: name, deadlineIso }));
                    }}
                  />
                )}
                {asking && (
                  <>
                    <AltiRun lines={[c.alti.questionPrompt]} locale={locale} />
                    {qa.map((l) => (l.who === "you" ? <YouBubble key={l.key} text={l.text} /> : <AltiRun key={l.key} lines={[l.text]} locale={locale} />))}
                    {thinking && <TypingDots label={locale === "es" ? "Alti está escribiendo" : "Alti is typing"} />}
                    <AltiRun lines={qa.length > 0 ? [c.alti.backToSheet] : []} locale={locale}>
                      <div className="space-y-2" data-testid="question-box">
                        <TextAnswer key={`ask-${qa.length}`} label={c.input.question} autoComplete="off" send={c.input.ask} onSubmit={(v) => void ask(v)} />
                        <button type="button" onClick={() => setSheet("rights")} className={SECONDARY} data-testid="back-to-rights">
                          {locale === "es" ? "Volver a mis derechos" : "Back to my rights"}
                        </button>
                      </div>
                    </AltiRun>
                  </>
                )}
                {signedOff && (
                  <AltiRun
                    lines={[c.alti.signed(progress.signedName ?? a.firstName ?? "", progress.deadlineIso ? deadlineText(progress.deadlineIso, locale) : ""), c.alti.signedNext]}
                    locale={locale}
                  >
                    <div className={`${CARD} space-y-2.5`} data-testid="signup-done">
                      <p className="font-display text-[20px] font-bold text-blue-700">{c.done.title}</p>
                      {monitoringUrl ? (
                        <a href={monitoringUrl} target="_blank" rel="noopener noreferrer sponsored" className={PRIMARY}>
                          {c.done.monitoring}
                        </a>
                      ) : null}
                      <Link href="/asistente" className={monitoringUrl ? SECONDARY : PRIMARY} data-testid="done-app">
                        {c.done.app}
                      </Link>
                      <Link href="/acuerdo/copia" className={SECONDARY}>
                        {c.done.copy}
                      </Link>
                      <p className="text-[13px] leading-snug text-slate-500">{c.done.cancel}</p>
                      <p className="text-[12px] leading-snug text-slate-500">{AFFILIATE_DISCLOSURE[locale]}</p>
                    </div>
                  </AltiRun>
                )}
              </>
            )}
            {talk && (
              <TalkToPerson
                locale={locale}
                caseRef={progress.caseRef}
                callsEnabled={callsEnabled}
                onClose={() => {
                  setTalk(false);
                  talkButton.current?.focus();
                }}
                onChosen={() => update({}, { wantsPerson: true })}
              />
            )}
            <div ref={end} className="h-px scroll-mb-28" />
          </div>

          {/* At every step: a person, on WhatsApp (or a call, when calls are on). */}
          <footer className="sticky bottom-0 z-20 border-t hairline bg-white/95 px-4 py-3 backdrop-blur sm:px-6">
            <button
              ref={talkButton}
              type="button"
              onClick={() => setTalk((t) => !t)}
              aria-expanded={talk}
              className="pressable flex h-11 items-center gap-2 rounded-full bg-slate-100 pl-1.5 pr-4 text-[14px] font-semibold text-slate-900"
              data-testid="talk-button"
            >
              <PersonIcon size={32} />
              {c.talk.button}
            </button>
          </footer>
        </main>
      </div>
    </div>
  );
}

/** The cancellation deadline of the agreement just signed, as the agreement writes it. */
function deadlineText(iso: string, locale: "en" | "es"): string {
  return deadlineMoment(iso, locale);
}
