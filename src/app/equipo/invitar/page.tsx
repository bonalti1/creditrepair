"use client";

import { useEffect, useMemo, useState } from "react";
import { ALL_STATES, stateStatus } from "@/lib/compliance/states";
import {
  buildInvitePath,
  GOALS,
  inviteMessage,
  SALES_MAY_NOT_SAY,
  SALES_MAY_SAY,
  type GoalKey,
} from "@/lib/sales/invite";
import { formatPhone } from "@/lib/staff/format";
import { partnerCodeOf } from "@/lib/leads/source";
import { deniedReason } from "@/lib/staff/permissions";
import { useStaff } from "@/lib/staff/useStaff";
import { NoAccess } from "@/components/staff/ui";

// The salesperson's side of the handoff. After the WhatsApp conversation they
// fill in four things and get a personal link plus a ready message. The
// customer opens it and lands on a welcome screen with those answers filled in.
// Under the message are the reminders for the conversation: what may be said
// about the service (the process) and what may not (results, the customer's
// decisions, pressure, payment by phone). The lists live in sales/invite.ts.
//
// Opened from a client's page (/equipo/invitar?cliente=<id>) the name, state
// and WhatsApp number arrive filled in. Only the id travels in the address;
// the details are looked up here, so no personal data sits in a URL. The look
// up goes through the viewer's permissions: only a client they may see fills in.

const field =
  "h-12 w-full rounded-2xl bg-white px-4 text-[16px] text-slate-900 shadow-[0_0_0_1px_rgba(0,0,0,0.08)] outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-blue-300";
const label = "block pb-1.5 text-[13px] font-semibold uppercase tracking-wide text-slate-500";
const STATES = ["TX", ...ALL_STATES.filter((s) => s !== "TX")];
const ME = "bonalti.salesName";

export default function Invitar() {
  const { data, ready: loaded, viewer, can } = useStaff();
  const [me, setMe] = useState("");
  const [name, setName] = useState("");
  const [goal, setGoal] = useState<GoalKey>("general");
  const [state, setState] = useState("TX");
  const [phone, setPhone] = useState("");
  // The client's language: the app opens in it and the message is written in it. English unless you talked in Spanish.
  const [lang, setLang] = useState<"en" | "es">("en");
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState<"link" | "message" | null>(null);
  const [partner, setPartner] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    try {
      setMe(window.localStorage.getItem(ME) ?? "");
    } catch {
      // ignore
    }
  }, []);

  // The member using the console signs the invitation; then the client, when the page came from their file.
  useEffect(() => {
    if (!loaded) return;
    if (viewer) setMe(viewer.name.split(" ")[0] ?? "");
    const clientId = new URLSearchParams(window.location.search).get("cliente");
    if (!clientId) return;
    void data
      .getClient(clientId)
      .then((client) => {
        if (!client) return;
        setName(client.firstName);
        if ((ALL_STATES as readonly string[]).includes(client.state)) setState(client.state);
        setPhone(formatPhone(client.phone));
        // A lead from HighLevel or a partner arrives with a goal, and a partner's code the link carries on.
        if (GOALS.some((g) => g.key === client.goal)) setGoal(client.goal as GoalKey);
        setPartner(partnerCodeOf(client.leadSource));
        setClientId(client.id);
      });
  }, [loaded, viewer, data]);

  // With a database, the link credits the member by their handle (staff_members.handle): it becomes the
  // client's profiles.referred_by, which is what lets a salesperson see the people they brought in (migration 0012).
  const handle = !data.demo && viewer ? viewer.handle : undefined;
  const url = useMemo(
    () => origin + buildInvitePath({ name, goal, state, refName: me, ref: handle, partner, lang }),
    [origin, name, goal, state, me, handle, partner, lang],
  );
  // Sending or copying the message for a prospect records when the invitation went out (HighLevel's "Invitado").
  const markInvited = () => {
    if (!clientId || data.demo) return;
    void fetch("/api/staff/prospects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "invited", id: clientId }) }).catch(() => undefined);
  };
  const message = useMemo(() => inviteMessage({ name }, url, lang), [name, url, lang]);
  const open = stateStatus(state) === "open";
  const ready = me.trim().length >= 2 && name.trim().length >= 2;
  const digits = phone.replace(/\D/g, "");
  const waNumber = digits.length === 10 ? `1${digits}` : digits;

  const copy = async (what: "link" | "message") => {
    try {
      await navigator.clipboard.writeText(what === "link" ? url : message);
      markInvited();
      setCopied(what);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      // Clipboard blocked: the text is on screen to select by hand.
    }
  };

  if (loaded && !can("clients.invite")) return <NoAccess title="Invitar a un cliente" reason={deniedReason("clients.invite")} />;

  return (
    <main className="animate-rise mx-auto max-w-md pb-6">
      <h1 className="text-[28px] font-semibold tracking-tight text-slate-900">Invitar a un cliente</h1>
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
          <label className={label} htmlFor="lang">Idioma del cliente</label>
          <select id="lang" className={field} value={lang} onChange={(e) => setLang(e.target.value === "es" ? "es" : "en")}>
            <option value="en">Inglés</option>
            <option value="es">Español</option>
          </select>
          <p className="mt-1.5 text-[13px] text-slate-500">La app y el mensaje van en este idioma. El cliente puede cambiarlo en la app.</p>
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
          {partner && (
            <p className="mt-2 rounded-2xl bg-blue-50 px-4 py-3 text-[14px] leading-snug text-blue-700" data-testid="invite-partner">
              Lo refirió un socio: el enlace lleva su código ({partner}) para que quede registrado.
            </p>
          )}
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
            onClick={markInvited}
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

      <section className="mt-8" data-testid="sales-may-say">
        <p className={label}>Lo que sí puedes decir</p>
        <ul className="card divide-y divide-slate-100 text-[15px] leading-snug text-slate-700">
          {SALES_MAY_SAY.map((rule) => (
            <li key={rule} className="px-5 py-3.5">{rule}</li>
          ))}
        </ul>
      </section>

      <section className="mt-6" data-testid="sales-may-not-say">
        <p className={label}>Lo que no puedes decir ni hacer</p>
        <ul className="card divide-y divide-slate-100 text-[15px] leading-snug text-slate-700">
          {SALES_MAY_NOT_SAY.map((rule) => (
            <li key={rule} className="px-5 py-3.5">{rule}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
