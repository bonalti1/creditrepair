"use client";

import { CHANNEL_LABEL, CHANNEL_LABEL_EN, type LeadSource } from "@/lib/leads/source";
import { shortDateTime } from "@/lib/staff/format";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { SectionTitle } from "./ui";

// Where the person came from, on their page in the console: HighLevel (with
// the campaign and UTM tags), a referral partner, or added by hand; the
// consent they gave on the form; and when the invitation went out. Marketing
// tags only (migration 0017).

export default function LeadSourceCard({ source }: { source: LeadSource | null | undefined }) {
  const { locale } = useStaffLocale();
  const t = useTx();
  if (!source) return null;
  const utm = source.utm ? Object.entries(source.utm).filter(([, v]) => v) : [];
  const rows: Array<[string, string]> = [
    [t("Llegó por", "Came in through"), t(CHANNEL_LABEL[source.channel], CHANNEL_LABEL_EN[source.channel])],
    ...(source.campaign ? ([[t("Campaña", "Campaign"), source.campaign]] as Array<[string, string]>) : []),
    ...(utm.length > 0 ? ([["UTM", utm.map(([k, v]) => `${k}: ${v}`).join(" · ")]] as Array<[string, string]>) : []),
    ...(source.partnerId ? ([[t("Socio", "Partner"), source.partnerName ?? source.partnerCode ?? t("Socio referidor", "Referring partner")]] as Array<[string, string]>) : []),
    ...(source.highlevelContactId ? ([[t("Contacto en HighLevel", "HighLevel contact"), source.highlevelContactId]] as Array<[string, string]>) : []),
    ...(source.invitedAt ? ([[t("Invitación enviada", "Invite sent"), shortDateTime(source.invitedAt, locale)]] as Array<[string, string]>) : []),
  ];
  return (
    <section aria-labelledby="origen" data-testid="lead-source-card">
      <SectionTitle>
        <span id="origen">{t("Origen", "Source")}</span>
      </SectionTitle>
      <div className="card px-5 py-4">
        <dl className="space-y-2 text-[14px]">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-start justify-between gap-3">
              <dt className="shrink-0 text-slate-500">{k}</dt>
              <dd className="min-w-0 break-words text-right font-medium text-slate-900">{v}</dd>
            </div>
          ))}
        </dl>
        {source.consentText && (
          <details className="mt-3 border-t hairline pt-3">
            <summary className="cursor-pointer text-[13px] font-medium text-blue-700">
              {t("Consentimiento", "Consent")}
              {source.consentAt ? ` · ${shortDateTime(source.consentAt, locale)}` : ""}
            </summary>
            <p className="mt-2 text-[13px] leading-relaxed text-slate-600">«{source.consentText}»</p>
          </details>
        )}
      </div>
    </section>
  );
}
