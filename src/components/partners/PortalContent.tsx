"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n";
import { partnerRules, PARTNER_COPY } from "@/lib/partners/copy";
import { demoProgram } from "@/lib/partners/data";
import { buildDemoCommissions, buildDemoPartners, DEMO_PORTAL_PARTNER } from "@/lib/partners/demo";
import { NO_FEES_LINE } from "@/lib/partners/program";
import { PORTAL_COPY } from "@/lib/partners/portalCopy";
import { demoReferrals, writeDemoShareRequest } from "@/lib/partners/portalDemo";
import { commissionTotals, partnerLink, PARTNER_KIND_LABEL, type PartnerKind, type PartnerReferral } from "@/lib/partners/rules";
import type { PartnerProgress } from "@/lib/partners/sharing";
import { PARTNER_SHARING_COPY } from "@/lib/partners/sharingCopy";
import { demoPartnerClients } from "@/lib/partners/sharingDemo";
import { PARTNER_CLIENT_TERMS_VERSION, partnerTerms, partnerTermsHash } from "@/lib/partners/terms";
import { formatCents } from "@/lib/billing/rules";
import { getStaffData } from "@/lib/staff/data";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { isDemoMode } from "@/lib/supabase/config";
import Icon from "@/components/Icon";
import LocaleToggle from "@/components/LocaleToggle";
import Logo from "@/components/Logo";
import PartnerKit, { TeamPromiseCard } from "./PartnerKit";
import PortalPipeline from "./PortalPipeline";

// The partner portal: a dashboard so the partner sees their clients are in
// good hands. The pipeline (Referred → Contacted → Signed → Active →
// Finished) with counts, and their people: each with who on the team looks
// after them, when sales reached out, and only what that person chose to
// share ("Don't share", the default, is the coarse step only; with consent,
// their stage and a link to their page: partner_clients(), migration 0023).
// "Ask to follow progress" (migration 0033). Beside it: the team's promise
// (process words), the partner kit (link, QR, messages, flyer), the referral
// form, notices and the weekly summary, their logo, the commission an
// administrator recorded (only while "Comisiones a socios" is on) and the
// rules. Before the client list, once per version, the partner terms. Never a
// client's credit data, letters, score or payments: the server sends none.

interface PortalView {
  partner: {
    /** Demo only: which invented partner this is. */
    id?: string;
    name: string;
    company: string | null;
    kind: PartnerKind;
    referralCode: string | null;
    logoStatus: string;
    notifyEmail: boolean;
    notifyWhatsapp: boolean;
    /** The weekly summary: off (null), or the channel the partner chose. Never SMS. */
    digestChannel?: "whatsapp" | "email" | null;
    hasEmail: boolean;
    /** The language their notices go out in (partners.locale). */
    locale?: "es" | "en";
  };
  program: { commissionsEnabled: boolean };
  terms: { accepted: boolean; version: string };
  referrals: PartnerReferral[];
  commissions: null | { owedCents: number; paidCents: number; balanceCents: number; records: Array<{ id: string; kind: "owed" | "paid"; amountCents: number; note: string | null; recordedAt: string }> };
  clients: PartnerProgress[];
  /** "Connect me with a loan officer" requests to this partner (migration 0030): name, phone, goal, date. */
  introRequests?: IntroRequestView[];
}

interface IntroRequestView {
  id: string;
  name: string;
  phone: string | null;
  goal: string | null;
  at: string;
}

