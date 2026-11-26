"use client";

import { settingsOf } from "@/lib/fulfillment/notifications";
import { useTx, useStaffLocale } from "@/lib/staff/i18n/StaffLocale";
import { shortDay } from "@/lib/staff/format";
import type { StaffClient } from "@/lib/staff/types";
import { Chip, SectionTitle } from "@/components/staff/ui";

// The client's notification settings, as the client chose them in their app
// (Más → Avisos; fulfillment/notifications.ts). Read-only here: the client
// decides how we write to them. An opt-out (STOP, the email link, «Stop all»
// in the app, or a teammate's note on the autopilot card) wins over all of it.

export default function MessagesCard({ client }: { client: StaffClient }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const s = settingsOf(client);
  const on = (yes: boolean) => <Chip tone={yes ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-600"}>{yes ? t("Sí", "On") : t("No", "Off")}</Chip>;
  const opted = client.optOut;
  const rows: Array<[string, React.ReactNode]> = [
    ["WhatsApp", on(s.whatsapp)],
    [t("Correo", "Email"), on(s.email)],
    [t("Avisos de dinero y cartas", "Money and letters notices"), <Chip key="r" tone="bg-blue-50 text-blue-700">{t("Siempre", "Always")}</Chip>],
    [t("Avances del caso", "Progress updates"), on(s.updates)],
    [t("Recordatorios", "Reminders"), on(s.reminders)],
    [t("Idioma", "Language"), <span key="l" className="font-medium text-slate-900">{client.locale === "es" ? "Español" : "English"}</span>],
  ];
  return (
    <section aria-labelledby="avisos-cliente" data-testid="client-messages">
      <SectionTitle>
        <span id="avisos-cliente">{t("Avisos del cliente", "Client's notifications")}</span>
      </SectionTitle>
      <div className="card px-5 py-4">
        {opted ? (
          <p className="rounded-xl bg-red-50 px-3 py-2.5 text-[14px] leading-snug text-red-800" data-testid="client-opted-out">
            {t(
              `Pidió no recibir mensajes automáticos el ${shortDay(opted.at, "es")} (${opted.channel === "app" ? "desde la app" : opted.keyword}). No se le envía nada automático, ni los avisos obligatorios; los ve en la app.`,
              `Asked for no automatic messages on ${shortDay(opted.at, "en")} (${opted.channel === "app" ? "from the app" : opted.keyword}). Nothing automatic goes, required notices included; they see them in the app.`,
            )}
          </p>
        ) : null}
        <dl className={`${opted ? "mt-3" : ""} space-y-2 text-[14px]`}>
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-3">
              <dt className="text-slate-500">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 border-t hairline pt-3 text-xs leading-relaxed text-slate-500">
          {s.updatedAt
            ? t(`Lo eligió el cliente el ${shortDay(s.updatedAt, "es")}.`, `Chosen by the client on ${shortDay(s.updatedAt, locale)}.`)
            : t("El cliente no ha cambiado nada: todos los canales y mensajes.", "The client hasn't changed anything: every channel and message.")}{" "}
          {t(
            "Lo cambia el cliente en su app (Más → Avisos). Nunca SMS; nada entre 9 p.m. y 8 a.m.",
            "The client changes it in their app (More → Notifications). Never SMS; nothing between 9 p.m. and 8 a.m.",
          )}
        </p>
      </div>
    </section>
  );
}
