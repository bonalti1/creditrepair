"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getBrowserSupabase } from "@/lib/supabase/client";
import Logo from "@/components/Logo";
import LocaleToggle from "@/components/LocaleToggle";
import { BRAND } from "@/lib/brand";
import { useLocale } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/dictionaries";

// Passwordless sign-in built for people who live on their phone: a text-message
// code is the default (no email required, nothing to remember); an email link
// is the backup. Passwords are a known drop-off point for this audience.
// English first, Spanish if needed (the provider is in ./layout.tsx).

const COPY = {
  en: {
    title: "Sign in",
    lead: `${BRAND.assistant} and your report are waiting for you.`,
    demoTitle: "Demo mode",
    demoBody: "Accounts turn on once the service is set up. Meanwhile, you can explore the whole app with sample data.",
    demoCta: "Explore the demo →",
    codeError: "We couldn't send the code. Check your number and try again.",
    codeWrong: "That code isn't right or it expired. Ask for a new one.",
    linkError: "We couldn't send the link. Check your email and try again.",
    checkEmail: "📬 Check your email",
    sentLink: (email: string) => <>We sent a link to <strong>{email}</strong>. Open it on this phone to sign in.</>,
    sentCode: (phone: string) => <>We texted a code to <strong>{phone}</strong>.</>,
    verifying: "Checking…",
    enter: "Sign in",
    changeNumber: "Use a different number",
    phoneLabel: "Your cell phone number",
    sending: "Sending…",
    sendCode: "Text me the code",
    noPasswords: "No passwords. You get a 6-digit code by text message.",
    emailLabel: "Your email",
    emailPlaceholder: "you@email.com",
    sendLink: "Email me the link",
    useEmail: "I'd rather use my email",
    usePhone: "I'd rather use my phone",
  },
  es: {
    title: "Entrar",
    lead: `${BRAND.assistant} y tu reporte te esperan.`,
    demoTitle: "Modo demo",
    demoBody: "Las cuentas se activan al configurar el servicio. Mientras tanto puedes explorar toda la app con datos de ejemplo.",
    demoCta: "Explorar la demo →",
    codeError: "No pudimos enviar el código. Revisa tu número e inténtalo de nuevo.",
    codeWrong: "Ese código no es correcto o ya venció. Pide uno nuevo.",
    linkError: "No pudimos enviar el enlace. Revisa tu correo e inténtalo de nuevo.",
    checkEmail: "📬 Revisa tu correo",
    sentLink: (email: string) => <>Te enviamos un enlace a <strong>{email}</strong>. Ábrelo en este teléfono para entrar.</>,
    sentCode: (phone: string) => <>Te mandamos un código por mensaje de texto al <strong>{phone}</strong>.</>,
    verifying: "Verificando…",
    enter: "Entrar",
    changeNumber: "Cambiar número",
    phoneLabel: "Tu número de celular",
    sending: "Enviando…",
    sendCode: "Mandarme el código",
    noPasswords: "Sin contraseñas. Te llega un código de 6 números por mensaje de texto.",
    emailLabel: "Tu correo electrónico",
    emailPlaceholder: "tu@correo.com",
    sendLink: "Mandarme el enlace",
    useEmail: "Prefiero usar mi correo",
    usePhone: "Prefiero usar mi celular",
  },
} satisfies Record<Locale, Record<string, unknown>>;

