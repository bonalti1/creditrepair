"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  householdInviteMessage,
  householdInvitePath,
  RELATIONSHIPS,
  RELATIONSHIP_LABEL,
  type HouseholdField,
  type HouseholdMember,
  type Relationship,
} from "@/lib/household/household";
import { GOALS, type GoalKey } from "@/lib/sales/invite";
import { whatsappHref } from "@/lib/staff/messages";
import type { Viewer } from "@/lib/staff/permissions";
import type { TeamMember } from "@/lib/staff/team";
import type { TeamData } from "@/lib/staff/teamData";
import { fullName, type StaffClient } from "@/lib/staff/types";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { staffMessage } from "@/lib/staff/i18n/messages";
import Icon from "@/components/Icon";
import { ClientLanguageTag, PRIMARY_BUTTON, ROW_BUTTON, SECONDARY_BUTTON } from "@/components/staff/ui";

// "Add a household member", on the invite page and after Add client: a
// spouse, partner or family member of this person. They become someone of
// their own: a lead with their own invitation (in their own language), then
// their own login, agreement and disputes. Only the link is shared, so the
// plan's household discount applies to each agreement. Pausing and
// cancelling stay per person.

const field =
  "h-11 w-full rounded-2xl bg-white px-3.5 text-[15px] text-slate-900 shadow-[0_0_0_1px_rgba(0,0,0,0.08)] outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-blue-300";
const labelClass = "block pb-1 text-[12px] font-semibold uppercase tracking-wide text-slate-500";

