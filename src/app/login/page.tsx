"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getBrowserSupabase } from "@/lib/supabase/client";

// Passwordless sign-in (email magic link). Passwords are a known drop-off
// point for our audience; one email tap gets them back in.

function LoginForm() {
  const supabase = getBrowserSupabase();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!supabase) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
        <p className="font-semibold">Modo demo</p>
        <p className="mt-1">
          Las cuentas se activan al configurar Supabase. Mientras tanto puedes explorar toda la app
          con datos de ejemplo.
        </p>
        <Link
          href="/dashboard"
          className="mt-3 inline-block rounded-lg bg-blue-700 px-5 py-2.5 font-semibold text-white hover:bg-blue-800"
        >
          Explorar la demo →
        </Link>
      </div>
    );
  }

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const next = params.get("next") ?? "/dashboard";
    const { error: err } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    setBusy(false);
    if (err) setError(err.message);
    else setSent(true);
  };

  if (sent) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-5 text-sm text-green-900">
        <p className="font-semibold">📬 Revisa tu correo</p>
        <p className="mt-1">
          Te enviamos un enlace a <strong>{email}</strong>. Ábrelo en este dispositivo para entrar —
          sin contraseñas.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={send} className="space-y-4">
      <label className="block text-sm font-semibold text-slate-700">
        Tu correo electrónico
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tu@correo.com"
          className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-500"
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={busy || !email}
        className="w-full rounded-lg bg-blue-700 px-5 py-3 font-semibold text-white hover:bg-blue-800 disabled:bg-slate-300"
      >
        {busy ? "Enviando…" : "Enviarme el enlace de acceso"}
      </button>
      <p className="text-xs text-slate-500">
        Sin contraseñas: te enviamos un enlace seguro a tu correo cada vez que entras.
      </p>
    </form>
  );
}

export default function Login() {
  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <Link href="/" className="font-bold text-blue-700">
        Bonalti Crédito
      </Link>
      <h1 className="mt-6 text-2xl font-bold">Entrar</h1>
      <p className="mt-1 text-sm text-slate-600">Tu progreso, tus rondas y tus cartas te esperan.</p>
      <div className="mt-6">
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