function LoginForm() {
  const supabase = getBrowserSupabase();
  const { locale } = useLocale();
  const t = COPY[locale];
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/asistente";

  const [mode, setMode] = useState<"phone" | "email">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [stage, setStage] = useState<"enter" | "code" | "email-sent">("enter");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!supabase) {
    return (
      <div className="card p-6 text-[15px] text-slate-600">
        <p className="text-[17px] font-semibold text-slate-900">{t.demoTitle}</p>
        <p className="mt-1">{t.demoBody}</p>
        <Link
          href="/asistente"
          className="pressable mt-4 inline-flex h-12 items-center rounded-full bg-amber-400 px-6 font-semibold text-blue-900 hover:bg-amber-500"
        >
          {t.demoCta}
        </Link>
      </div>
    );
  }

  // US numbers: accept "(713) 555-1234" style input, send E.164.
  const e164 = () => {
    const digits = phone.replace(/\D/g, "");
    return digits.length === 10 ? `+1${digits}` : `+${digits}`;
  };

  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithOtp({ phone: e164() });
    setBusy(false);
    if (err) setError(t.codeError);
    else setStage("code");
  };

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.auth.verifyOtp({ phone: e164(), token: code, type: "sms" });
    setBusy(false);
    if (err || !data.user) {
      setError(t.codeWrong);
      return;
    }
    router.push(await landing(data.user.id, e164()));
  };

  // Where to go once signed in. A member of the team (asked of the server,
  // from their own staff record) goes to the console and gets no client
  // profile; everyone else gets their profile (phone on file) and goes on.
  const landing = async (userId: string, phoneE164: string | null): Promise<string> => {
    try {
      const res = await fetch("/api/staff/me", { cache: "no-store" });
      const me = (await res.json()) as { staff?: boolean };
      if (me.staff) return next.startsWith("/equipo") ? next : "/equipo";
    } catch {
      // Not known: the client app, where the staff console's own check still applies.
    }
    // A referral partner (or someone whose application is pending) goes to the partner portal and gets no client profile.
    try {
      const res = await fetch("/api/partners/me", { cache: "no-store" });
      const me = (await res.json()) as { partner?: boolean; applied?: boolean };
      if (me.partner || me.applied) return "/socios/portal";
    } catch {
      // Not known: carry on as a client.
    }
    // A new profile starts in the language the client is reading right now (their messages go out in it);
    // an existing one keeps its own, which the language provider reconciles with this device's choice.
    const { data: existing } = await supabase.from("profiles").select("id").eq("id", userId).maybeSingle();
    await supabase
      .from("profiles")
      .upsert({ id: userId, ...(phoneE164 ? { phone_e164: phoneE164 } : {}), ...(existing ? {} : { locale }) }, { onConflict: "id" });
    return next;
  };

  const sendEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    setBusy(false);
    if (err) setError(t.linkError);
    else setStage("email-sent");
  };

  if (stage === "email-sent") {
    return (
      <div className="rounded-2xl border border-green-200 bg-green-50 p-5 text-green-900">
        <p className="text-lg font-semibold">{t.checkEmail}</p>
        <p className="mt-1 text-sm">{t.sentLink(email)}</p>
      </div>
    );
  }

  if (stage === "code") {
    return (
      <form onSubmit={verifyCode} className="space-y-4">
        <p className="text-slate-700">{t.sentCode(phone)}</p>
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="123456"
          className="h-16 w-full rounded-2xl bg-slate-100 px-4 text-center text-3xl tracking-[0.4em] outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-blue-300"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy || code.length < 6}
          className="pressable h-14 w-full rounded-full bg-amber-400 text-[17px] font-semibold text-blue-900 hover:bg-amber-500 disabled:bg-slate-200 disabled:text-slate-500"
        >
          {busy ? t.verifying : t.enter}
        </button>
        <button type="button" onClick={() => setStage("enter")} className="w-full text-sm text-slate-500 underline">
          {t.changeNumber}
        </button>
      </form>
    );
  }

  return (
    <div>
      {mode === "phone" ? (
        <form onSubmit={sendCode} className="space-y-4">
          <label className="block font-semibold text-slate-700">
            {t.phoneLabel}
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(713) 555-1234"
              className="mt-2 h-14 w-full rounded-2xl bg-slate-100 px-4 text-xl font-normal outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-blue-300"
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={busy || phone.replace(/\D/g, "").length < 10}
            className="pressable h-14 w-full rounded-full bg-amber-400 text-[17px] font-semibold text-blue-900 hover:bg-amber-500 disabled:bg-slate-200 disabled:text-slate-500"
          >
            {busy ? t.sending : t.sendCode}
          </button>
          <p className="text-sm text-slate-500">{t.noPasswords}</p>
        </form>
      ) : (
        <form onSubmit={sendEmail} className="space-y-4">
          <label className="block font-semibold text-slate-700">
            {t.emailLabel}
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t.emailPlaceholder}
              className="mt-2 h-14 w-full rounded-2xl bg-slate-100 px-4 text-xl font-normal outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-blue-300"
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={busy || !email}
            className="pressable h-14 w-full rounded-full bg-amber-400 text-[17px] font-semibold text-blue-900 hover:bg-amber-500 disabled:bg-slate-200 disabled:text-slate-500"
          >
            {busy ? t.sending : t.sendLink}
          </button>
        </form>
      )}
      <button
        type="button"
        onClick={() => {
          setMode(mode === "phone" ? "email" : "phone");
          setError(null);
        }}
        className="mt-5 w-full text-sm text-slate-500 underline"
      >
        {mode === "phone" ? t.useEmail : t.usePhone}
      </button>
    </div>
  );
}

export default function Login() {
  const { locale } = useLocale();
  const t = COPY[locale];
  return (
    <main className="mx-auto max-w-md px-6 py-14">
      <div className="flex items-center justify-between gap-3">
        <Link href="/" aria-label={BRAND.name}>
          <Logo size={32} priority />
        </Link>
        <LocaleToggle />
      </div>
      <h1 className="mt-10 font-display text-[34px] font-bold leading-tight text-blue-700">{t.title}</h1>
      <p className="mt-2 text-[17px] text-slate-500">{t.lead}</p>
      <div className="mt-6">
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
