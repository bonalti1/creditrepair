"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ALL_STATES } from "@/lib/compliance/states";
import { useOpenStates } from "@/lib/compliance/useOpenStates";
import { buildInvitePath, GOALS, inviteMessage, type GoalKey } from "@/lib/sales/invite";
import { whatsappHref } from "@/lib/staff/messages";
import type { Viewer } from "@/lib/staff/permissions";
import type { NewClientField, TeamMember } from "@/lib/staff/team";
import type { TeamData } from "@/lib/staff/teamData";
import { fullName, type StaffClient } from "@/lib/staff/types";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { staffMessage } from "@/lib/staff/i18n/messages";
import Icon from "@/components/Icon";
import { ClientLanguageTag, PRIMARY_BUTTON, SECONDARY_BUTTON } from "@/components/staff/ui";
import HouseholdMemberCard from "@/components/staff/HouseholdMember";

// "Agregar cliente": someone sales talked to, added by hand, as a prospect.
// Then the same invitation the invite page makes (sales/invite.ts: the same
// link and the same message, not a copy of it), ready to send by WhatsApp,
// in the client's language: English unless sales talked with them in Spanish.
// The link carries it (`lang`), so the app opens in it too.
//
// Only what sales needs to start: name, phone, an optional email, state and
// goal. There is no field for a Social Security number or a date of birth, and
// there must never be one: the client gives their identity data themselves,
// in their own app.

const field =
  "h-11 w-full rounded-2xl bg-white px-3.5 text-[15px] text-slate-900 shadow-[0_0_0_1px_rgba(0,0,0,0.08)] outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-blue-300";
const labelClass = "block pb-1 text-[12px] font-semibold uppercase tracking-wide text-slate-500";
const STATES = ["TX", ...ALL_STATES.filter((s) => s !== "TX")];

