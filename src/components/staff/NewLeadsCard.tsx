"use client";

import Link from "next/link";
import { sourceLine } from "@/lib/leads/source";
import { relativeDay } from "@/lib/staff/format";
import { clientStage } from "@/lib/staff/stage";
import { fullName, type StaffClient } from "@/lib/staff/types";
import { SectionTitle } from "./ui";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";

// On the team's home: people who arrived by themselves in the last week, from
// a HighLevel workflow or a referral partner, and still have no account. Each
// opens the person's page, where "Preparar su invitación" is one click.

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export default function NewLeadsCard({ clients, now, canInvite }: { clients: StaffClient[]; now: Date; canInvite: boolean }) {
  const { locale } = useStaffLocale();
  const t = useTx();
  const fresh = clients
    .filter((c) => (c.leadSource?.channel === "highlevel" || c.leadSource?.channel === "partner") && clientStage(c, now) === "lead")
    .filter((c) => now.getTime() - new Date(c.createdAt).getTime() <= WEEK_MS)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (fresh.length === 0) return null;
  return (
    <section aria-labelledby="nuevos" data-testid="new-leads">
      <SectionTitle aside={<span className="text-[13px] tabular-nums text-slate-500">{fresh.length}</span>}>
        <span id="nuevos">{t("Llegaron solos esta semana", "Came in on their own this week")}</span>
      </SectionTitle>
      <div className="card px-5 py-4">
        <ul className="space-y-3">
          {fresh.slice(0, 5).map((client) => (
            <li key={client.id} className="flex items-start justify-between gap-3 text-[13px] leading-snug">
              <span className="min-w-0">
                <Link href={`/equipo/clientes/${client.id}`} className="font-medium text-slate-900 underline-offset-2 hover:underline">
                  {fullName(client)}
                </Link>
                <span className="block text-blue-700">{sourceLine(client.leadSource, locale)}</span>
                <span className="block text-slate-500">
                  {t("Llegó", "Arrived")} {relativeDay(client.createdAt, now, locale)}
                </span>
              </span>
              {canInvite && (
                <Link href={`/equipo/invitar?cliente=${client.id}`} className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-blue-50 px-3 text-[13px] md:min-h-0 md:py-1.5 font-semibold text-blue-700 hover:bg-blue-100">
                  {t("Invitar", "Invite")}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