/** Clients who asked this partner to contact them about buying a home: what they agreed to share, nothing else. */
function IntroRequests({ requests, locale }: { requests: readonly IntroRequestView[]; locale: "es" | "en" }) {
  if (requests.length === 0) return null;
  const es = locale === "es";
  return (
    <div className="mt-6" data-testid="partner-intros">
      <h2 className="px-1 pb-1 text-[13px] font-semibold uppercase tracking-wide text-slate-500">
        {es ? "Quieren hablar contigo" : "Want to talk to you"} · {requests.length}
      </h2>
      <p className="px-1 pb-2 text-[13px] leading-snug text-slate-600">
        {es
          ? "Estos clientes pidieron que los contactes por su meta de comprar casa. Aceptaron compartir su nombre y teléfono contigo para esto. No hay pago por la presentación."
          : "These clients asked you to contact them about buying a home. They agreed to share their name and phone with you for this. There is no payment for the introduction."}
      </p>
      <ul className="card overflow-hidden">
        {requests.map((r, i) => (
          <li key={r.id} className={`flex items-center justify-between gap-3 px-4 py-3 ${i > 0 ? "border-t hairline" : ""}`}>
            <span className="min-w-0">
              <span className="block text-[16px] font-semibold text-slate-900">{r.name}</span>
              <span className="block text-[13px] text-slate-500">{new Date(r.at).toLocaleDateString(es ? "es-MX" : "en-US", { day: "numeric", month: "long" })}</span>
            </span>
            {r.phone && <span className="shrink-0 text-[15px] font-semibold tabular-nums text-blue-700">{r.phone}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The demo client's own introduction request (this browser), when it asked this partner. */
function demoIntroRequests(partnerId: string): IntroRequestView[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem("credalti.demoAftercare.v1") ?? "{}") as { introRequest?: { partnerId: string; at: string } | null };
    const r = raw.introRequest;
    if (!r || r.partnerId !== partnerId) return [];
    return [{ id: "demo-intro", name: window.localStorage.getItem("bonalti.inviteName") || "Rosa Martínez", phone: "+1 (210) 555-0100", goal: "mortgage", at: r.at }];
  } catch {
    return [];
  }
}

const DEMO_SENT = "credalti.demoPartnerReferrals";
const DEMO_PORTAL = "credalti.demoPortal.v1";

const field =
  "h-12 w-full rounded-2xl bg-white px-4 text-[16px] text-slate-900 shadow-[0_0_0_1px_rgba(0,0,0,0.1)] outline-none focus:ring-2 focus:ring-blue-300";
const label = "block pb-1.5 text-[13px] font-semibold uppercase tracking-wide text-slate-500";

interface DemoPortalState {
  termsAccepted: boolean;
  notifyEmail: boolean;
  notifyWhatsapp: boolean;
  digestChannel: "whatsapp" | "email" | null;
  logoStatus: string;
}

function readDemoPortal(): DemoPortalState {
  try {
    const raw = window.localStorage.getItem(DEMO_PORTAL);
    if (raw) return { termsAccepted: false, notifyEmail: false, notifyWhatsapp: true, digestChannel: null, logoStatus: "none", ...(JSON.parse(raw) as Partial<DemoPortalState>) };
  } catch {
    // ignore
  }
  return { termsAccepted: false, notifyEmail: false, notifyWhatsapp: true, digestChannel: null, logoStatus: "none" };
}

function writeDemoPortal(change: Partial<DemoPortalState>): void {
  try {
    window.localStorage.setItem(DEMO_PORTAL, JSON.stringify({ ...readDemoPortal(), ...change }));
  } catch {
    // Kept for this visit only.
  }
}

async function demoView(): Promise<PortalView> {
  const now = new Date();
  const partner = buildDemoPartners(now).find((p) => p.id === DEMO_PORTAL_PARTNER)!;
  const clients = await getStaffData().listClients();
  let sent: PartnerReferral[] = [];
  try {
    sent = JSON.parse(window.localStorage.getItem(DEMO_SENT) ?? "[]") as PartnerReferral[];
  } catch {
    sent = [];
  }
  const local0 = readDemoPortal();
  // The client ids of those who share appear only once the terms are accepted, as the database does.
  const referrals = demoReferrals(partner.id, clients, sent, now).map((r) => (local0.termsAccepted ? r : { ...r, sharedClientId: null }));
  const program = demoProgram();
  const records = buildDemoCommissions(now).filter((r) => r.partnerId === partner.id);
  const local = readDemoPortal();
  return {
    partner: { id: partner.id, name: partner.name, company: partner.company, kind: partner.kind, referralCode: partner.referralCode, logoStatus: local.logoStatus, notifyEmail: local.notifyEmail, notifyWhatsapp: local.notifyWhatsapp, digestChannel: local.digestChannel, hasEmail: true },
    program: { commissionsEnabled: program.commissionsEnabled },
    terms: { accepted: local.termsAccepted, version: PARTNER_CLIENT_TERMS_VERSION },
    referrals,
    commissions: program.commissionsEnabled ? { ...commissionTotals(records), records: [...records].reverse() } : null,
    clients: local.termsAccepted ? demoPartnerClients(partner.id, clients, now) : [],
    introRequests: local.termsAccepted ? demoIntroRequests(partner.id) : [],
  };
}

function TermsGate({ locale, commissionsEnabled, onAccept }: { locale: "es" | "en"; commissionsEnabled: boolean; onAccept: () => Promise<boolean> }) {
  const t = partnerTerms(locale, commissionsEnabled);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  return (
    <section className="card p-5" aria-labelledby="terminos" data-testid="partner-terms">
      <p className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-blue-900">{t.draftNote}</p>
      <h2 id="terminos" className="mt-3 text-[22px] font-semibold text-slate-900">{t.title}</h2>
      <p className="mt-1 text-[15px] leading-relaxed text-slate-600">{t.intro}</p>
      <ol className="mt-4 space-y-3">
        {t.clauses.map((clause, i) => (
          <li key={clause.title} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[13px] font-semibold text-blue-700">{i + 1}</span>
            <span className="min-w-0 text-[14.5px] leading-snug text-slate-700">
              <strong className="block text-slate-900">{clause.title}</strong>
              {clause.body}
            </span>
          </li>
        ))}
      </ol>
      <label className="mt-5 flex cursor-pointer items-start gap-3 text-[15px] leading-snug text-slate-800">
        <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-blue-700" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        <span>{t.accept}</span>
      </label>
      <button
        type="button"
        disabled={!checked || busy}
        onClick={async () => {
          setBusy(true);
          setError(!(await onAccept()));
          setBusy(false);
        }}
        className="pressable mt-4 flex h-12 w-full items-center justify-center rounded-full bg-blue-900 text-[16px] font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500"
      >
        {t.button}
      </button>
      {error && <p className="mt-2 text-[14px] text-red-600" role="alert">{PARTNER_COPY[locale].portal.error}</p>}
    </section>
  );
}

export default function PortalContent() {
  const { locale } = useLocale();
  const copy = PARTNER_COPY[locale];
  const c = copy.portal;
  const s = PARTNER_SHARING_COPY[locale];
  const p = PORTAL_COPY[locale];
  const demo = isDemoMode();
  const [view, setView] = useState<PortalView | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "not_approved">("loading");
  const [origin, setOrigin] = useState("");
  const [now, setNow] = useState<Date>(() => new Date());
  const [form, setForm] = useState({ firstName: "", lastName: "", phone: "" });
  const [consent, setConsent] = useState(false);
  const [send, setSend] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [settingsNote, setSettingsNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (demo) {
      setView(await demoView());
      setState("ready");
      return;
    }
    const res = await fetch("/api/partners/portal", { cache: "no-store" });
    if (res.ok) {
      setView((await res.json()) as PortalView);
      setState("ready");
      return;
    }
    const me = (await fetch("/api/partners/me", { cache: "no-store" }).then((r) => r.json()).catch(() => ({}))) as { applied?: boolean };
    if (me.applied) setState("not_approved");
    else window.location.assign("/login?next=/socios/portal");
  }, [demo]);

  useEffect(() => {
    setOrigin(window.location.origin);
    setNow(new Date());
    void load();
  }, [load]);

  // The language the partner reads the portal in is the one their notices go out in.
  const savedLocale = view?.partner.locale;
  useEffect(() => {
    if (demo || !savedLocale || savedLocale === locale) return;
    void fetch("/api/partners/portal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "language", locale }) })
      .then((res) => {
        if (res.ok) setView((v) => (v ? { ...v, partner: { ...v.partner, locale } } : v));
      })
      .catch(() => undefined);
  }, [demo, savedLocale, locale]);

  const link = view?.partner.referralCode && origin ? partnerLink(origin, view.partner.referralCode) : null;

  const portalPost = async (body: Record<string, unknown>): Promise<boolean> => {
    const res = await fetch("/api/partners/portal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    return Boolean(res?.ok);
  };

  const acceptTerms = async (): Promise<boolean> => {
    if (!view) return false;
    if (demo) writeDemoPortal({ termsAccepted: true });
    else if (!(await portalPost({ action: "accept_terms", locale, version: PARTNER_CLIENT_TERMS_VERSION, textHash: partnerTermsHash(locale, view.program.commissionsEnabled) }))) return false;
    await load();
    return true;
  };

  const saveNotices = async (notifyEmail: boolean, notifyWhatsapp: boolean, digestChannel: "whatsapp" | "email" | null) => {
    if (demo) writeDemoPortal({ notifyEmail, notifyWhatsapp, digestChannel });
    else if (!(await portalPost({ action: "settings", notifyEmail, notifyWhatsapp, digestChannel }))) return setSettingsNote(s.error);
    setSettingsNote(s.saved);
    await load();
  };

  const askShare = async (referralId: string): Promise<boolean> => {
    if (demo) writeDemoShareRequest(referralId, new Date().toISOString());
    else if (!(await portalPost({ action: "ask_share", referralId }))) return false;
    await load();
    return true;
  };

  const uploadLogo = async (file: File | null) => {
    if (!file) return;
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.readAsDataURL(file);
    });
    if (demo) writeDemoPortal({ logoStatus: "pending" });
    else if (!(await portalPost({ action: "logo", dataUrl }))) return setSettingsNote(s.error);
    setSettingsNote(s.saved);
    await load();
  };

  const removeLogo = async () => {
    if (demo) writeDemoPortal({ logoStatus: "none" });
    else await portalPost({ action: "logo", dataUrl: null });
    await load();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consent || send === "sending") return;
    setSend("sending");
    if (demo) {
      const referral: PartnerReferral = {
        id: `demo-${Date.now()}`,
        firstName: form.firstName.trim() || "—",
        lastInitial: form.lastName.trim().slice(0, 1),
        referredAt: new Date().toISOString(),
        status: "referred",
        contactedAt: null,
        hasAccount: false,
      };
      try {
        const sent = JSON.parse(window.localStorage.getItem(DEMO_SENT) ?? "[]") as PartnerReferral[];
        window.localStorage.setItem(DEMO_SENT, JSON.stringify([referral, ...sent]));
      } catch {
        // Kept for this visit only.
      }
    } else {
      const res = await fetch("/api/partners/referrals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, consent: true }),
      }).catch(() => null);
      if (!res?.ok) {
        setSend("error");
        return;
      }
    }
    setForm({ firstName: "", lastName: "", phone: "" });
    setConsent(false);
    setSend("sent");
    await load();
  };

  const signOut = async () => {
    await getBrowserSupabase()?.auth.signOut();
    window.location.assign("/login");
  };

  const fees = view?.program.commissionsEnabled ?? false;
  const digest = view?.partner.digestChannel ?? null;

  return (
    <main className="min-h-dvh bg-slate-50 pb-12">
      <header className="sticky top-0 z-20 border-b hairline bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <Logo size={24} priority />
            <span className="hidden truncate rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 min-[420px]:inline">{c.title}</span>
          </div>
          <div className="flex items-center gap-2">
            {demo && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-blue-900">Demo</span>}
            <LocaleToggle />
          </div>
        </div>
      </header>

      {state === "not_approved" && (
        <div className="mx-auto max-w-xl px-4 pt-8">
          <div className="card p-5 text-[15px] leading-relaxed text-slate-700">{c.notApproved}</div>
        </div>
      )}

      {state === "ready" && view && (
        <div className="mx-auto max-w-6xl px-4 pt-6">
          <div>
            <h1 className="font-display text-[28px] font-bold leading-tight text-blue-700">{c.hello(view.partner.name.split(" ")[0] ?? view.partner.name)}</h1>
            <p className="mt-0.5 text-[14px] text-slate-500">
              {[view.partner.company, PARTNER_KIND_LABEL[locale][view.partner.kind]].filter(Boolean).join(" · ")}
            </p>
            {demo && <p className="mt-2 text-[13px] text-slate-500">{c.demoNote}</p>}
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] lg:items-start">
            <div className="min-w-0 space-y-6">
              {!view.terms.accepted && <TermsGate locale={locale} commissionsEnabled={fees} onAccept={acceptTerms} />}

              <PortalPipeline locale={locale} referrals={view.referrals} clients={view.clients} now={now} onAsk={askShare} />

              {view.terms.accepted && view.clients.length === 0 && (
                <p className="card px-5 py-4 text-[14px] leading-snug text-slate-600" data-testid="partner-clients">{s.clientsEmpty}</p>
              )}
              {view.terms.accepted && <IntroRequests requests={view.introRequests ?? []} locale={locale} />}

              <section className="card p-5" aria-labelledby="enviar" data-testid="partner-send">
                <h2 id="enviar" className="text-[18px] font-semibold text-slate-900">{c.sendTitle}</h2>
                <p className="mt-1 text-[14px] leading-snug text-slate-600">{c.sendHelp}</p>
                <form onSubmit={submit} className="mt-4 space-y-3.5">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={label} htmlFor="r-first">{c.firstName}</label>
                      <input id="r-first" className={field} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} autoComplete="off" required />
                    </div>
                    <div>
                      <label className={label} htmlFor="r-last">{c.lastName}</label>
                      <input id="r-last" className={field} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} autoComplete="off" required />
                    </div>
                  </div>
                  <div>
                    <label className={label} htmlFor="r-phone">{c.phone}</label>
                    <input id="r-phone" className={field} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel" placeholder="(713) 555-1234" autoComplete="off" required />
                  </div>
                  <label className="flex cursor-pointer items-start gap-3 text-[14px] leading-snug text-slate-700">
                    <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-blue-700" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                    <span>{c.consent}</span>
                  </label>
                  <button
                    type="submit"
                    disabled={!consent || send === "sending"}
                    className="pressable flex h-12 w-full items-center justify-center rounded-full bg-blue-900 text-[16px] font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500"
                  >
                    {send === "sending" ? c.sending : c.submit}
                  </button>
                  {send === "sent" && (
                    <p className="rounded-2xl bg-green-50 px-4 py-3 text-[14px] leading-snug text-green-700" role="status">
                      {c.sent} {c.sentNote}
                    </p>
                  )}
                  {send === "error" && <p className="text-[14px] text-red-600" role="alert">{c.error}</p>}
                </form>
              </section>
            </div>

            <div className="min-w-0 space-y-6">
              <TeamPromiseCard locale={locale} />

              {link && view.partner.referralCode && (
                <PartnerKit locale={locale} link={link} code={view.partner.referralCode} partner={{ name: view.partner.name, kind: view.partner.kind }} commissionsEnabled={fees} />
              )}

              <section className="card p-5" id="avisos" data-testid="partner-notices">
                <h2 className="text-[16px] font-semibold text-slate-900">{s.noticesTitle}</h2>
                <p className="mt-1 text-[13.5px] leading-snug text-slate-600">{s.noticesHelp}</p>
                <div className="mt-3 space-y-2">
                  {(
                    [
                      ["whatsapp", s.byWhatsapp, view.partner.notifyWhatsapp],
                      ["email", s.byEmail, view.partner.notifyEmail],
                    ] as const
                  ).map(([key, name, on]) => (
                    <label key={key} className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px] text-slate-800">
                      <input
                        type="checkbox"
                        className="h-5 w-5 accent-blue-700"
                        checked={on}
                        disabled={key === "email" && !view.partner.hasEmail}
                        onChange={(e) => saveNotices(key === "email" ? e.target.checked : view.partner.notifyEmail, key === "whatsapp" ? e.target.checked : view.partner.notifyWhatsapp, digest)}
                      />
                      {name}
                    </label>
                  ))}
                  {!view.partner.hasEmail && <p className="text-[12.5px] text-slate-500">{s.noEmail}</p>}
                </div>
                <fieldset className="mt-4 border-t hairline pt-4" data-testid="partner-digest">
                  <legend className="text-[16px] font-semibold text-slate-900">{p.digestTitle}</legend>
                  <p className="mt-1 text-[13.5px] leading-snug text-slate-600">{p.digestHelp}</p>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {(
                      [
                        [null, p.digestOff],
                        ["whatsapp", p.digestWhatsapp],
                        ["email", p.digestEmail],
                      ] as const
                    ).map(([value, name]) => (
                      <label
                        key={String(value)}
                        className={`flex min-h-11 cursor-pointer items-center justify-center rounded-2xl px-2 text-center text-[14px] font-medium focus-within:ring-2 focus-within:ring-blue-300 ${
                          digest === value ? "bg-blue-900 text-white" : "bg-slate-50 text-slate-800 hover:bg-slate-100"
                        } ${value === "email" && !view.partner.hasEmail ? "opacity-50" : ""}`}
                      >
                        <input
                          type="radio"
                          name="digest"
                          className="sr-only"
                          checked={digest === value}
                          disabled={value === "email" && !view.partner.hasEmail}
                          onChange={() => saveNotices(view.partner.notifyEmail, view.partner.notifyWhatsapp, value)}
                        />
                        {name}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="mt-5 border-t hairline pt-4">
                  <h2 className="text-[16px] font-semibold text-slate-900">{s.logoTitle}</h2>
                  <p className="mt-1 text-[13.5px] leading-snug text-slate-600">{s.logoHelp}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[12px] font-semibold text-slate-600">{s.logoStatus[view.partner.logoStatus] ?? view.partner.logoStatus}</span>
                    <label className="pressable inline-flex h-11 cursor-pointer items-center rounded-full bg-slate-900 px-4 text-[14px] font-semibold text-white focus-within:ring-2 focus-within:ring-blue-300">
                      {s.upload}
                      <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => uploadLogo(e.target.files?.[0] ?? null)} />
                    </label>
                    {view.partner.logoStatus !== "none" && (
                      <button type="button" onClick={removeLogo} className="min-h-11 text-[14px] font-medium text-blue-700">{s.remove}</button>
                    )}
                  </div>
                </div>
                {settingsNote && <p className="mt-3 text-[13px] text-slate-600" role="status">{settingsNote}</p>}
              </section>

              {view.commissions ? (
                <section aria-labelledby="comisiones">
                  <h2 id="comisiones" className="px-1 pb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500">{c.commissionTitle}</h2>
                  <div className="card grid grid-cols-3 divide-x divide-slate-900/[0.06]">
                    {[
                      [c.owed, view.commissions.owedCents],
                      [c.paid, view.commissions.paidCents],
                      [c.balance, view.commissions.balanceCents],
                    ].map(([name, cents]) => (
                      <div key={String(name)} className="px-4 py-3.5">
                        <p className="text-[12.5px] text-slate-500">{name}</p>
                        <p className="mt-0.5 text-[20px] font-semibold tabular-nums text-slate-900">{formatCents(Number(cents))}</p>
                      </div>
                    ))}
                  </div>
                  <p className="px-1 pt-2 text-[12.5px] leading-relaxed text-slate-500">{c.commissionHelp}</p>
                </section>
              ) : (
                <p className="card px-5 py-4 text-[14px] leading-snug text-slate-600" data-testid="no-fees">{NO_FEES_LINE[locale]}</p>
              )}

              <section className="card p-5" aria-labelledby="recuerda">
                <h2 id="recuerda" className={label}>{c.rulesTitle}</h2>
                <ul className="space-y-2">
                  {partnerRules(locale, fees).map((rule) => (
                    <li key={rule} className="flex gap-2.5 text-[14px] leading-snug text-slate-700">
                      <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                      <span>{rule}</span>
                    </li>
                  ))}
                </ul>
                {fees && <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-[13.5px] leading-snug text-blue-900">«{copy.disclosureLine}»</p>}
              </section>

              {demo && <p className="px-1 text-[12.5px] text-slate-500">{s.demoNote}</p>}

              {!demo && (
                <button type="button" onClick={signOut} className="min-h-11 w-full text-center text-[14px] font-medium text-blue-700">
                  {c.signOut}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