export default function AddClient({
  viewer,
  members,
  team,
  onClose,
  onAdded,
}: {
  viewer: Viewer;
  members: TeamMember[];
  team: TeamData;
  onClose: () => void;
  onAdded: (client: StaffClient) => Promise<void> | void;
}) {
  // The states opened in /equipo/estados.
  const openStates = useOpenStates();
  const sellers = members.filter((m) => m.active && (m.role === "sales" || m.role === "admin"));
  const { locale } = useStaffLocale();
  const t = useTx();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState("TX");
  const [goal, setGoal] = useState<GoalKey>("general");
  // The client's language (not the console's): the invite and the app go in it.
  const [lang, setLang] = useState<"en" | "es">("en");
  const [seller, setSeller] = useState(viewer.handle);
  const [problems, setProblems] = useState<Partial<Record<NewClientField, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<StaffClient | null>(null);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => setOrigin(window.location.origin), []);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await team.addClient({ firstName, lastName, phone, email, state, goal, salesperson: seller }, viewer);
    setBusy(false);
    if (!result.ok) {
      setProblems(Object.fromEntries(Object.entries(result.problems ?? {}).map(([k, v]) => [k, staffMessage(String(v), locale)])));
      setError(staffMessage(result.message, locale));
      return;
    }
    setProblems({});
    setAdded(result.client);
    await onAdded(result.client);
  };

  if (added) {
    const credited = members.find((m) => m.handle === added.salesperson);
    const url = origin + buildInvitePath({ name: added.firstName, goal: added.goal as GoalKey, state: added.state, ref: added.salesperson, refName: credited?.name.split(" ")[0] ?? null, lang });
    const message = inviteMessage({ name: added.firstName }, url, lang);
    const assigned = added.assignedTo ? members.find((m) => m.handle === added.assignedTo)?.name : null;
    return (
      <section className="card p-5 sm:p-6" data-testid="add-client-done" aria-live="polite">
        <p className="flex items-center gap-2 text-[16px] font-semibold text-green-700">
          <Icon name="check" size={18} />
          {t(`${fullName(added)} quedó como prospecto`, `${fullName(added)} was added as a lead`)}
        </p>
        <p className="mt-1 text-[14px] leading-snug text-slate-500">
          {t("Ventas", "Sales")}: {credited?.name ?? added.salesperson}.{" "}
          {assigned
            ? t(`Lo trabajará ${assigned} (asignación por turno).`, `${assigned} will work it (assigned by rotation).`)
            : t("Todavía nadie del equipo lo tiene asignado.", "Nobody on the team is assigned yet.")}
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3">
          <p className={labelClass}>{t("Mensaje listo para enviar", "Message ready to send")}</p>
          <ClientLanguageTag client={{ locale: lang }} />
        </div>
        <p className="whitespace-pre-line break-words rounded-2xl bg-slate-50 p-4 text-[15px] leading-relaxed text-slate-900">
          {message.split(url).flatMap((part, i) => (i === 0 ? [part] : [<span key={i} className="break-all">{url}</span>, part]))}
        </p>
        {openStates.status(added.state) !== "open" && (
          <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-[14px] leading-snug text-blue-900">
            {t(
              `Todavía no abrimos en ${added.state}. El enlace lo llevará a la lista de espera, no a la app.`,
              `We're not open in ${added.state} yet. The link takes them to the waitlist, not the app.`,
            )}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <a href={whatsappHref(added.phone, message)} target="_blank" rel="noopener noreferrer" className={PRIMARY_BUTTON}>
            {t("Enviar por WhatsApp", "Send on WhatsApp")}
          </a>
          <button
            type="button"
            className={SECONDARY_BUTTON}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(message);
                setCopied(true);
              } catch {
                // Clipboard blocked: the text is on screen to select by hand.
              }
            }}
          >
            {copied ? t("Mensaje copiado", "Message copied") : t("Copiar mensaje", "Copy message")}
          </button>
          <Link href={`/equipo/clientes/${added.id}`} className={SECONDARY_BUTTON}>
            {t("Ver su ficha", "See their record")}
          </Link>
        </div>
        {/* A spouse, partner or family member: a person of their own, with their own invite (migration 0027). */}
        <div className="mt-4 border-t hairline pt-4">
          <HouseholdMemberCard primary={{ ...added, locale: lang }} viewer={viewer} team={team} members={members} />
        </div>
        <button type="button" onClick={onClose} className="mt-3 text-[14px] font-medium text-blue-700 underline-offset-2 hover:underline">
          {t("Cerrar", "Close")}
        </button>
      </section>
    );
  }

  const err = (name: NewClientField) =>
    problems[name] ? (
      <p className="mt-1 text-[13px] leading-snug text-red-700" role="alert">
        {problems[name]}
      </p>
    ) : null;

  return (
    <section className="card p-5 sm:p-6" data-testid="add-client" aria-labelledby="agregar-titulo">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="agregar-titulo" className="text-[18px] font-semibold text-slate-900">
            {t("Agregar cliente", "Add client")}
          </h2>
          <p className="mt-0.5 text-[14px] leading-snug text-slate-500">
            {t("Queda como prospecto y te damos su invitación lista para enviar.", "They're saved as a lead and you get their invite ready to send.")}
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-[14px] font-medium text-slate-500 hover:text-slate-900">
          {t("Cancelar", "Cancel")}
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="nc-first">{t("Nombre", "First name")}</label>
          <input id="nc-first" className={field} value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="off" />
          {err("firstName")}
        </div>
        <div>
          <label className={labelClass} htmlFor="nc-last">{t("Apellido", "Last name")}</label>
          <input id="nc-last" className={field} value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="off" />
          {err("lastName")}
        </div>
        <div>
          <label className={labelClass} htmlFor="nc-phone">WhatsApp</label>
          <input id="nc-phone" className={field} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="(713) 555-1234" />
          {err("phone")}
        </div>
        <div>
          <label className={labelClass} htmlFor="nc-email">{t("Correo (opcional)", "Email (optional)")}</label>
          <input id="nc-email" className={field} value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" autoComplete="off" />
          {err("email")}
        </div>
        <div>
          <label className={labelClass} htmlFor="nc-state">{t("Estado donde vive", "State they live in")}</label>
          <select id="nc-state" className={field} value={state} onChange={(e) => setState(e.target.value)}>
            {STATES.map((s) => (
              <option key={s} value={s}>{s === "TX" ? "Texas (TX)" : s}</option>
            ))}
          </select>
          {err("state")}
        </div>
        <div>
          <label className={labelClass} htmlFor="nc-goal">{t("Su meta", "Their goal")}</label>
          <select id="nc-goal" className={field} value={goal} onChange={(e) => setGoal(e.target.value as GoalKey)}>
            {GOALS.map((g) => (
              <option key={g.key} value={g.key}>{t(g.label, g.labelEn)}</option>
            ))}
          </select>
          {err("goal")}
        </div>
        <div>
          <label className={labelClass} htmlFor="nc-lang">{t("Idioma del cliente", "Client's language")}</label>
          <select id="nc-lang" className={field} value={lang} onChange={(e) => setLang(e.target.value === "es" ? "es" : "en")}>
            <option value="en">{t("Inglés", "English")}</option>
            <option value="es">{t("Español", "Spanish")}</option>
          </select>
          <p className="mt-1 text-[12.5px] leading-snug text-slate-500">
            {t("La invitación y la app van en este idioma. El cliente puede cambiarlo en la app.", "The invite and the app go in this language. The client can change it in the app.")}
          </p>
        </div>
        <div>
          <label className={labelClass} htmlFor="nc-seller">{t("Quién de ventas lo trae", "Who in sales brought them in")}</label>
          {viewer.role === "sales" ? (
            <p className="flex h-11 items-center rounded-2xl bg-slate-50 px-3.5 text-[15px] text-slate-700">{viewer.name} {t("(tú)", "(you)")}</p>
          ) : (
            <select id="nc-seller" className={field} value={seller} onChange={(e) => setSeller(e.target.value)}>
              {sellers.map((m) => (
                <option key={m.handle} value={m.handle}>{m.name}</option>
              ))}
            </select>
          )}
          {err("salesperson")}
        </div>
      </div>

      <p className="mt-3 text-[13px] leading-snug text-slate-500">
        {t(
          "No pedimos su número de Seguro Social ni su fecha de nacimiento: el cliente los da él mismo en su app.",
          "We don't ask for their Social Security number or date of birth: the client enters those in their own app.",
        )}
      </p>
      {error && Object.keys(problems).length === 0 && (
        <p className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-[14px] text-red-700" role="alert">
          {error}
        </p>
      )}
      <div className="mt-4">
        <button type="button" onClick={save} disabled={busy} className={PRIMARY_BUTTON}>
          {t("Agregar y preparar invitación", "Add and prepare invite")}
        </button>
      </div>
    </section>
  );
}
