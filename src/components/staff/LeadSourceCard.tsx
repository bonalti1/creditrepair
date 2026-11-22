import { CHANNEL_LABEL, type LeadSource } from "@/lib/leads/source";
import { shortDateTime } from "@/lib/staff/format";
import { SectionTitle } from "./ui";

// Where the person came from, on their page in the console: HighLevel (with
// the campaign and UTM tags), a referral partner, or added by hand; the
// consent they gave on the form; and when the invitation went out. Marketing
// tags only (migration 0017).

export default function LeadSourceCard({ source }: { source: LeadSource | null | undefined }) {
  if (!source) return null;
  const utm = source.utm ? Object.entries(source.utm).filter(([, v]) => v) : [];
  const rows: Array<[string, string]> = [
    ["Llegó por", CHANNEL_LABEL[source.channel]],
    ...(source.campaign ? ([["Campaña", source.campaign]] as Array<[string, string]>) : []),
    ...(utm.length > 0 ? ([["UTM", utm.map(([k, v]) => `${k}: ${v}`).join(" · ")]] as Array<[string, string]>) : []),
    ...(source.partnerId ? ([["Socio", source.partnerName ?? source.partnerCode ?? "Socio referidor"]] as Array<[string, string]>) : []),
    ...(source.highlevelContactId ? ([["Contacto en HighLevel", source.highlevelContactId]] as Array<[string, string]>) : []),
    ...(source.invitedAt ? ([["Invitación enviada", shortDateTime(source.invitedAt)]] as Array<[string, string]>) : []),
  ];
  return (
    <section aria-labelledby="origen" data-testid="lead-source-card">
      <SectionTitle>
        <span id="origen">Origen</span>
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
              Consentimiento{source.consentAt ? ` · ${shortDateTime(source.consentAt)}` : ""}
            </summary>
            <p className="mt-2 text-[13px] leading-relaxed text-slate-600">«{source.consentText}»</p>
          </details>
        )}
      </div>
    </section>
  );
}
