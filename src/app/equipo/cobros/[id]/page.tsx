"use client";

import { use, useMemo } from "react";
import Link from "next/link";
import { resolveTerms } from "@/lib/agreement/terms";
import { evidenceHtml, evidencePack } from "@/lib/billing/evidence";
import { BRAND } from "@/lib/brand";
import { deniedReason } from "@/lib/staff/permissions";
import { useStaff } from "@/lib/staff/useStaff";
import { useTx } from "@/lib/staff/i18n/StaffLocale";
import Icon from "@/components/Icon";
import ChargebackForm from "@/components/staff/ChargebackForm";
import { NoAccess, PRIMARY_BUTTON, SECONDARY_BUTTON, BACK_LINK } from "@/components/staff/ui";

// The chargeback evidence pack for one charge, generated from the records in
// one click: the signed agreement (version, hash, time, IP), the plan
// snapshot, the payment authorization accepted, the exact work the charge
// paid for (letters, dates, recipients, tracking and delivery), the receipt
// and the messages to the client about it. "Print / Save as PDF" puts it on
// paper; "Download" saves the same page as a file to attach to the
// processor's dispute form. In English: processors read English.

export default function EvidencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const chargeId = decodeURIComponent(id);
  const { ready, clients, can, locale, data, reload } = useStaff();
  const t = useTx();
  const client = clients.find((c) => c.billing.charges.some((ch) => ch.id === chargeId)) ?? null;
  const pack = useMemo(() => {
    if (!client) return null;
    const terms = resolveTerms();
    return evidencePack(client, chargeId, { legalName: terms.companyLegalName ?? BRAND.name, email: terms.companyEmail });
  }, [client, chargeId]);

  if (!ready) return null;
  if (!can("billing.plans")) return <NoAccess title={t("Evidencia", "Evidence")} reason={deniedReason("billing.plans", locale)} />;
  if (!pack) {
    return (
      <main className="animate-rise">
        <p className="text-[15px] text-slate-600">{t("No encontramos ese cobro.", "We couldn't find that charge.")}</p>
      </main>
    );
  }

  const download = () => {
    const url = URL.createObjectURL(new Blob([evidenceHtml(pack)], { type: "text/html;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${pack.invoice}-evidence.html`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <main className="animate-rise" data-testid="evidence-pack">
      <style>{`@media print { header, nav, .no-print, [data-testid="tour-bar"] { display: none !important; } body { background: #fff !important; } }`}</style>
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Link href="/equipo/cobros" className={BACK_LINK}>
          <Icon name="chevron" size={16} className="rotate-180" />
          {t("Facturas", "Invoices")}
        </Link>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={PRIMARY_BUTTON} onClick={() => window.print()}>
            {t("Imprimir / Guardar como PDF", "Print / Save as PDF")}
          </button>
          <button type="button" className={SECONDARY_BUTTON} onClick={download}>
            <Icon name="download" size={18} className="mr-1.5" />
            {t("Descargar", "Download")}
          </button>
          {!data.demo && (
            <a className={SECONDARY_BUTTON} href={`/api/staff/billing/evidence?charge=${encodeURIComponent(chargeId)}`} target="_blank" rel="noreferrer">
              {t("Versión del servidor", "Server copy")}
            </a>
          )}
        </div>
      </div>
      <p className="no-print mt-3 max-w-3xl text-[13px] leading-snug text-slate-500">
        {t(
          "Generado de los registros; nada se escribe a mano. En inglés, que es lo que lee el procesador. Adjúntalo a la respuesta del contracargo en el portal del procesador.",
          "Generated from the records; nothing is typed by hand. In English, which is what the processor reads. Attach it to the chargeback response in the processor's portal.",
        )}
      </p>

      {(() => {
        const charge = client?.billing.charges.find((c) => c.id === chargeId);
        if (!client || !charge?.chargedAt || charge.chargeback) return null;
        return (
          <div className="no-print mt-3">
            <ChargebackForm row={{ clientId: client.id, chargeId }} onDone={reload} />
          </div>
        );
      })()}
      <article className="card mt-4 px-6 py-6" lang="en">
        <h1 className="text-[22px] font-semibold text-slate-900">{pack.title}</h1>
        <p className="mt-1 break-all text-[12.5px] text-slate-500">
          Generated {new Date(pack.generatedAt).toLocaleString("en-US", { dateStyle: "long", timeStyle: "short", timeZone: "America/Chicago" })} · SHA-256 {pack.hash}
        </p>
        {pack.sections.map((s) => (
          <section key={s.heading} className="mt-5">
            <h2 className="border-b hairline pb-1 text-[15px] font-semibold text-slate-900">{s.heading}</h2>
            <dl className="mt-2 grid grid-cols-[minmax(0,13rem)_minmax(0,1fr)] gap-x-4 gap-y-1 text-[13.5px]">
              {s.rows.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="font-medium text-slate-500">{k}</dt>
                  <dd className="break-words text-slate-900">{v}</dd>
                </div>
              ))}
            </dl>
            {s.items && s.items.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-[13.5px] leading-snug text-slate-800">
                {s.items.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            )}
            {s.note && <p className="mt-2 text-[12.5px] leading-snug text-slate-500">{s.note}</p>}
          </section>
        ))}
      </article>
    </main>
  );
}
