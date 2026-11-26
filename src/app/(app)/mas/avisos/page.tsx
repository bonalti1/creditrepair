"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { useLocale } from "@/lib/i18n";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { DEFAULT_NOTIFICATION_SETTINGS, NOTIFICATION_COPY, settingsProblem, type NotificationSettings } from "@/lib/fulfillment/notifications";

// "Avisos" / "Notifications" (Más → Avisos): how Credalti writes to the
// client. WhatsApp and/or email, the language of our messages, progress
// updates and reminders on or off, and "Stop all automatic messages" (the
// same record as replying STOP). Notices about their money and the letters
// mailed in their name always go while they get automatic messages
// (fulfillment/notifications.ts; docs/FULFILLMENT.md "Messages").
//
// Demo: the choices are kept in this browser only, and the screen says so.

const DEMO_KEY = "credalti.clientDemo.notifications.v1";

interface State {
  settings: NotificationSettings;
  optedOutAt: string | null;
  hasEmail: boolean;
}

function readDemo(): State {
  try {
    const raw = JSON.parse(window.localStorage.getItem(DEMO_KEY) ?? "null") as State | null;
    if (raw?.settings) return raw;
  } catch {
    // ignore
  }
  return { settings: DEFAULT_NOTIFICATION_SETTINGS, optedOutAt: null, hasEmail: true };
}

