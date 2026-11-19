"use client";

import { useEffect, useMemo, useState } from "react";
import { ALL_STATES, stateStatus } from "@/lib/compliance/states";
import { buildInvitePath, GOALS, inviteMessageEs, type GoalKey } from "@/lib/sales/invite";
import Logo from "@/components/Logo";

// The salesperson's side of the handoff. After the WhatsApp conversation they
// fill in four things and get a personal link plus a ready message. The
// customer opens it and lands on a welcome screen with those answers filled in.

const field =
  "h-12 w-full rounded-2xl bg-white px-4 text-[16px] text-slate-900 shadow-[0_0_0_1px_rgba(0,0,0,0.08)] outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-blue-300";
const label = "block pb-1.5 text-[13px] font-semibold uppercase tracking-wide text-slate-500";
const STATES = ["TX", ...ALL_STATES.filter((s) => s !== "TX")];
const ME = "bonalti.salesName";

export default function Invitar() {
  const [me, setMe] = useState("");
  const [name, setName] = useState("");
  const [goal, setGoal] = useState<GoalKey>("general");
  const [state, setState] = useState("TX");
  const [phone, setPhone] = useState("");
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState<"link" | "message" | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    try {
      setMe(window.localStorage.getItem(ME) ?? "");
    } catch {
      // ignore
    }
  }, []);

  const url = useMemo(
    () => origin + buildInvitePath({ name, goal, state, refName: me }),
    [origin, name, goal, state, me],
  );
  const message = useMemo(() => inviteMessageEs({ name }, url), [name, url]);
  const open = stateStatus(state) === "open";
  const ready = me.trim().length >= 2 && name.trim().length >= 2;
  const digits = phone.replace(/\D/g, "");
  const waNumber = digits.length === 10 ? `1${digits}` : digits;

  const copy = async (what: "link" | "message") => {
    try {
      await navigator.clipboard.writeText(what === "link" ? url : message);
      setCopied(what);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      // Clipboard blocked: the text is on screen to select by hand.
    }
  };

  return (
    <main className="mx-auto min-h-dvh max-w-md px-6 pb-12 pt-6">
      <div className="flex items-center justify-between">
        <Logo size={19} />
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">Equipo</span>
      </div>

      <h1 className="mt-8 text-[28px] font-semibold tracking-tight text-slate-900">Invitar a un cliente</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-slate-500">
        Llena esto al terminar la conversación. El cliente abre el enlace y ya no repite sus respuestas.
      </p>

      <div className="mt-6 space-y-4">
        <div>
          <label className={label} htmlFor="me">Tu nombre</label>
          <input
            id="me"
            className={field}
            value={me}
            onChange={(e) => {
              setMe(e.target.value);
              try {
                window.localStorage.setItem(ME, e.target.value);
              } catch {
                // ignore
              }
            }}
            placeholder="Ana"
            autoComplete="given-name"
          />
        </div>
        <div>
          <label className={label} htmlFor="name">Nombre del cliente</label>
          <input id="name" className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="María" />
        </div>
        <div>
          <label className={label} htmlFor="goal">Su meta</label>
          <select id="goal" className={field} value={goal} onChange={(e) => setGoal(e.target.value as GoalKey)}>
            {GOALS.map((g) => (
              <option key={g.key} value={g.key}>{g.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="state">Estado donde vive</label>
          <select id="state" className={field} value={state} onChange={(e) => setState(e.target.value)}>
            {STATES.map((s) => (
              <option key={s} value={s}>{s === "TX" ? "Texas (TX)" : s}</option>
            ))}
          </select>
          {!open && (
            <p className="mt-2 rounded-2xl bg-amber-50 px-4 py-3 text-[14px] leading-snug text-amber-700">
              Todavía no abrimos en {state}. El enlace lo llevará a la lista de espera, no a la app.
            </p>
          )}
        </div>
        <div>
          <label className={label} htmlFor="phone">WhatsApp del cliente (opcional)</label>
          <input
            id="phone"
            className={field}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(713) 555-1234"
            inputMode="tel"
          />
          <p className="mt-1.5 text-[13px] text-slate-500">Solo abre el chat; no se guarda ni va en el enlace.</p>
        </div>
      </div>

      <section className="card mt-6 p-5">
        <p className={label}>Mensaje listo para enviar</p>
        <p className="whitespace-pre-line break-words text-[15px] leading-relaxed text-slate-900">
          {ready
            ? // The link may break at any character, so a break never reads as a hyphen in the address.
              message.split(url).flatMap((part, i) =>
                i === 0 ? [part] : [<span key={i} className="break-all">{url}</span>, part],
              )
            : "Escribe tu nombre y el del cliente para ver el mensaje."}
        </p>
      </section>

      <div className="mt-4 space-y-3">
        {waNumber.length >= 11 ? (
          <a
            href={ready ? `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}` : undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!ready}
            className={`pressable flex h-14 w-full items-center justify-center rounded-full text-[17px] font-semibold ${
              ready ? "bg-amber-400 text-blue-900 hover:bg-amber-500" : "pointer-events-none bg-slate-200 text-slate-500"
            }`}
          >
            Enviar por WhatsApp
          </a>
        ) : (
          <button
            type="button"
            disabled={!ready}
            onClick={() => copy("message")}
            className="pressable flex h-14 w-full items-center justify-center rounded-full bg-amber-400 text-[17px] font-semibold text-blue-900 hover:bg-amber-500 disabled:bg-slate-200 disabled:text-slate-500"
          >
            {copied === "message" ? "Mensaje copiado" : "Copiar mensaje"}
          </button>
        )}
        <button
          type="button"
          disabled={!ready}
          onClick={() => copy("link")}
          className="pressable flex h-12 w-full items-center justify-center rounded-full bg-slate-100 text-[16px] font-medium text-slate-900 disabled:text-slate-400"
        >
          {copied === "link" ? "Enlace copiado" : "Copiar solo el enlace"}
        </button>
      </div>

      <section className="mt-8">
        <p className={label}>Antes de enviar, recuerda</p>
        <ul className="card divide-y divide-slate-100 text-[15px] leading-snug text-slate-700">
          {[
            "No prometas resultados, puntos ni fechas. Los resultados varían.",
            "El cliente revisa, confirma y aprueba todo por sí mismo. No lo hagas por él ni le digas qué marcar.",
            "Todo por escrito en WhatsApp. No cierres ventas por llamada.",
            "El único costo es el monitoreo, y se lo paga al servicio de monitoreo, no a nosotros.",
          ].map((rule) => (
            <li key={rule} className="px-5 py-3.5">{rule}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
