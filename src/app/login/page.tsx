"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getBrowserSupabase } from "@/lib/supabase/client";
import Logo from "@/components/Logo";
import { BRAND } from "@/lib/brand";

// Passwordless sign-in built for people who live on their phone: a text-message
// code is the default (no email required, nothing to remember); an email link
// is the backup. Passwords are a known drop-off point for this audience.

function LoginForm() {
  const supabase = getBrowserSupabase();
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
        <p className="text-[17px] font-semibold text-slate-900">Modo demo</p>
        <p className="mt-1">
          Las cuentas se activan al configurar el servicio. Mientras tanto puedes explorar toda la app
          con datos de ejemplo.
        </p>
        <Link
          href="/asistente"
          className="pressable mt-4 inline-flex h-12 items-center rounded-full bg-amber-400 px-6 font-semibold text-blue-900 hover:bg-amber-500"
        >
          Explorar la demo →
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
    if (err) setError("No pudimos enviar el código. Revisa tu número e inténtalo de nuevo.");
    else setStage("code");
  };

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.auth.verifyOtp({ phone: e164(), token: code, type: "sms" });
    setBusy(false);
    if (err || !data.user) {
      setError("Ese código no es correcto o ya venció. Pide uno nuevo.");
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
    await supabase.from("profiles").upsert({ id: userId, ...(phoneE164 ? { phone_e164: phoneE164 } : {}) }, { onConflict: "id" });
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
    if (err) setError("No pudimos enviar el enlace. Revisa tu correo e inténtalo de nuevo.");
    else setStage("email-sent");
  };

  if (stage === "email-sent") {
    return (
      <div className="rounded-2xl border border-green-200 bg-green-50 p-5 text-green-900">
        <p className="text-lg font-semibold">📬 Revisa tu correo</p>
        <p className="mt-1 text-sm">
          Te enviamos un enlace a <strong>{email}</strong>. Ábrelo en este teléfono para entrar.
        </p>
      </div>
    );
  }

  if (stage === "code") {
    return (
      <form onSubmit={verifyCode} className="space-y-4">
        <p className="text-slate-700">
          Te mandamos un código por mensaje de texto al <strong>{phone}</strong>.
        </p>
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
          {busy ? "Verificando…" : "Entrar"}
        </button>
        <button type="button" onClick={() => setStage("enter")} className="w-full text-sm text-slate-500 underline">
          Cambiar número
        </button>
      </form>
    );
  }

  return (
    <div>
      {mode === "phone" ? (
        <form onSubmit={sendCode} className="space-y-4">
          <label className="block font-semibold text-slate-700">
            Tu número de celular
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
            {busy ? "Enviando…" : "Mandarme el código"}
          </button>
          <p className="text-sm text-slate-500">
            Sin contraseñas. Te llega un código de 6 números por mensaje de texto.
          </p>
        </form>
      ) : (
        <form onSubmit={sendEmail} className="space-y-4">
          <label className="block font-semibold text-slate-700">
            Tu correo electrónico
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@correo.com"
              className="mt-2 h-14 w-full rounded-2xl bg-slate-100 px-4 text-xl font-normal outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-blue-300"
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={busy || !email}
            className="pressable h-14 w-full rounded-full bg-amber-400 text-[17px] font-semibold text-blue-900 hover:bg-amber-500 disabled:bg-slate-200 disabled:text-slate-500"
          >
            {busy ? "Enviando…" : "Mandarme el enlace"}
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
        {mode === "phone" ? "Prefiero usar mi correo" : "Prefiero usar mi celular"}
      </button>
    </div>
  );
}

export default function Login() {
  return (
    <main className="mx-auto max-w-md px-6 py-14">
      <Link href="/" aria-label={BRAND.name}>
        <Logo size={32} priority />
      </Link>
      <h1 className="mt-10 font-display text-[34px] font-bold leading-tight text-blue-700">Entrar</h1>
      <p className="mt-2 text-[17px] text-slate-500">{BRAND.assistant} y tu reporte te esperan.</p>
      <div className="mt-6">
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
