"use client";

import { SectionTitle } from "@/components/staff/ui";
import { GRADUATION_REASON_LABEL } from "@/lib/aftercare/graduation";
import { partnerHomeFromProgress, partnerMilestoneLabel } from "@/lib/aftercare/homeReady";
import { PLAN_ITEMS } from "@/lib/aftercare/plan";
import { caseDay } from "@/lib/case/timeline";
import { progressFromStaffClient } from "@/lib/partners/sharing";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import type { StaffClient } from "@/lib/staff/types";

// After-care on the staff client page (docs/AFTERCARE.md): the kind of
// taxpayer number (never the number), the build-your-credit plan's marks,
// the home-ready milestones (the same dates a partner would see, with the
// client's consent), graduation and an open loan officer request.

export function ItinBadge({ client }: { client: StaffClient }) {
  const t = useTx();
  if (client.idType !== "itin") return null;
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-blue-900" data-testid="itin-client" title={t("Tiene ITIN en lugar de Seguro Social. Nunca pidas ni guardes el número.", "Has an ITIN instead of a Social Security number. Never ask for or keep the number.")}>
      {t("Cliente con ITIN", "ITIN client")}
    </span>
  );
}

export default function AftercareCard({ client, now }: { client: StaffClient; now: Date }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const marks = client.aftercareMarks ?? {};
  const planDone = PLAN_ITEMS.filter((i) => marks[i.key]?.done).length;
  const progress = progressFromStaffClient(client, { level: "progress", how: "referred", sharedAt: now.toISOString() });
  const rows = partnerHomeFromProgress(progress, marks, client.graduation?.completedAt ?? null);
  const homeGoal = client.goal === "mortgage";
  return (
    <section aria-labelledby="aftercare" data-testid="staff-aftercare">
      <SectionTitle>
        <span id="aftercare">{t("Después del servicio", "After-care")}</span>
      </SectionTitle>
      <div className="card space-y-4 px-5 py-4 text-[14px]">
        <dl className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-slate-500">{t("Número de impuestos", "Taxpayer number")}</dt>
            <dd className="font-medium text-slate-900">
              {client.idType === "itin" ? t("ITIN", "ITIN") : client.idType === "ssn" ? t("Seguro Social", "Social Security") : t("Sin respuesta", "Not answered")}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-slate-500">{t("Plan para construir crédito", "Build-your-credit plan")}</dt>
            <dd className="font-medium tabular-nums text-slate-900">{t(`${planDone} de ${PLAN_ITEMS.length} hechos`, `${planDone} of ${PLAN_ITEMS.length} done`)}</dd>
          </div>
          {client.graduation && (
            <div className="flex items-center justify-between gap-3" data-testid="staff-graduation">
              <dt className="text-slate-500">{t("Terminó el programa", "Finished the program")}</dt>
              <dd className="text-right font-medium text-slate-900">
                {caseDay(client.graduation.completedAt, locale)} · {GRADUATION_REASON_LABEL[locale][client.graduation.reason]}
              </dd>
            </div>
          )}
          {client.loanOfficerRequest && (
            <div className="flex items-start justify-between gap-3" data-testid="staff-intro">
              <dt className="text-slate-500">{t("Pidió hablar con", "Asked to talk to")}</dt>
              <dd className="text-right font-medium text-slate-900">
                {client.loanOfficerRequest.partnerName}
                <span className="block text-[12px] font-normal text-slate-500">{caseDay(client.loanOfficerRequest.at, locale)}</span>
              </dd>
            </div>
          )}
        </dl>
        {client.idType === "itin" && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-[13px] leading-snug text-blue-900">
            {t(
              "Cliente con ITIN: el monitoreo con ITIN no está confirmado con IdentityIQ; ayúdale con las opciones. Sus reportes se piden por correo. Las cartas no imprimen ningún número.",
              "ITIN client: monitoring with an ITIN is not confirmed with IdentityIQ; help them with the options. Their reports are requested by mail. Letters print no number.",
            )}
          </p>
        )}
        {(homeGoal || rows.some((r) => r.doneAt && ["positive_accounts", "savings", "loan_officer"].includes(r.milestone))) && (
          <div data-testid="staff-home-ready">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{t("Camino para comprar casa", "Home-ready milestones")}</p>
            <ol className="mt-2 space-y-1.5">
              {rows.map((r) => (
                <li key={r.milestone} className="flex items-start gap-2.5">
                  <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${r.doneAt ? "bg-blue-700" : "border-2 border-slate-300"}`} />
                  <span className="min-w-0 flex-1">
                    <span className={r.doneAt ? "text-slate-900" : "text-slate-500"}>{partnerMilestoneLabel(r.milestone, locale)}</span>
                    <span className="block text-[12px] text-slate-500">{r.doneAt ? caseDay(r.doneAt, locale) : t("Todavía no", "Not yet")}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}
