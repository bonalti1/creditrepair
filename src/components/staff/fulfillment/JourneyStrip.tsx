"use client";

import { useEffect, useRef } from "react";
import { useTx } from "@/lib/staff/i18n/StaffLocale";
import type { Stage } from "@/lib/staff/stage";
import type { StaffClient } from "@/lib/staff/types";

// Where this client is in the whole journey (docs/FULFILLMENT.md), at the top
// of their page: lead → account → agreement → documents → report → their
// review → round 1 → rounds 2+ → finished. Read from the stage and the rounds
// on record; nothing here changes anything.

export const JOURNEY_STEPS = ["lead", "account", "agreement", "documents", "report", "review", "round1", "rounds", "finished"] as const;
export type JourneyStep = (typeof JOURNEY_STEPS)[number];

/** The step the client is on, or null when they cancelled. */
export function journeyStep(client: StaffClient, stage: Stage): JourneyStep | null {
  const mailed = client.rounds.filter((r) => r.mailedAt).length;
  switch (stage) {
    case "cancelled":
      return null;
    case "graduated":
      return "finished";
    case "lead":
      return "lead";
    case "agreement_pending":
    case "cancellation_window":
      return "agreement";
    case "documents_pending":
      return "documents";
    case "report_pending":
      return "report";
    case "client_review_pending":
      return "review";
    case "ready_to_send":
      return "round1";
    default:
      return mailed <= 1 && !client.rounds.some((r) => r.status === "responded") ? "round1" : "rounds";
  }
}

export default function JourneyStrip({ client, stage }: { client: StaffClient; stage: Stage }) {
  const t = useTx();
  const label: Record<JourneyStep, string> = {
    lead: t("Prospecto", "Lead"),
    account: t("Cuenta", "Account"),
    agreement: t("Acuerdo", "Agreement"),
    documents: t("Documentos", "Documents"),
    report: t("Reporte", "Report"),
    review: t("Su revisión", "Their review"),
    round1: t("Ronda 1", "Round 1"),
    rounds: t("Rondas 2+", "Rounds 2+"),
    finished: t("Terminó", "Finished"),
  };
  const current = journeyStep(client, stage);
  const here = useRef<HTMLLIElement>(null);
  // On a phone the strip scrolls inside its own box: bring the current step into view.
  useEffect(() => {
    here.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [current]);
  if (!current) return null;
  const at = JOURNEY_STEPS.indexOf(current);
  return (
    <nav aria-label={t("El camino del cliente", "The client's journey")} className="-mx-1 overflow-x-auto px-1 sm:overflow-visible" data-testid="journey-strip">
      <ol className="flex min-w-max items-center gap-1.5 pb-1 sm:min-w-0 sm:flex-wrap">
        {JOURNEY_STEPS.map((step, i) => {
          const done = i < at;
          const now = i === at;
          return (
            <li key={step} ref={now ? here : undefined} className="flex items-center gap-1.5" aria-current={now ? "step" : undefined}>
              <span
                className={`inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12px] font-semibold ${
                  now ? "bg-blue-900 text-white" : done ? "bg-green-50 text-green-800" : "bg-slate-100 text-slate-500"
                }`}
              >
                {done && <span aria-hidden="true">✓</span>}
                {label[step]}
              </span>
              {i < JOURNEY_STEPS.length - 1 && <span aria-hidden="true" className={`h-px w-3 ${done ? "bg-green-300" : "bg-slate-200"}`} />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
