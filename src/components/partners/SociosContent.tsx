"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/i18n";
import { partnerRules, PARTNER_COPY } from "@/lib/partners/copy";
import { demoApply, demoProgram } from "@/lib/partners/data";
import { NO_FEES_LINE } from "@/lib/partners/program";
import { checkPartnerApplication, PARTNER_KIND_LABEL, PARTNER_KINDS, type PartnerApplicationField } from "@/lib/partners/rules";
import { isDemoMode } from "@/lib/supabase/config";
import { ALL_STATES } from "@/lib/compliance/states";
import Icon from "@/components/Icon";
import LocaleToggle from "@/components/LocaleToggle";
import Logo from "@/components/Logo";

// /socios: what the partner program is, its rules, and the application. Every
// string is in src/lib/partners/copy.ts (ES and EN, checked by the claim rules).
// While "Comisiones a socios" is off (program.ts), the rules and the box below
// them say the program pays no referral fees instead of how to disclose one.

const field =
  "h-12 w-full rounded-2xl bg-white px-4 text-[16px] text-slate-900 shadow-[0_0_0_1px_rgba(0,0,0,0.1)] outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-blue-300";
const label = "block pb-1.5 text-[13px] font-semibold uppercase tracking-wide text-slate-500";
const STATES = ["TX", ...ALL_STATES.filter((s) => s !== "TX")];

