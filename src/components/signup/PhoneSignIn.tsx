"use client";

import { useEffect, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/client";

// Sign in by phone, inside the chat: the same passwordless code as /login
// (Supabase Auth's phone code; text messages are used only for login codes,
// never for follow-ups), and the same profile the login page writes (the
// phone on file; the language for a new profile). A member of the team is
// sent to the console instead.

const COPY = {
  en: {
    phone: "Your cell phone number",
    send: "Text me the code",
    sending: "Sending…",
    sent: (p: string) => `We texted a code to ${p}.`,
    code: "The 6-digit code",
    verify: "Sign in",
    verifying: "Checking…",
    change: "Use a different number",
    codeError: "We couldn't send the code. Check your number and try again.",
    codeWrong: "That code isn't right or it expired. Ask for a new one.",
    already: "You're already signed in on this device.",
    continue: "Continue",
    note: "No passwords. Only a code to sign in; we never send offers by text.",
  },
  es: {
    phone: "Tu número de celular",
    send: "Mandarme el código",
    sending: "Enviando…",
    sent: (p: string) => `Te mandamos un código al ${p}.`,
    code: "El código de 6 números",
    verify: "Entrar",
    verifying: "Verificando…",
    change: "Cambiar número",
    codeError: "No pudimos enviar el código. Revisa tu número e inténtalo de nuevo.",
    codeWrong: "Ese código no es correcto o ya venció. Pide uno nuevo.",
    already: "Ya entraste en este dispositivo.",
    continue: "Continuar",
    note: "Sin contraseñas. Solo un código para entrar; nunca mandamos ofertas por mensaje de texto.",
  },
} as const;

const toE164 = (phone: string) => {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
};

export default function PhoneSignIn({ locale, onSignedIn }: { locale: "en" | "es"; onSignedIn: (userId: string) => void }) {
  const t = COPY[locale];
  const supabase = getBrowserSupabase();
  const [stage, setStage] = useState<"checking" | "already" | "phone" | "code">("checking");
  const [userId, setUserId] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (data.user) {
          setUserId(data.user.id);
          setStage("already");
        } else setStage("phone");
      })
      .catch(() => setStage("phone"));
  }, [supabase]);

  if (!supabase || stage === "checking") return null;

  if (stage === "already" && userId) {
    return (
      <div className="space-y-3">
        <p className="text-[15px] text-slate-700">{t.already}</p>
        <button type="button" onClick={() => onSignedIn(userId)} className="pressable h-12 w-full rounded-full bg-amber-400 text-[16px] font-semibold text-blue-900 hover:bg-amber-500">
          {t.continue}
        </button>
      </div>
    );
  }

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithOtp({ phone: toE164(phone) });
    setBusy(false);
    if (err) setError(t.codeError);
    else setStage("code");
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const e164 = toE164(phone);
    const { data, error: err } = await supabase.auth.verifyOtp({ phone: e164, token: code, type: "sms" });
    if (err || !data.user) {
      setBusy(false);
      setError(t.codeWrong);
      return;
    }
    // A member of the team signs in at the console, not as a client.
    try {
      const me = (await (await fetch("/api/staff/me", { cache: "no-store" })).json()) as { staff?: boolean };
      if (me.staff) {
        window.location.href = "/equipo";
        return;
      }
    } catch {
      // Not known: carry on as a client.
    }
    const { data: existing } = await supabase.from("profiles").select("id").eq("id", data.user.id).maybeSingle();
    await supabase.from("profiles").upsert({ id: data.user.id, phone_e164: e164, ...(existing ? {} : { locale }) }, { onConflict: "id" });
    setBusy(false);
    onSignedIn(data.user.id);
  };

  if (stage === "code") {
    return (
      <form onSubmit={verify} className="space-y-3" data-testid="signup-code">
        <p className="text-[15px] text-slate-700">{t.sent(phone)}</p>
        <label className="block text-[14px] font-medium text-slate-700">
          {t.code}
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="mt-1.5 h-14 w-full rounded-2xl bg-white px-4 text-center text-2xl tracking-[0.4em] shadow-[0_0_0_1px_rgba(0,0,0,0.1)] outline-none focus:ring-2 focus:ring-blue-300"
          />
        </label>
        {error && (
          <p role="alert" className="text-[14px] text-red-700">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy || code.length < 6} className="pressable h-12 w-full rounded-full bg-amber-400 text-[16px] font-semibold text-blue-900 hover:bg-amber-500 disabled:bg-slate-200 disabled:text-slate-500">
          {busy ? t.verifying : t.verify}
        </button>
        <button type="button" onClick={() => setStage("phone")} className="w-full py-2 text-[14px] text-slate-600 underline">
          {t.change}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={send} className="space-y-3" data-testid="signup-phone">
      <label className="block text-[14px] font-medium text-slate-700">
        {t.phone}
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="(713) 555-1234"
          className="mt-1.5 h-12 w-full rounded-2xl bg-white px-4 text-[17px] shadow-[0_0_0_1px_rgba(0,0,0,0.1)] outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-blue-300"
        />
      </label>
      {error && (
        <p role="alert" className="text-[14px] text-red-700">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy || phone.replace(/\D/g, "").length < 10} className="pressable h-12 w-full rounded-full bg-amber-400 text-[16px] font-semibold text-blue-900 hover:bg-amber-500 disabled:bg-slate-200 disabled:text-slate-500">
        {busy ? t.sending : t.send}
      </button>
      <p className="text-[13px] leading-snug text-slate-500">{t.note}</p>
    </form>
  );
}