export default function HouseholdMemberCard({
  primary,
  viewer,
  team,
  members,
  initiallyOpen = false,
  onAdded,
}: {
  primary: StaffClient;
  viewer: Viewer;
  team: TeamData;
  members: TeamMember[];
  initiallyOpen?: boolean;
  onAdded?: () => void | Promise<void>;
}) {
  const { locale } = useStaffLocale();
  const t = useTx();
  const [open, setOpen] = useState(initiallyOpen);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState(primary.lastName);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [relationship, setRelationship] = useState<Relationship>("spouse");
  const [lang, setLang] = useState<"en" | "es">(primary.locale === "es" ? "es" : "en");
  const [problems, setProblems] = useState<Partial<Record<HouseholdField, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<{ id: string; member: HouseholdMember } | null>(null);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);

  if (primary.household && !added) {
    return (
      <section className="card px-5 py-4" data-testid="household-existing">
        <p className="text-[14px] leading-snug text-slate-700">
          <span className="font-semibold text-slate-900">{t("Hogar", "Household")}:</span>{" "}
          <Link href={`/equipo/clientes/${primary.household.partnerId}`} className="font-medium text-blue-700 underline-offset-2 hover:underline">
            {primary.household.partnerName}
          </Link>
          {primary.household.relationship !== "household" ? ` · ${RELATIONSHIP_LABEL[locale][primary.household.relationship]}` : ""}
        </p>
        <p className="mt-1 text-[13px] leading-snug text-slate-500">
          {t("Un hogar son dos personas. Cada una tiene su propio caso.", "A household is two people. Each one has their own case.")}
        </p>
      </section>
    );
  }

  if (added) {
    const credited = members.find((m) => m.handle === primary.salesperson);
    const goal = GOALS.some((g) => g.key === primary.goal) ? (primary.goal as GoalKey) : null;
    const url = origin + householdInvitePath(added.member, { state: primary.state, goal, ref: primary.salesperson || null, refName: credited?.name.split(" ")[0] ?? null });
    const message = householdInviteMessage(added.member.firstName, primary.firstName, url, added.member.locale);
    return (
      <section className="card p-5" data-testid="household-done" aria-live="polite">
        <p className="flex items-center gap-2 text-[16px] font-semibold text-green-700">
          <Icon name="check" size={18} />
          {t(
            `${added.member.firstName} ${added.member.lastName} quedó en el hogar de ${primary.firstName}`,
            `${added.member.firstName} ${added.member.lastName} is in ${primary.firstName}'s household`,
          )}
        </p>
        <p className="mt-1 text-[14px] leading-snug text-slate-500">
          {t(
            "Tiene su propia invitación, su propio acceso, su propio acuerdo y sus propias disputas. El descuento de hogar del plan aplica a los dos al firmar.",
            "They get their own invite, login, agreement and disputes. The plan's household discount applies to both when they sign.",
          )}
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3">
          <p className={labelClass}>{t("Su invitación, lista para enviar", "Their invite, ready to send")}</p>
          <ClientLanguageTag client={{ locale: added.member.locale }} />
        </div>
        <p className="whitespace-pre-line break-words rounded-2xl bg-slate-50 p-4 text-[15px] leading-relaxed text-slate-900">
          {message.split(url).flatMap((part, i) => (i === 0 ? [part] : [<span key={i} className="break-all">{url}</span>, part]))}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href={whatsappHref(added.member.phone, message)} target="_blank" rel="noopener noreferrer" className={PRIMARY_BUTTON}>
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
      </section>
    );
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${ROW_BUTTON} gap-2`} data-testid="household-open">
        <Icon name="person" size={16} />
        {t("Agregar a alguien de su hogar", "Add a household member")}
      </button>
    );
  }

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await team.addHouseholdMember(primary, { firstName, lastName, phone, email, relationship, locale: lang }, viewer);
    setBusy(false);
    if (!result.ok) {
      setProblems(Object.fromEntries(Object.entries(result.problems ?? {}).map(([k, v]) => [k, v ? v[locale] : ""])));
      setError(staffMessage(result.message, locale));
      return;
    }
    setProblems({});
    setAdded({ id: result.memberId, member: result.member });
    await onAdded?.();
  };

  const err = (name: HouseholdField) =>
    problems[name] ? (
      <p className="mt-1 text-[13px] leading-snug text-red-700" role="alert">
        {problems[name]}
      </p>
    ) : null;

  return (
    <section className="card p-5" data-testid="household-form" aria-labelledby="hogar-titulo">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="hogar-titulo" className="text-[17px] font-semibold text-slate-900">
            {t(`Alguien del hogar de ${primary.firstName}`, `A household member of ${primary.firstName}'s`)}
          </h2>
          <p className="mt-0.5 text-[14px] leading-snug text-slate-500">
            {t(
              "Cónyuge, pareja o familiar. Será una persona aparte: su propia invitación, acceso, acuerdo y disputas. Nada de un caso se comparte con el otro.",
              "Spouse, partner or family member. They'll be a separate person: their own invite, login, agreement and disputes. Nothing in one case is shared with the other.",
            )}
          </p>
        </div>
        <button type="button" onClick={() => setOpen(false)} className="text-[14px] font-medium text-slate-500 hover:text-slate-900">
          {t("Cancelar", "Cancel")}
        </button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="hh-first">{t("Nombre", "First name")}</label>
          <input id="hh-first" className={field} value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="off" />
          {err("firstName")}
        </div>
        <div>
          <label className={labelClass} htmlFor="hh-last">{t("Apellido", "Last name")}</label>
          <input id="hh-last" className={field} value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="off" />
          {err("lastName")}
        </div>
        <div>
          <label className={labelClass} htmlFor="hh-phone">{t("Su WhatsApp", "Their WhatsApp")}</label>
          <input id="hh-phone" className={field} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="(713) 555-1234" />
          {err("phone")}
        </div>
        <div>
          <label className={labelClass} htmlFor="hh-email">{t("Correo (opcional)", "Email (optional)")}</label>
          <input id="hh-email" className={field} value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" autoComplete="off" />
          {err("email")}
        </div>
        <div>
          <label className={labelClass} htmlFor="hh-rel">{t("Relación", "Relationship")}</label>
          <select id="hh-rel" className={field} value={relationship} onChange={(e) => setRelationship(e.target.value as Relationship)}>
            {RELATIONSHIPS.map((r) => (
              <option key={r} value={r}>{RELATIONSHIP_LABEL[locale][r]}</option>
            ))}
          </select>
          {err("relationship")}
        </div>
        <div>
          <label className={labelClass} htmlFor="hh-lang">{t("Su idioma", "Their language")}</label>
          <select id="hh-lang" className={field} value={lang} onChange={(e) => setLang(e.target.value === "es" ? "es" : "en")}>
            <option value="en">{t("Inglés", "English")}</option>
            <option value="es">{t("Español", "Spanish")}</option>
          </select>
        </div>
      </div>
      {error && Object.keys(problems).length === 0 && (
        <p className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-[14px] text-red-700" role="alert">
          {error}
        </p>
      )}
      <p className="mt-3 text-[13px] leading-snug text-slate-500">
        {t(
          `Queda ligado a ${fullName(primary)} como hogar: el descuento de hogar del plan aplica a los dos al firmar. Pausar o cancelar sigue siendo de cada persona.`,
          `Linked to ${fullName(primary)} as a household: the plan's household discount applies to both when they sign. Pausing or cancelling stays per person.`,
        )}
      </p>
      <div className="mt-4">
        <button type="button" onClick={save} disabled={busy} className={PRIMARY_BUTTON} data-testid="household-save">
          {t("Agregar y preparar su invitación", "Add and prepare their invite")}
        </button>
      </div>
    </section>
  );
}
