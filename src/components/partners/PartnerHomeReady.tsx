"use client";

import { caseDay } from "@/lib/case/timeline";
import { partnerMilestoneLabel, type PartnerHomeRow } from "@/lib/aftercare/homeReady";

// The home-ready milestones a partner sees, when the client chose to share
// them (partner_home_ready(), migration 0030): each step's name and the day it
// was done. Never a score, an account or anything from the report.

type L = "es" | "en";

export default function PartnerHomeReady({ rows, locale, title }: { rows: readonly PartnerHomeRow[]; locale: L; title?: string }) {
  const es = locale === "es";
  const done = rows.filter((r) => r.doneAt && r.milestone !== "graduated").length;
  return (
    <section className="card p-5" aria-labelledby="home-ready-title" data-testid="partner-home-ready">
      <h3 id="home-ready-title" className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">
        {title ?? (es ? "Pasos para comprar casa" : "Home-buying milestones")}
      </h3>
      <p className="mt-1 text-[15px] text-slate-800">{es ? `${done} de 6 pasos hechos.` : `${done} of 6 milestones done.`}</p>
      <ol className="mt-3 space-y-2">
        {rows.map((r) => (
          <li key={r.milestone} className="flex items-start gap-3">
            <span aria-hidden="true" className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${r.doneAt ? "bg-blue-700" : "border-2 border-slate-300 bg-white"}`} />
            <span className="min-w-0 flex-1">
              <span className={`block text-[15px] leading-snug ${r.doneAt ? "text-slate-900" : "text-slate-500"}`}>{partnerMilestoneLabel(r.milestone, locale)}</span>
              <span className="block text-[12.5px] text-slate-500">{r.doneAt ? caseDay(r.doneAt, locale) : es ? "Todavía no" : "Not yet"}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-[12.5px] leading-relaxed text-slate-500">
        {es
          ? "El cliente eligió compartir estos pasos. Los marcados «lo marca el cliente» son su propia respuesta. No es información de crédito: no la uses para decidir un préstamo."
          : "The client chose to share these milestones. Those marked as the client's own mark are their own answer. This is not credit information: do not use it to decide on a loan."}
      </p>
    </section>
  );
}
