"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ALL_STATES, stateStatus } from "@/lib/compliance/states";
import Icon from "@/components/Icon";
import LocaleToggle from "@/components/LocaleToggle";
import Logo from "@/components/Logo";
import { CharacterAvatar, CharacterFigure } from "@/components/Character";
import { LocaleProvider, useLocale } from "@/lib/i18n";
import { MARKETING } from "@/lib/i18n/marketing";
import { MONITORING_OFFER } from "@/lib/monitoring/offer";
import { GOALS, parseInvite, type Invite } from "@/lib/sales/invite";
import { BRAND } from "@/lib/brand";
import { isFullService } from "@/lib/service/mode";
import { readStoredAgreement } from "@/lib/ux/agreementLocal";
import { isFullName } from "@/lib/agreement/signature";
import { markMilestone, readMilestones, resumeStep, type FirstWeekStep } from "@/lib/ux/firstWeek";
import FirstWeekProgress from "@/components/FirstWeekProgress";
import ShareChoice, { PartnerBadge, type SharePartnerFace } from "@/components/partners/ShareChoice";
import { EMPTY_CASE_FACTS } from "@/lib/case/timeline";
import { partnerDisplay, progressFromCaseFacts, SHARING_CONSENT_VERSION } from "@/lib/partners/sharing";
import { CLIENT_SHARING_COPY } from "@/lib/partners/sharingCopy";
import { demoPartnerByCode, writeDemoClientSharing } from "@/lib/partners/sharingDemo";
import { isDemoMode } from "@/lib/supabase/config";

// Onboarding: goal (feeds the mortgage track) → state gate (v1 is TX-only;
// other states join the waitlist, since expansion is a legal project, not a
// config change) → the monitoring subscription (a separate subscription, bought
// from and paid to the monitoring provider, with our commission disclosed; the
// service fee is not stated here, the team explains the plan) → how you want
// to do your review (with the AI assistant, or with a teammate on WhatsApp;
// either way the answers are the client's and the team mails the letters).
// Characters: the invited welcome is from the team, so Alti (the face of the
// team, never a specific person) greets; on the review choice the robot marks the
// AI assistant and Alti marks "a person by my side".
// One question per screen, one obvious button.
//
// Sales-led path: most customers arrive from a WhatsApp conversation with a
// salesperson, who sends a personal link (see src/lib/sales/invite.ts). The
// link opens on a welcome screen with the answers already filled in, so the
// customer confirms instead of re-answering, then goes to monitoring and in.
// The state gate and every later decision still apply.
//
// First week: the same four steps everywhere ("Paso 1 de 4 · Tus datos · 1
// minuto", src/lib/ux/firstWeek.ts). A client who comes back through their link
// after signing picks up where they left off, without the welcome again. The
// time each step took is kept on the device only, to find friction.
//
// Referred by a partner (the link carries their code): the welcome says who
// ("Te recomendó María López, ABC Realty", with their logo once an
// administrator approved it), and one more screen asks whether that partner
// may follow the client's progress: No compartir (the default) / Solo el
// avance / Avance y resumen, with exactly what they would and would never see.
// Before sign-in the choice waits on the device (PENDING_SHARE_KEY);
// OnboardingSync records it once the client is signed in, through
// /api/sharing, which checks the text's hash like any other choice.
//
// Language: Spanish first, with the same ES/EN switch as the app. The choice is
// kept on the device, so it carries into the app. The words live in
// src/lib/i18n/marketing.ts.

const STATES = ["TX", ...ALL_STATES.filter((s) => s !== "TX")];

/** A sharing choice made before sign-in, recorded by OnboardingSync. */
const PENDING_SHARE_KEY = "bonalti.partnerShare";

/** Where the link's answers wait while the client is away signing the agreement. */
const RETURN_KEY = "bonalti.onboardingReturn";

