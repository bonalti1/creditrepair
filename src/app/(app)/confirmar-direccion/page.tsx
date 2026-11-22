"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { useLocale } from "@/lib/i18n";

// "Confirmar dirección": the one tap the automatic message links to when the
// post office's data could not confirm the client's address (before mailing
// their letters, or when a letter came back). It shows the address on file
// and what the post office recognises, prefilled; one tap confirms it, or the
// client corrects it. Only the client answers (POST /api/profile/address/confirm).
// In the demo the request is invented and nothing is saved.

interface Request {
  id: string;
  finding: "undeliverable" | "ambiguous";
  reason: "verification" | "returned_letter";
  inputLines: string[];
  suggestionLines: string[];
  requestedAt: string;
}

const COPY = {
  es: {
    title: "Confirma tu dirección",
    lead: "Va como remitente en cada carta. Antes de enviarlas la revisamos con los datos del correo (USPS).",
    leadReturned: "El correo devolvió una de tus cartas. Antes de enviarla de nuevo revisamos tu dirección con los datos del correo (USPS).",
    ambiguous: "El correo reconoce el edificio, pero falta o sobra el número de departamento.",
    undeliverable: "El correo no reconoce esta dirección tal como está escrita.",
    onFile: "La que tenemos",
    suggestion: "La que reconoce el correo",
    confirm: "Confirmar dirección",
    keep: "Mi dirección está bien como la escribí",
    correct: "Corregirla",
    line1: "Calle y número",
    line2: "Departamento o unidad",
    city: "Ciudad",
    state: "Estado",
    zip: "Código postal",
    save: "Guardar y confirmar",
    cancel: "Cancelar",
    done: "Listo. Tus cartas salen con esta dirección.",
    doneNext: "La revisamos otra vez con el correo antes de enviar. No tienes que hacer nada más.",
    none: "No hay nada que confirmar. Tu dirección está al día.",
    error: "No pudimos leer esa dirección. Revisa la calle, la ciudad, el estado y el código postal.",
    demo: "Demo: la dirección es inventada y no se guarda nada.",
    back: "Más",
    help: "Si tienes dudas, responde al mensaje que te llegó y una persona del equipo te ayuda.",
  },
  en: {
    title: "Confirm your address",
    lead: "It is the return address on every letter. Before mailing them we check it against the post office's (USPS) data.",
    leadReturned: "The post office returned one of your letters. Before mailing it again we checked your address against the post office's (USPS) data.",
    ambiguous: "The post office recognises the building, but the apartment number is missing or extra.",
    undeliverable: "The post office does not recognise this address as written.",
    onFile: "The one we have",
    suggestion: "The one the post office recognises",
    confirm: "Confirm address",
    keep: "My address is right as I wrote it",
    correct: "Correct it",
    line1: "Street and number",
    line2: "Apartment or unit",
    city: "City",
    state: "State",
    zip: "ZIP code",
    save: "Save and confirm",
    cancel: "Cancel",
    done: "Done. Your letters go out with this address.",
    doneNext: "We check it again with the post office before mailing. There is nothing else to do.",
    none: "There is nothing to confirm. Your address is up to date.",
    error: "We could not read that address. Check the street, city, state and ZIP code.",
    demo: "Demo: the address is invented and nothing is saved.",
    back: "More",
    help: "If you have questions, reply to the message you got and a person on our team will help.",
  },
} as const;

const PRIMARY =
  "pressable flex h-14 w-full items-center justify-center gap-2 rounded-full bg-amber-400 px-6 text-[17px] font-semibold text-blue-900 hover:bg-amber-500 disabled:bg-slate-200 disabled:text-slate-500";
const SECONDARY = "pressable flex h-12 w-full items-center justify-center rounded-full bg-slate-100 px-5 text-[16px] font-semibold text-slate-900 hover:bg-slate-200";
const FIELD = "h-12 w-full rounded-xl bg-slate-100 px-3.5 text-[16px] outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-blue-300";

function Address({ lines, tone }: { lines: string[]; tone: "muted" | "strong" }) {
  return (
    <address className={`text-[16px] not-italic leading-snug ${tone === "strong" ? "font-semibold text-slate-900" : "text-slate-600"}`}>
      {lines.map((line) => (
        <span key={line} className="block">
          {line}
        </span>
      ))}
    </address>
  );
}

