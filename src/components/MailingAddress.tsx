"use client";

import { useEffect, useState } from "react";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { useLocale } from "@/lib/i18n";
import { fetchClientReport, forgetClientCase } from "@/lib/ux/caseApi";
import Icon from "@/components/Icon";

// The client's mailing address: the return address on every letter (the
// letters are theirs) and the one the bureaus match their file against. Only
// the client writes it (POST /api/profile/address); the team never types it,
// and a round waits until it is on file. Shown only with a real account: the
// demo's letters carry placeholders.

const COPY = {
  es: {
    title: "Tu dirección postal",
    why: "Va como remitente en cada carta y es la que los burós buscan en tu expediente. Escríbela como aparece en tu correo.",
    line1: "Calle y número",
    line2: "Apartamento o unidad (opcional)",
    city: "Ciudad",
    state: "Estado",
    zip: "Código postal",
    save: "Guardar mi dirección",
    saving: "Guardando…",
    saved: "Guardada.",
    change: "Cambiar",
    missing: "Falta tu dirección: tus cartas no pueden salir sin ella.",
    error: "No pudimos leer esa dirección. Revisa la calle, la ciudad, el estado y el código postal.",
  },
  en: {
    title: "Your mailing address",
    why: "It is the return address on every letter and the one the bureaus look for in your file. Write it as it appears on your mail.",
    line1: "Street and number",
    line2: "Apartment or unit (optional)",
    city: "City",
    state: "State",
    zip: "ZIP code",
    save: "Save my address",
    saving: "Saving…",
    saved: "Saved.",
    change: "Change",
    missing: "Your address is missing: your letters cannot go out without it.",
    error: "We could not read that address. Check the street, city, state and ZIP code.",
  },
} as const;

const FIELD = "h-12 w-full rounded-xl bg-slate-100 px-3.5 text-[16px] outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-blue-300";

export default function MailingAddress() {
  const live = isSupabaseConfigured();
  const { locale } = useLocale();
  const c = COPY[locale === "en" ? "en" : "es"];
  const [current, setCurrent] = useState<string[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ line1: "", line2: "", city: "", state: "TX", zip: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!live) return;
    fetchClientReport()
      .then((answer) => setCurrent(answer.authenticated ? answer.profile.addressLines : []))
      .catch(() => setCurrent([]));
  }, [live]);

  if (!live || current === null) return null;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/profile/address", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, line2: form.line2.trim() || null }),
      });
      const body = (await res.json().catch(() => ({}))) as { addressLines?: string[] };
      if (!res.ok || !body.addressLines) throw new Error("invalid");
      forgetClientCase();
      setCurrent(body.addressLines);
      setEditing(false);
      setNote(c.saved);
    } catch {
      setError(c.error);
    } finally {
      setBusy(false);
    }
  };

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });

  return (
    <section className="card px-5 py-5" data-testid="mailing-address">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
          <Icon name="mail" size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-semibold text-slate-900">{c.title}</h2>
          <p className="mt-1 text-[14px] leading-snug text-slate-500">{c.why}</p>
        </div>
      </div>

      {!editing && current.length > 0 && (
        <div className="mt-4 flex items-start justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3">
          <address className="text-[15px] not-italic leading-snug text-slate-900">
            {current.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </address>
          <button type="button" onClick={() => setEditing(true)} className="shrink-0 text-[15px] font-medium text-blue-700">
            {c.change}
          </button>
        </div>
      )}
      {note && !editing && <p className="mt-2 text-[13px] text-green-700">{note}</p>}

      {(editing || current.length === 0) && (
        <form onSubmit={save} className="mt-4 space-y-2.5">
          {current.length === 0 && <p className="text-[14px] font-medium text-amber-700">{c.missing}</p>}
          <input className={FIELD} placeholder={c.line1} autoComplete="address-line1" required value={form.line1} onChange={set("line1")} />
          <input className={FIELD} placeholder={c.line2} autoComplete="address-line2" value={form.line2} onChange={set("line2")} />
          <input className={FIELD} placeholder={c.city} autoComplete="address-level2" required value={form.city} onChange={set("city")} />
          <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2">
            <input className={FIELD} placeholder={c.state} autoComplete="address-level1" required maxLength={20} value={form.state} onChange={set("state")} />
            <input className={FIELD} placeholder={c.zip} autoComplete="postal-code" inputMode="numeric" required value={form.zip} onChange={set("zip")} />
          </div>
          {error && <p className="text-[14px] text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="pressable h-12 w-full rounded-full bg-amber-400 text-[16px] font-semibold text-blue-900 hover:bg-amber-500 disabled:bg-slate-200 disabled:text-slate-500"
          >
            {busy ? c.saving : c.save}
          </button>
        </form>
      )}
    </section>
  );
}