function writeDemo(state: State) {
  try {
    window.localStorage.setItem(DEMO_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable: the choice lasts for this visit.
  }
}

function Switch({ on, onChange, label, desc, disabled, testId }: { on: boolean; onChange: (v: boolean) => void; label: string; desc: string; disabled?: boolean; testId: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      data-testid={testId}
      className="pressable flex w-full items-center gap-3.5 border-t hairline px-4 py-3.5 text-left first:border-t-0 hover:bg-slate-50 disabled:opacity-50"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[17px] font-medium text-slate-900">{label}</span>
        <span className="block text-[13px] leading-snug text-slate-500">{desc}</span>
      </span>
      <span aria-hidden="true" className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${on ? "bg-blue-700" : "bg-slate-300"}`}>
        <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

export default function AvisosPage() {
  const { locale, setLocale } = useLocale();
  const c = NOTIFICATION_COPY[locale];
  const demo = !isSupabaseConfigured();
  const [state, setState] = useState<State | null>(null);
  const [draft, setDraft] = useState<NotificationSettings | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error" | "signin">("idle");

  const load = useCallback(async () => {
    if (demo) {
      const s = readDemo();
      setState(s);
      setDraft(s.settings);
      return;
    }
    const res = await fetch("/api/notifications", { cache: "no-store" }).catch(() => null);
    if (res?.status === 401) return setStatus("signin");
    if (!res?.ok) return setStatus("error");
    const body = (await res.json()) as { settings: NotificationSettings; optedOutAt: string | null; hasEmail: boolean };
    setState(body);
    setDraft(body.settings);
  }, [demo]);

  useEffect(() => {
    void load();
  }, [load]);

  const post = async (payload: Record<string, unknown>): Promise<boolean> => {
    const res = await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).catch(() => null);
    return Boolean(res?.ok);
  };

  const save = async () => {
    if (!draft || !state || settingsProblem(draft)) return;
    setStatus("saving");
    const next = { ...draft, updatedAt: new Date().toISOString(), updatedBy: "client" as const };
    if (demo) {
      writeDemo({ ...state, settings: next });
    } else if (!(await post({ action: "save", whatsapp: draft.whatsapp, email: draft.email, reminders: draft.reminders, updates: draft.updates }))) {
      return setStatus("error");
    }
    setState({ ...state, settings: next });
    setStatus("saved");
  };

  const stopOrStart = async (stop: boolean) => {
    if (!state) return;
    setStatus("saving");
    const optedOutAt = stop ? new Date().toISOString() : null;
    if (demo) writeDemo({ ...state, optedOutAt });
    else if (!(await post({ action: stop ? "stop_all" : "start_again" }))) return setStatus("error");
    setState({ ...state, optedOutAt });
    setStatus("idle");
  };

  const when = (iso: string) => new Date(iso).toLocaleDateString(locale === "es" ? "es-MX" : "en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Chicago" });
  const dirty = Boolean(draft && state && JSON.stringify([draft.whatsapp, draft.email, draft.reminders, draft.updates]) !== JSON.stringify([state.settings.whatsapp, state.settings.email, state.settings.reminders, state.settings.updates]));
  const problem = draft ? settingsProblem(draft) : null;

  return (
    <main className="animate-rise space-y-6" data-testid="notification-settings">
      <div>
        <Link href="/mas" className="inline-flex min-h-11 items-center gap-1 px-1 text-[15px] font-medium text-blue-700">
          <Icon name="chevron" size={16} className="rotate-180" />
          {locale === "es" ? "Más" : "More"}
        </Link>
        <h1 className="px-1 font-display text-[34px] font-bold leading-tight text-blue-700">{c.title}</h1>
        <p className="mt-1 px-1 text-[15px] leading-relaxed text-slate-600">{c.lead}</p>
        {demo && <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-[14px] text-blue-900">{c.demo}</p>}
      </div>

      {status === "signin" && <p className="card px-4 py-4 text-[15px] text-slate-700">{c.signIn}</p>}

      {state && draft && (
        <>
          {state.optedOutAt ? (
            <section className="card px-4 py-4" data-testid="opted-out">
              <p className="text-[15px] leading-relaxed text-slate-800">{c.stopped(when(state.optedOutAt))}</p>
              <p className="mt-1 text-[13px] leading-snug text-slate-500">{c.stopAllDesc}</p>
              <button type="button" onClick={() => void stopOrStart(false)} className="pressable mt-3 flex h-12 w-full items-center justify-center rounded-full bg-amber-400 text-[16px] font-semibold text-blue-900">
                {c.startAgain}
              </button>
            </section>
          ) : (
            <>
              <section>
                <h2 className="px-1 pb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500">{c.channels}</h2>
                <div className="card overflow-hidden">
                  <Switch testId="switch-whatsapp" on={draft.whatsapp} onChange={(v) => setDraft({ ...draft, whatsapp: v })} label={c.whatsapp} desc={c.whatsappDesc} />
                  <Switch testId="switch-email" on={draft.email} onChange={(v) => setDraft({ ...draft, email: v })} label={c.email} desc={state.hasEmail ? c.emailDesc : c.noEmail} />
                </div>
                {problem && (
                  <p role="alert" className="px-1 pt-2 text-[14px] leading-snug text-red-700">
                    {c.atLeastOne}
                  </p>
                )}
              </section>

              <section>
                <h2 className="px-1 pb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500">{c.what}</h2>
                <div className="card overflow-hidden">
                  <div className="flex items-center gap-3.5 px-4 py-3.5">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[17px] font-medium text-slate-900">{c.required}</span>
                      <span className="block text-[13px] leading-snug text-slate-500">{c.requiredDesc}</span>
                    </span>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[12px] font-semibold text-slate-600">{c.requiredOn}</span>
                  </div>
                  <Switch testId="switch-updates" on={draft.updates} onChange={(v) => setDraft({ ...draft, updates: v })} label={c.updates} desc={c.updatesDesc} />
                  <Switch testId="switch-reminders" on={draft.reminders} onChange={(v) => setDraft({ ...draft, reminders: v })} label={c.reminders} desc={c.remindersDesc} />
                </div>
              </section>

              <div className="px-1">
                <button
                  type="button"
                  disabled={!dirty || Boolean(problem) || status === "saving"}
                  onClick={() => void save()}
                  data-testid="save-notifications"
                  className="pressable flex h-12 w-full items-center justify-center rounded-full bg-amber-400 text-[16px] font-semibold text-blue-900 disabled:opacity-50"
                >
                  {status === "saving" ? c.saving : c.save}
                </button>
                {status === "saved" && !dirty && (
                  <p role="status" className="pt-2 text-center text-[14px] text-green-700">
                    {c.saved}
                  </p>
                )}
                {status === "error" && (
                  <p role="alert" className="pt-2 text-center text-[14px] text-red-700">
                    {c.error}
                  </p>
                )}
              </div>
            </>
          )}

          <section>
            <h2 className="px-1 pb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500">{c.language}</h2>
            <div className="card flex gap-2 p-2" role="group" aria-label={c.language}>
              {(["en", "es"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  aria-pressed={locale === l}
                  onClick={() => setLocale(l)}
                  className={`pressable h-11 flex-1 rounded-xl text-[15px] font-semibold ${locale === l ? "bg-blue-900 text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`}
                >
                  {l === "en" ? "English" : "Español"}
                </button>
              ))}
            </div>
          </section>

          {!state.optedOutAt && (
            <section className="card px-4 py-4">
              <p className="text-[17px] font-medium text-slate-900">{c.stopAll}</p>
              <p className="mt-1 text-[13px] leading-snug text-slate-500">{c.stopAllDesc}</p>
              <button type="button" onClick={() => void stopOrStart(true)} data-testid="stop-all" className="pressable mt-3 flex h-11 w-full items-center justify-center rounded-full bg-slate-100 text-[15px] font-medium text-slate-900 hover:bg-slate-200">
                {c.stopAllButton}
              </button>
            </section>
          )}

          <ul className="space-y-1 px-1 text-[13px] leading-relaxed text-slate-500">
            <li>{c.neverSms}</li>
            <li>{c.quiet}</li>
          </ul>
        </>
      )}
    </main>
  );
}
