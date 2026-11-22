"use client";

import { MAIL_CLASS_LABEL, isCertified } from "@/lib/mail/classes";
import type { MailMode } from "@/lib/mail/data";
import { formatTrackingNumber, mailEventLabel, uspsTrackingUrl } from "@/lib/mail/tracking";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import type { LetterMail, MailClass } from "@/lib/mail/types";
import { shortDateTime } from "@/lib/staff/format";
import { Chip } from "@/components/staff/ui";

// Small pieces the staff screens use to show how a letter travels: its class,
// whether the send is real or simulated, the USPS tracking link and the
// letter's own tracking history.

export function MailClassChip({ mailClass }: { mailClass: MailClass }) {
  const { locale } = useStaffLocale();
  return (
    <Chip tone={isCertified(mailClass) ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600"}>
      {MAIL_CLASS_LABEL[mailClass].short[locale]}
    </Chip>
  );
}

/** Says plainly that nothing reaches a post office. */
export function SimulatedPill({ title }: { title?: string }) {
  const t = useTx();
  return (
    <span
      className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-blue-900"
      title={title ?? t("Sin clave de Lob: no sale nada por correo.", "No Lob key: nothing goes out by mail.")}
      data-testid="simulado"
    >
      {t("Simulado", "Simulated")}
    </span>
  );
}

export function MailModeNote({ mode }: { mode: MailMode }) {
  const t = useTx();
  if (mode === "lob") {
    return (
      <p className="text-[13px] leading-snug text-slate-600">
        {t("Las cartas salen por Lob, el servicio de correo, en cuanto confirmas.", "The letters go out through Lob, the mail service, as soon as you confirm.")}
      </p>
    );
  }
  return (
    <p className="flex flex-wrap items-center gap-2 text-[13px] leading-snug text-slate-600">
      <SimulatedPill />
      <span>{t("No hay clave de Lob configurada: el envío queda registrado y no sale nada por correo.", "No Lob key is set up: the send is recorded and nothing goes out by mail.")}</span>
    </p>
  );
}

export function TrackingLink({ trackingNumber }: { trackingNumber: string }) {
  return (
    <a
      href={uspsTrackingUrl(trackingNumber)}
      target="_blank"
      rel="noopener noreferrer"
      className="break-all font-mono text-[12px] font-medium text-blue-700 underline-offset-2 hover:underline"
      data-testid="tracking-link"
    >
      {formatTrackingNumber(trackingNumber)}
    </a>
  );
}

/** The letter's tracking events, oldest first, as the post office reported them. */
export function MailTimeline({ mail }: { mail: LetterMail }) {
  const { locale } = useStaffLocale();
  if (mail.events.length === 0) return null;
  return (
    <ol className="mt-2 space-y-1 border-l-2 border-slate-200 pl-3" data-testid="mail-timeline">
      {mail.events.map((event) => (
        <li key={event.id} className="text-[13px] leading-snug">
          <span
            className={
              event.status === "delivered"
                ? "font-medium text-green-700"
                : event.status === "returned" || event.status === "undeliverable"
                  ? "font-medium text-red-700"
                  : "text-slate-700"
            }
          >
            {mailEventLabel(event, locale)}
          </span>
          <span className="text-slate-500">
            {" "}
            · {shortDateTime(event.at, locale)}
            {event.location ? ` · ${event.location}` : ""}
          </span>
        </li>
      ))}
    </ol>
  );
}