function save(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

const primaryButton =
  "pressable flex h-14 w-full items-center justify-center rounded-full bg-amber-400 text-[17px] font-semibold text-blue-900 hover:bg-amber-500 disabled:bg-slate-200 disabled:text-slate-500";

export default function OnboardingPage() {
  return (
    <LocaleProvider>
      <Onboarding />
    </LocaleProvider>
  );
}

function Onboarding() {
  const router = useRouter();
  const { locale } = useLocale();
  const c = MARKETING[locale].onboarding;
  const goalLabel = (g: (typeof GOALS)[number]) => (locale === "en" ? g.labelEn : g.label);
  const [step, setStep] = useState<"welcome" | "share" | "goal" | "state" | "monitoring" | "assist" | "waitlist-done">("goal");
  const [partner, setPartner] = useState<(SharePartnerFace & { id: string | null }) | null>(null);
  const [shareDone, setShareDone] = useState(false);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [ready, setReady] = useState(false);
  const [goal, setGoal] = useState<string | null>(null);
  const [state, setState] = useState("TX");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const whatsappNumber = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;
  const invited = invite !== null;
  /** True when the client came back and was taken to where they left off. */
  const [resumed, setResumed] = useState(false);
  const weekStep: FirstWeekStep = step === "monitoring" ? "monitoring" : step === "assist" ? "review" : "details";

  // Read the invite link once, on arrival.
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    // Back from signing the agreement: pick up at monitoring, with the same invitation.
    if (query.get("paso") === "monitoreo") {
      let saved = "";
      try {
        saved = window.localStorage.getItem(RETURN_KEY) ?? "";
      } catch {
        // ignore
      }
      const invited = parseInvite(new URLSearchParams(saved));
      if (invited) {
        setInvite(invited);
        if (invited.goal) setGoal(invited.goal);
        if (invited.state) setState(invited.state);
      }
      setStep("monitoring");
      setReady(true);
      return;
    }
    const parsed = parseInvite(query);
    // Back again after signing: straight to the first step not done (no welcome a second time).
    const signed = Boolean(readStoredAgreement()?.signedAt);
    if (isFullService && signed) {
      const next = resumeStep(readMilestones(), true);
      if (next === "monitoring") {
        if (parsed) setInvite(parsed);
        setResumed(true);
        setStep("monitoring");
        setReady(true);
        return;
      }
      if (next === "review") {
        router.replace("/asistente");
        return;
      }
    }
    markMilestone("invite_opened");
    if (parsed) {
      // A full name on the link fills in the signature field later; the client checks it there.
      if (parsed.name && isFullName(parsed.name)) save("bonalti.inviteName", parsed.name);
      setInvite(parsed);
      if (parsed.goal) {
        setGoal(parsed.goal);
        save("bonalti.goal", parsed.goal);
      }
      if (parsed.state) setState(parsed.state);
      if (parsed.ref) save("bonalti.ref", parsed.ref);
      // A partner's referral code (migration 0017): sent with the profile at first sign-in, credited only to an approved partner.
      if (parsed.partner) save("bonalti.partner", parsed.partner);
      setStep("welcome");
    }
    setReady(true);
  }, []);

  /**
   * On to monitoring. Under full service the agreement is signed first: the
   * client reads their rights and the contract before buying anything, and
   * comes back here afterwards (see /acuerdo).
   */
  const toMonitoring = () => {
    markMilestone("details_done");
    if (isFullService && !readStoredAgreement()?.signedAt) {
      save(RETURN_KEY, window.location.search);
      router.push("/acuerdo?desde=inicio");
      return;
    }
    setStep("monitoring");
  };

  // The partner on the link: their public face (approved partners only).
  useEffect(() => {
    const code = invite?.partner;
    if (!code) return;
    if (isDemoMode()) {
      const p = demoPartnerByCode(code);
      if (p) setPartner({ id: p.id, name: p.name, company: p.company, logo: null });
      return;
    }
    fetch(`/api/partners/public?code=${encodeURIComponent(code)}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ partner?: SharePartnerFace }>) : null))
      .then((body) => body?.partner && setPartner({ ...body.partner, id: null }))
      .catch(() => undefined);
  }, [invite?.partner]);

  /** After the welcome screen: the partner question, once, then the rest. */
  const afterWelcome = () => {
    if (partner && !shareDone) return setStep("share");
    continueAfterWelcome();
  };

  /** Only ask for what the link did not carry. */
  const continueAfterWelcome = () => {
    if (!goal) return setStep("goal");
    if (!invite?.state) return setStep("state");
    save("bonalti.state", state);
    // A state we are not open in goes to the waitlist form, link or no link.
    if (stateStatus(state) === "open") toMonitoring();
    else setStep("state");
  };

  /** After monitoring: an invited customer already has their person; go straight in. */
  const afterMonitoring = () => {
    markMilestone("monitoring_done");
    if (!invited) return setStep("assist");
    save("bonalti.assisted", "1");
    router.push("/asistente");
  };
  const { providerName, signupUrl } = MONITORING_OFFER;

  const joinWaitlist = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await fetch("/api/waitlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, state, locale }),
    }).catch(() => undefined);
    setBusy(false);
    setStep("waitlist-done");
  };

  const finish = (assisted: boolean) => {
    markMilestone("monitoring_done");
    save("bonalti.assisted", assisted ? "1" : "0");
    if (assisted && whatsappNumber) {
      window.open(
        `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(c.assistWhatsappText)}`,
        "_blank",
      );
    }
    router.push("/asistente");
  };

  // One tick while the link is read, so an invited customer never sees the
  // generic first question flash by.
  if (!ready) return null;

  return (
    <main className="client-scale mx-auto flex min-h-dvh max-w-md flex-col px-6 pb-10 pt-6">
      <div className="flex items-center justify-between gap-3">
        <Link href="/" aria-label={BRAND.name} className="flex h-11 items-center">
          <Logo size={24} priority />
        </Link>
        <div className="flex items-center gap-3">
          <LocaleToggle />
        </div>
      </div>
      {step !== "waitlist-done" && <FirstWeekProgress step={weekStep} className="mt-4" />}

      {step === "welcome" && invite && (
        <div className="animate-rise flex flex-1 flex-col pt-10">
          {/* Alti stands on a white card, feet on its lower edge, with the team's name beside him. */}
          <div className="card flex items-end gap-5 overflow-hidden px-6 pt-5">
            <CharacterFigure character="team" height={150} />
            <p className="self-center font-display text-[22px] font-bold leading-tight text-blue-700">{c.teamTag}</p>
          </div>
          <h1 className="mt-5 font-display text-[34px] font-bold leading-tight text-blue-700">
            {c.hello(invite.name)}
          </h1>
          <p className="mt-3 text-[17px] leading-relaxed text-slate-500">
            {c.sentBy(invite.refName)}
          </p>
          {partner && (
            <div className="card mt-5 p-4" data-testid="welcome-partner">
              <PartnerBadge partner={partner} line={locale === "es" ? "Te recomendó" : "Referred by"} />
              <p className="sr-only">{CLIENT_SHARING_COPY[locale].referredBy(partnerDisplay(partner))}</p>
            </div>
          )}
          {(goal || invite.state) && (
            <div className="card mt-7 overflow-hidden">
              {goal && (
                <div className="flex items-baseline justify-between gap-4 px-5 py-4">
                  <span className="text-[15px] text-slate-500">{c.yourGoal}</span>
                  <span className="text-right text-[16px] font-medium text-slate-900">
                    {GOALS.filter((g) => g.key === goal).map(goalLabel)[0]}
                  </span>
                </div>
              )}
              {invite.state && (
                <div className={`flex items-baseline justify-between gap-4 px-5 py-4 ${goal ? "border-t hairline" : ""}`}>
                  <span className="text-[15px] text-slate-500">{c.yourState}</span>
                  <span className="text-right text-[16px] font-medium text-slate-900">
                    {invite.state === "TX" ? "Texas" : invite.state}
                  </span>
                </div>
              )}
            </div>
          )}
          <p className="mt-4 text-[13px] leading-relaxed text-slate-500">
            {c.welcomeNote}
          </p>
          <div className="mt-auto space-y-3 pt-8">
            <button onClick={afterWelcome} className={primaryButton}>
              {c.yesStart}
            </button>
            <button
              onClick={() => {
                setInvite((current) => (current ? { ...current, state: null } : current));
                setGoal(null);
                setStep("goal");
              }}
              className="pressable flex h-12 w-full items-center justify-center text-[15px] font-medium text-blue-700"
            >
              {c.changeAnswers}
            </button>
          </div>
        </div>
      )}

      {step === "share" && partner && (
        <div className="animate-rise flex flex-1 flex-col pt-8" data-testid="onboarding-share">
          <div className="card p-4">
            <PartnerBadge partner={partner} line={locale === "es" ? "Te recomendó" : "Referred by"} />
          </div>
          <h1 className="mt-5 font-display text-[28px] font-bold leading-tight text-blue-700">{CLIENT_SHARING_COPY[locale].shareTitle(partner.name)}</h1>
          <p className="mt-2 text-[16px] leading-relaxed text-slate-500">{CLIENT_SHARING_COPY[locale].shareLead(partner.name)}</p>
          <div className="mt-5">
            <ShareChoice
              partner={partner}
              current="none"
              locale={locale}
              now={new Date()}
              saveLabel={CLIENT_SHARING_COPY[locale].continue}
              preview={(level) => progressFromCaseFacts(EMPTY_CASE_FACTS, { name: invite?.name ?? (locale === "es" ? "Tu nombre" : "Your name"), goal, level })}
              onSave={async (level, textHash) => {
                if (isDemoMode() && partner.id) writeDemoClientSharing(partner.id, level);
                else if (level !== "none" && invite?.partner) save(PENDING_SHARE_KEY, JSON.stringify({ code: invite.partner, level, locale, version: SHARING_CONSENT_VERSION, textHash }));
                setShareDone(true);
                continueAfterWelcome();
                return { ok: true };
              }}
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setShareDone(true);
              continueAfterWelcome();
            }}
            className="pressable mt-2 flex h-12 w-full items-center justify-center text-[15px] font-medium text-blue-700"
          >
            {CLIENT_SHARING_COPY[locale].later}
          </button>
          <p className="text-center text-[13px] text-slate-500">{CLIENT_SHARING_COPY[locale].laterNote}</p>
        </div>
      )}

      {step === "goal" && (
        <div className="animate-rise flex flex-1 flex-col pt-12">
          <h1 className="font-display text-[34px] font-bold leading-tight text-blue-700">{c.goalTitle}</h1>
          <p className="mt-3 text-[17px] text-slate-500">{c.goalSub}</p>
          <div className="card mt-8 overflow-hidden">
            {GOALS.map((g, index) => (
              <button
                key={g.key}
                onClick={() => setGoal(g.key)}
                aria-pressed={goal === g.key}
                className={`pressable flex w-full items-center justify-between px-5 py-4 text-left text-[17px] text-slate-900 hover:bg-slate-50 ${
                  index > 0 ? "border-t hairline" : ""
                } ${goal === g.key ? "font-semibold" : ""}`}
              >
                {goalLabel(g)}
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full ${
                    goal === g.key ? "bg-amber-400 text-blue-900" : "border-2 border-slate-300"
                  }`}
                >
                  {goal === g.key && <Icon name="check" size={14} strokeWidth={3} />}
                </span>
              </button>
            ))}
          </div>
          <div className="mt-auto pt-8">
            <button
              onClick={() => {
                if (goal) {
                  save("bonalti.goal", goal);
                  setStep("state");
                }
                // (An invited customer who changed their answers continues through
                // the ordinary state question, which also applies the state gate.)
              }}
              disabled={!goal}
              className={primaryButton}
            >
              {c.next}
            </button>
          </div>
        </div>
      )}

      {step === "state" && (
        <div className="animate-rise flex flex-1 flex-col pt-12">
          <h1 className="font-display text-[34px] font-bold leading-tight text-blue-700">{c.stateTitle}</h1>
          <p className="mt-3 text-[17px] text-slate-500">{c.stateSub}</p>
          <select
            value={state}
            onChange={(e) => setState(e.target.value)}
            aria-label={c.stateLabel}
            className="mt-8 h-14 w-full rounded-2xl bg-white px-4 text-[17px] text-slate-900 shadow-[0_0_0_1px_rgba(0,0,0,0.08)] outline-none focus:ring-2 focus:ring-blue-300"
          >
            {STATES.map((s) => (
              <option key={s} value={s}>
                {s === "TX" ? "Texas (TX)" : s}
              </option>
            ))}
          </select>

          {stateStatus(state) === "open" ? (
            <div className="mt-auto pt-8">
              <button
                onClick={() => {
                  save("bonalti.state", state);
                  toMonitoring();
                }}
                className={primaryButton}
              >
                {c.next}
              </button>
            </div>
          ) : (
            <form onSubmit={joinWaitlist} className="card mt-6 p-5">
              <p className="text-[17px] font-semibold text-slate-900">{c.notYetTitle}</p>
              <p className="mt-1 text-[15px] text-slate-500">{c.notYetBody}</p>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={c.emailPlaceholder}
                aria-label={c.emailLabel}
                className="mt-4 h-12 w-full rounded-2xl bg-slate-100 px-4 text-[16px] outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-blue-300"
              />
              <button type="submit" disabled={busy} className={`${primaryButton} mt-3`}>
                {c.notifyMe}
              </button>
            </form>
          )}
        </div>
      )}

      {step === "monitoring" && (
        <div className="animate-rise flex flex-1 flex-col pt-12">
          {resumed && (
            <p className="mb-3 rounded-2xl bg-blue-50 px-4 py-3 text-[15px] leading-snug text-blue-900" data-testid="resumed">
              {locale === "es" ? "Ya firmaste tu acuerdo. Sigue donde te quedaste." : "You already signed your agreement. Pick up where you left off."}
            </p>
          )}
          <h1 className="font-display text-[34px] font-bold leading-tight text-blue-700">{c.monitoringTitle}</h1>
          <p className="mt-3 text-[17px] text-slate-500">{c.monitoringSub}</p>
          <div className="card mt-8 overflow-hidden">
            {c.monitoringRows(providerName).map(([label, value], index) => (
              <div key={label} className={`flex items-baseline justify-between gap-4 px-5 py-4 ${index > 0 ? "border-t hairline" : ""}`}>
                <span className="text-[15px] text-slate-500">{label}</span>
                <span className="text-right text-[16px] font-medium text-slate-900">{value}</span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[13px] leading-relaxed text-slate-500">
            {c.disclosure}
            {/* Only where there is a number to write to. */}
            {whatsappNumber && (
              <>
                {" "}
                {c.itinQuestion}{" "}
                <a
                  href={`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(c.itinWhatsappText)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-blue-700"
                >
                  {c.itinLink}
                </a>
              </>
            )}
          </p>
          <div className="mt-auto space-y-3 pt-8">
            {signupUrl ? (
              <>
                <a
                  href={signupUrl}
                  target="_blank"
                  rel="noopener noreferrer sponsored"
                  onClick={() => save("bonalti.monitoringClicked", new Date().toISOString())}
                  className={primaryButton}
                >
                  {c.activate}
                </a>
                <button
                  onClick={afterMonitoring}
                  className="pressable flex h-14 w-full items-center justify-center rounded-full bg-slate-100 text-[17px] font-medium text-slate-900"
                >
                  {c.haveIt}
                </button>
              </>
            ) : (
              <>
                <button onClick={afterMonitoring} className={primaryButton}>
                  {c.next}
                </button>
                <p className="text-center text-[13px] text-slate-500">{c.demoReport}</p>
              </>
            )}
          </div>
        </div>
      )}

      {step === "assist" && (
        <div className="animate-rise flex flex-1 flex-col pt-12">
          <h1 className="font-display text-[34px] font-bold leading-tight text-blue-700">{c.assistTitle}</h1>
          <p className="mt-3 text-[17px] text-slate-500">{c.assistSub}</p>
          <div className="mt-8 space-y-3">
            <button onClick={() => finish(false)} className="card pressable flex w-full items-center gap-4 p-5 text-left">
              <CharacterAvatar character="assistant" view="headThreeQuarter" size={52} decorative />
              <span className="min-w-0 flex-1">
                <span className="block text-[17px] font-semibold text-slate-900">{c.withAssistant}</span>
                <span className="block text-[15px] leading-snug text-slate-500">
                  {c.withAssistantSub}
                </span>
              </span>
              <Icon name="chevron" size={18} className="shrink-0 text-slate-300" />
            </button>
            <button onClick={() => finish(true)} className="card pressable flex w-full items-center gap-4 p-5 text-left">
              <CharacterAvatar character="team" size={52} />
              <span className="min-w-0 flex-1">
                <span className="block text-[17px] font-semibold text-slate-900">{c.withPerson}</span>
                <span className="block text-[15px] leading-snug text-slate-500">
                  {c.withPersonSub}
                </span>
              </span>
              <Icon name="chevron" size={18} className="shrink-0 text-slate-300" />
            </button>
          </div>
          <p className="mt-6 text-[13px] leading-relaxed text-slate-500">
            {c.assistNote}
          </p>
        </div>
      )}

      {step === "waitlist-done" && (
        <div className="animate-rise flex flex-1 flex-col items-center justify-center text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-green-50 text-green-700">
            <Icon name="check" size={32} strokeWidth={2.5} />
          </span>
          <h1 className="mt-5 font-display text-[28px] font-bold text-slate-900">{c.waitlistDone}</h1>
          <p className="mt-2 max-w-xs text-[16px] text-slate-500">
            {c.waitlistDoneSub}
          </p>
          <Link href="/" className="mt-6 inline-flex h-11 items-center text-[16px] font-medium text-blue-700">
            {c.backHome}
          </Link>
        </div>
      )}
    </main>
  );
}
