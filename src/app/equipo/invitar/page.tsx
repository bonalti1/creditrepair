"use client";

import { useEffect, useMemo, useState } from "react";
import { ALL_STATES } from "@/lib/compliance/states";
import { useOpenStates } from "@/lib/compliance/useOpenStates";
import {
  buildInvitePath,
  GOALS,
  inviteMessage,
  SALES_MAY_NOT_SAY,
  SALES_MAY_NOT_SAY_EN,
  SALES_MAY_SAY,
  SALES_MAY_SAY_EN,
  type GoalKey,
} from "@/lib/sales/invite";
import { formatPhone } from "@/lib/staff/format";
import { partnerCodeOf } from "@/lib/leads/source";
import { deniedReason } from "@/lib/staff/permissions";
import { useStaff } from "@/lib/staff/useStaff";
import { NoAccess } from "@/components/staff/ui";
import HouseholdMemberCard from "@/components/staff/HouseholdMember";
import type { StaffClient } from "@/lib/staff/types";
import { useTx } from "@/lib/staff/i18n/StaffLocale";

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
  // The states opened in /equipo/estados.
  const openStates = useOpenStates();
  const { data, ready: loaded, viewer, can, locale, team, members, reload } = useStaff();
  const t = useTx();
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
  // The person the page was opened for: a household member can be added for them.
  const [record, setRecord] = useState<StaffClient | null>(null);

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
        setRecord(client);
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
  const open = openStates.status(state) === "open";
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

  if (loaded && !can("clients.invite")) return <NoAccess title={t("Invitar a un cliente", "Invite a client")} reason={deniedReason("clients.invite", locale)} />;

  return (
    <main className="animate-rise mx-auto max-w-md pb-6">
      <h1 className="text-[28px] font-semibold tracking-tight text-slate-900">{t("Invitar a un cliente", "Invite a client")}</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-slate-500">
        {t(
          "Llena esto al terminar la conversación. El cliente abre el enlace y ya no repite sus respuestas.",
          "Fill this in when the conversation ends. The client opens the link and doesn't have to repeat their answers.",
        )}
      </p>

      <div className="mt-6 space-y-4">
        <div>
          <label className={label} htmlFor="me">{t("Tu nombre", "Your name")}</label>
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
          <label className={label} htmlFor="name">{t("Nombre del cliente", "Client's name")}</label>
          <input id="name" className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="María" />
        </div>
        <div>
          <label className={label} htmlFor="goal">{t("Su meta", "Their goal")}</label>
          <select id="goal" className={field} value={goal} onChange={(e) => setGoal(e.target.value as GoalKey)}>
            {GOALS.map((g) => (
              <option key={g.key} value={g.key}>{t(g.label, g.labelEn)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="lang">{t("Idioma del cliente", "Client's language")}</label>
          <select id="lang" className={field} value={lang} onChange={(e) => setLang(e.target.value === "es" ? "es" : "en")}>
            <option value="en">{t("Inglés", "English")}</option>
            <option value="es">{t("Español", "Spanish")}</option>
          </select>
          <p className="mt-1.5 text-[13px] text-slate-500">La app y el mensaje van en este idioma. El cliente puede cambiarlo en la app.</p>
        </div>
        <div>
          <label className={label} htmlFor="state">{t("Estado donde vive", "State they live in")}</label>
          <select id="state" className={field} value={state} onChange={(e) => setState(e.target.value)}>
            {STATES.map((s) => (
              <option key={s} value={s}>{s === "TX" ? "Texas (TX)" : s}</option>
            ))}
          </select>
          {!open && (
            <p className="mt-2 rounded-2xl bg-amber-50 px-4 py-3 text-[14px] leading-snug text-amber-700">
              {t(`Todavía no abrimos en ${state}. El enlace lo llevará a la lista de espera, no a la app.`, `We're not open in ${state} yet. The link takes them to the waitlist, not the app.`)}
            </p>
          )}
        </div>
        <div>
          <label className={label} htmlFor="phone">{t("WhatsApp del cliente (opcional)", "Client's WhatsApp (optional)")}</label>
          <input
            id="phone"
            className={field}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(713) 555-1234"
            inputMode="tel"
          />
          <p className="mt-1.5 text-[13px] text-slate-500">{t("Solo abre el chat; no se guarda ni va en el enlace.", "It only opens the chat; it isn't saved or put in the link.")}</p>
          {partner && (
            <p className="mt-2 rounded-2xl bg-blue-50 px-4 py-3 text-[14px] leading-snug text-blue-700" data-testid="invite-partner">
              {t(
                `Lo refirió un socio: el enlace lleva su código (${partner}) para que quede registrado.`,
                `A partner referred them: the link carries their code (${partner}) so it's recorded.`,
              )}
            </p>
          )}
        </div>
      </div>

      <section className="card mt-6 p-5">
        <p className={label}>{t("Mensaje listo para enviar", "Message ready to send")}</p>
        <p className="whitespace-pre-line break-words text-[15px] leading-relaxed text-slate-900">
          {ready
            ? // The link may break at any character, so a break never reads as a hyphen in the address.
              message.split(url).flatMap((part, i) =>
                i === 0 ? [part] : [<span key={i} className="break-all">{url}</span>, part],
              )
            : t("Escribe tu nombre y el del cliente para ver el mensaje.", "Enter your name and the client's to see the message.")}
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
            {t("Enviar por WhatsApp", "Send on WhatsApp")}
          </a>
        ) : (
          <button
            type="button"
            disabled={!ready}
            onClick={() => copy("message")}
            className="pressable flex h-14 w-full items-center justify-center rounded-full bg-amber-400 text-[17px] font-semibold text-blue-900 hover:bg-amber-500 disabled:bg-slate-200 disabled:text-slate-500"
          >
            {copied === "message" ? t("Mensaje copiado", "Message copied") : t("Copiar mensaje", "Copy message")}
          </button>
        )}
        <button
          type="button"
          disabled={!ready}
          onClick={() => copy("link")}
          className="pressable flex h-12 w-full items-center justify-center rounded-full bg-slate-100 text-[16px] font-medium text-slate-900 disabled:text-slate-400"
        >
          {copied === "link" ? t("Enlace copiado", "Link copied") : t("Copiar solo el enlace", "Copy just the link")}
        </button>
      </div>

      {record && viewer && can("clients.add") && (
        <section className="mt-8" data-testid="invite-household">
          <p className={label}>{t("Su hogar", "Their household")}</p>
          <HouseholdMemberCard primary={record} viewer={viewer} team={team} members={members} initiallyOpen={new URLSearchParams(typeof window === "undefined" ? "" : window.location.search).get("hogar") === "1"} onAdded={reload} />
        </section>
      )}

      <section className="mt-8" data-testid="sales-may-say">
        <p className={label}>{t("Lo que sí puedes decir", "What you can say")}</p>
        <ul className="card divide-y divide-slate-100 text-[15px] leading-snug text-slate-700">
          {t(SALES_MAY_SAY, SALES_MAY_SAY_EN).map((rule) => (
            <li key={rule} className="px-5 py-3.5">{rule}</li>
          ))}
        </ul>
      </section>

      <section className="mt-6" data-testid="sales-may-not-say">
        <p className={label}>{t("Lo que no puedes decir ni hacer", "What you can't say or do")}</p>
        <ul className="card divide-y divide-slate-100 text-[15px] leading-snug text-slate-700">
          {t(SALES_MAY_NOT_SAY, SALES_MAY_NOT_SAY_EN).map((rule) => (
            <li key={rule} className="px-5 py-3.5">{rule}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