export default function SociosContent() {
  const { locale } = useLocale();
  const copy = PARTNER_COPY[locale];
  const c = copy.signup;
  const [form, setForm] = useState({ name: "", company: "", kind: "", phone: "", email: "", state: "TX", website: "" });
  const [accepts, setAccepts] = useState(false);
  const [problems, setProblems] = useState<Partial<Record<PartnerApplicationField, "required" | "invalid">>>({});
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const demo = isDemoMode();
  const [fees, setFees] = useState(false);
  useEffect(() => {
    if (demo) return setFees(demoProgram().commissionsEnabled);
    fetch("/api/partners/public")
      .then((r) => r.json() as Promise<{ commissionsEnabled?: boolean }>)
      .then((b) => setFees(b.commissionsEnabled === true))
      .catch(() => undefined);
  }, [demo]);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [key]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const input = { ...form, acceptsTerms: accepts };
    const check = checkPartnerApplication(input);
    if (!check.ok) {
      setProblems(check.problems);
      return;
    }
    setProblems({});
    setStatus("sending");
    if (demo) {
      demoApply({
        id: `p-demo-${Date.now()}`,
        ...check.value,
        status: "pending",
        referralCode: null,
        salesperson: null,
        commissionBasis: "none",
        commissionCents: 0,
        commissionNote: null,
        appliedAt: new Date().toISOString(),
        decidedAt: null,
      });
      setStatus("done");
      return;
    }
    try {
      const res = await fetch("/api/partners/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, locale }) });
      setStatus(res.ok ? "done" : "error");
    } catch {
      setStatus("error");
    }
  };

  const problem = (key: PartnerApplicationField) =>
    problems[key] ? (
      <p className="mt-1.5 text-[13px] text-red-600" role="alert">
        {c.problems[problems[key]!]}
      </p>
    ) : null;

  return (
    <main className="min-h-dvh bg-slate-50">
      <section className="bg-gradient-to-b from-blue-800 to-blue-900 px-4 pb-12 pt-5 text-white sm:px-6">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center justify-between gap-3">
            <Link href="/" aria-label="Inicio">
              <Logo size={28} tone="dark" priority />
            </Link>
            <LocaleToggle tone="dark" />
          </div>
          <p className="mt-9 text-[13px] font-semibold uppercase tracking-wide text-blue-200">{c.eyebrow}</p>
          <h1 className="mt-2 font-display text-[32px] font-bold leading-[1.1] sm:text-[44px]">{c.title}</h1>
          <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-blue-100">{c.lead}</p>
          <a href="#solicitud" className="pressable mt-7 inline-flex h-13 items-center rounded-full bg-amber-400 px-7 py-3.5 text-[16px] font-semibold text-blue-900 hover:bg-amber-300">
            {c.formTitle}
          </a>
        </div>
      </section>

      <div className="mx-auto max-w-3xl space-y-8 px-4 py-10 sm:px-6">
        <section aria-labelledby="como">
          <h2 id="como" className="font-display text-[24px] font-bold text-blue-700">{c.stepsTitle}</h2>
          <ol className="mt-4 grid gap-3 sm:grid-cols-3">
            {c.steps.map((s, i) => (
              <li key={s.title} className="card p-5">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-[14px] font-semibold text-blue-700">{i + 1}</span>
                <p className="mt-3 font-semibold text-slate-900">{s.title}</p>
                <p className="mt-1 text-[14px] leading-snug text-slate-600">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="reglas" className="card p-5 sm:p-6">
          <h2 id="reglas" className="font-display text-[22px] font-bold text-blue-700">{c.rulesTitle}</h2>
          <ul className="mt-3 space-y-2.5">
            {partnerRules(locale, fees).map((rule) => (
              <li key={rule} className="flex gap-2.5 text-[15px] leading-snug text-slate-700">
                <Icon name="check" size={18} className="mt-0.5 shrink-0 text-green-700" />
                <span>{rule}</span>
              </li>
            ))}
          </ul>
          {fees ? (
            <div className="mt-5 rounded-2xl bg-amber-50 px-4 py-3.5">
              <p className="text-[13px] font-semibold uppercase tracking-wide text-blue-900">{c.disclosureTitle}</p>
              <p className="mt-1 text-[14px] leading-snug text-blue-900">
                {c.disclosure} <strong>«{copy.disclosureLine}»</strong>
              </p>
            </div>
          ) : (
            <p className="mt-5 rounded-2xl bg-slate-50 px-4 py-3.5 text-[14px] leading-snug text-slate-700">{NO_FEES_LINE[locale]}</p>
          )}
        </section>

        <section id="solicitud" aria-labelledby="form-title" className="card scroll-mt-6 p-5 sm:p-6">
          {status === "done" ? (
            <div role="status" data-testid="partner-applied">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-green-50 text-green-700">
                <Icon name="check" size={20} />
              </span>
              <h2 className="mt-3 font-display text-[22px] font-bold text-blue-700">{c.doneTitle}</h2>
              <p className="mt-1.5 text-[15px] leading-relaxed text-slate-600">{c.doneBody}</p>
              {demo && <p className="mt-3 text-[13px] text-slate-500">{c.demoNote}</p>}
            </div>
          ) : (
            <form onSubmit={submit} noValidate>
              <h2 id="form-title" className="font-display text-[22px] font-bold text-blue-700">{c.formTitle}</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className={label} htmlFor="p-name">{c.name}</label>
                  <input id="p-name" className={field} value={form.name} onChange={set("name")} autoComplete="name" />
                  {problem("name")}
                </div>
                <div>
                  <label className={label} htmlFor="p-kind">{c.kind}</label>
                  <select id="p-kind" className={field} value={form.kind} onChange={set("kind")}>
                    <option value="" disabled>—</option>
                    {PARTNER_KINDS.map((k) => (
                      <option key={k} value={k}>{PARTNER_KIND_LABEL[locale][k]}</option>
                    ))}
                  </select>
                  {problem("kind")}
                </div>
                <div>
                  <label className={label} htmlFor="p-company">
                    {c.company} <span className="font-normal normal-case tracking-normal">({c.optional})</span>
                  </label>
                  <input id="p-company" className={field} value={form.company} onChange={set("company")} autoComplete="organization" />
                  {problem("company")}
                </div>
                <div>
                  <label className={label} htmlFor="p-phone">{c.phone}</label>
                  <input id="p-phone" className={field} value={form.phone} onChange={set("phone")} inputMode="tel" autoComplete="tel" placeholder="(713) 555-1234" />
                  {problem("phone")}
                </div>
                <div>
                  <label className={label} htmlFor="p-email">
                    {c.email} <span className="font-normal normal-case tracking-normal">({c.optional})</span>
                  </label>
                  <input id="p-email" className={field} value={form.email} onChange={set("email")} inputMode="email" autoComplete="email" />
                  {problem("email")}
                </div>
                <div>
                  <label className={label} htmlFor="p-state">{c.state}</label>
                  <select id="p-state" className={field} value={form.state} onChange={set("state")}>
                    {STATES.map((s) => (
                      <option key={s} value={s}>{s === "TX" ? "Texas (TX)" : s}</option>
                    ))}
                  </select>
                </div>
                {/* Left empty by people; bots fill it. */}
                <input type="text" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" value={form.website} onChange={set("website")} name="website" />
              </div>
              <label className="mt-5 flex cursor-pointer items-start gap-3 text-[15px] leading-snug text-slate-700">
                <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-blue-700" checked={accepts} onChange={(e) => setAccepts(e.target.checked)} />
                <span>{c.accept}</span>
              </label>
              {problem("acceptsTerms")}
              <button
                type="submit"
                disabled={status === "sending"}
                className="pressable mt-5 flex h-13 w-full items-center justify-center rounded-full bg-amber-400 py-3.5 text-[17px] font-semibold text-blue-900 hover:bg-amber-500 disabled:bg-slate-200"
              >
                {status === "sending" ? c.sending : c.submit}
              </button>
              {status === "error" && <p className="mt-3 text-[14px] text-red-600" role="alert">{c.error}</p>}
            </form>
          )}
        </section>

        <p className="pb-6 text-center text-[14px]">
          <Link href="/socios/portal" className="font-medium text-blue-700 underline-offset-2 hover:underline">
            {c.portalLink}
          </Link>
        </p>
      </div>
    </main>
  );
}