export default function ConfirmarDireccionPage() {
  const { locale } = useLocale();
  const c = COPY[locale === "en" ? "en" : "es"];
  const [state, setState] = useState<{ demo: boolean; request: Request | null } | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string[] | null>(null);
  const [form, setForm] = useState({ line1: "", line2: "", city: "", state: "TX", zip: "" });

  useEffect(() => {
    fetch("/api/profile/address/confirm")
      .then(async (res) => (res.ok ? ((await res.json()) as { demo: boolean; request: Request | null }) : { demo: false, request: null }))
      .then(setState)
      .catch(() => setState({ demo: false, request: null }));
  }, []);

  if (!state) return null;
  const request = state.request;

  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/profile/address/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as { addressLines?: string[] };
      if (!res.ok || !data.addressLines) throw new Error("invalid");
      setSaved(data.addressLines);
      setEditing(false);
    } catch {
      setError(c.error);
    } finally {
      setBusy(false);
    }
  };

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });
  const hasSuggestion = Boolean(request && request.suggestionLines.length > 0);

  return (
    <main className="animate-rise space-y-5" data-testid="confirmar-direccion">
      <Link href="/mas" className="inline-flex h-11 items-center gap-1 px-1 text-[15px] font-medium text-blue-700">
        <Icon name="chevron" size={16} className="rotate-180" />
        {c.back}
      </Link>
      <header className="px-1">
        <h1 className="font-display text-[30px] font-bold leading-tight text-blue-700">{c.title}</h1>
        <p className="mt-2 text-[16px] leading-relaxed text-slate-600">{request?.reason === "returned_letter" ? c.leadReturned : c.lead}</p>
      </header>
      {state.demo && (
        <p role="note" className="rounded-2xl bg-amber-100 px-4 py-3 text-[14px] leading-snug text-blue-900">
          {c.demo}
        </p>
      )}

      {saved ? (
        <section className="card px-5 py-5" data-testid="address-confirmed">
          <p className="flex items-start gap-2.5 text-[17px] font-semibold text-green-700">
            <Icon name="check" size={20} className="mt-0.5 shrink-0" />
            {c.done}
          </p>
          <div className="mt-3 rounded-2xl bg-slate-50 px-4 py-3">
            <Address lines={saved} tone="strong" />
          </div>
          <p className="mt-3 text-[15px] leading-relaxed text-slate-600">{c.doneNext}</p>
        </section>
      ) : !request ? (
        <section className="card px-5 py-5 text-[16px] leading-relaxed text-slate-700">{c.none}</section>
      ) : (
        <section className="card px-5 py-5">
          <p className="text-[15px] leading-relaxed text-slate-700">{request.finding === "ambiguous" ? c.ambiguous : c.undeliverable}</p>
          <div className="mt-4 grid gap-3">
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">{c.onFile}</p>
              <div className="mt-1">
                <Address lines={request.inputLines} tone="muted" />
              </div>
            </div>
            {hasSuggestion && (
              <div className="rounded-2xl border-2 border-blue-200 bg-blue-50 px-4 py-3" data-testid="address-suggestion">
                <p className="text-[13px] font-semibold uppercase tracking-wide text-blue-700">{c.suggestion}</p>
                <div className="mt-1">
                  <Address lines={request.suggestionLines} tone="strong" />
                </div>
              </div>
            )}
          </div>

          {!editing && (
            <div className="mt-5 grid gap-2.5">
              <button type="button" disabled={busy} onClick={() => send({ use: hasSuggestion ? "suggestion" : "current" })} className={PRIMARY} data-testid="confirm-address">
                <Icon name="check" size={18} />
                {c.confirm}
              </button>
              <button
                type="button"
                onClick={() => {
                  const base = hasSuggestion ? request.suggestionLines : request.inputLines;
                  const last = base[base.length - 1] ?? "";
                  const match = /^(.*),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/.exec(last);
                  setForm({ line1: base[0] ?? "", line2: base.length > 2 ? base[1]! : "", city: match?.[1] ?? "", state: match?.[2] ?? "TX", zip: match?.[3] ?? "" });
                  setEditing(true);
                }}
                className={SECONDARY}
              >
                {c.correct}
              </button>
              {hasSuggestion && (
                <button type="button" disabled={busy} onClick={() => send({ use: "current" })} className="min-h-11 text-[15px] font-medium text-blue-700">
                  {c.keep}
                </button>
              )}
            </div>
          )}

          {editing && (
            <form
              className="mt-5 space-y-2.5"
              onSubmit={(e) => {
                e.preventDefault();
                void send({ use: "corrected", ...form, line2: form.line2.trim() || null });
              }}
            >
              <input className={FIELD} placeholder={c.line1} autoComplete="address-line1" required value={form.line1} onChange={set("line1")} />
              <input className={FIELD} placeholder={c.line2} autoComplete="address-line2" value={form.line2} onChange={set("line2")} />
              <input className={FIELD} placeholder={c.city} autoComplete="address-level2" required value={form.city} onChange={set("city")} />
              <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2">
                <input className={FIELD} placeholder={c.state} autoComplete="address-level1" required maxLength={20} value={form.state} onChange={set("state")} />
                <input className={FIELD} placeholder={c.zip} autoComplete="postal-code" inputMode="numeric" required value={form.zip} onChange={set("zip")} />
              </div>
              <button type="submit" disabled={busy} className={PRIMARY}>
                {c.save}
              </button>
              <button type="button" onClick={() => setEditing(false)} className={SECONDARY}>
                {c.cancel}
              </button>
            </form>
          )}
          {error && (
            <p role="alert" className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-[14px] leading-snug text-red-700">
              {error}
            </p>
          )}
        </section>
      )}
      <p className="px-1 text-[14px] leading-relaxed text-slate-500">{c.help}</p>
    </main>
  );
}
