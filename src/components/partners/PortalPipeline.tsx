"use client";

import Link from "next/link";
import { useState } from "react";
import { careLine, shareAskState } from "@/lib/partners/portal";
import { PORTAL_COPY } from "@/lib/partners/portalCopy";
import { PARTNER_COPY } from "@/lib/partners/copy";
import { pipelineCounts, PIPELINE_STAGES, REFERRAL_STATUS_LABEL, type PartnerReferral, type ReferralStatus } from "@/lib/partners/rules";
import { partnerStage, SHARE_LEVEL_LABEL, type L, type PartnerProgress } from "@/lib/partners/sharing";
import { caseDay } from "@/lib/case/timeline";
import Icon from "@/components/Icon";
import { StageChip } from "./ClientProgressView";

// The portal's dashboard: the pipeline (Referred → Contacted → Signed →
// Active → Finished), a count per step, and the list of the partner's people.
// Each row shows only what that person lets the partner see: the coarse step
// by default ("Don't share"), and, when they share, their name, their stage in
// words and a link to their page. Who on the team looks after them and when
// sales reached out are the team's own facts. "Ask to follow progress" sends
// the person a request they answer in their own app (migration 0033).

export const STATUS_TONE: Record<ReferralStatus, string> = {
  referred: "bg-slate-100 text-slate-700",
  contacted: "bg-blue-50 text-blue-700",
  signed: "bg-amber-100 text-blue-900",
  active: "bg-green-50 text-green-700",
  finished: "bg-blue-900 text-white",
  not_continued: "bg-slate-100 text-slate-500",
};

export function dayLabel(iso: string, locale: L): string {
  return new Date(iso).toLocaleDateString(locale === "es" ? "es-MX" : "en-US", { day: "numeric", month: "short" });
}

export function dateTimeLabel(iso: string, locale: L): string {
  return new Date(iso).toLocaleString(locale === "es" ? "es-MX" : "en-US", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

type Filter = ReferralStatus | "all";

export default function PortalPipeline({
  locale,
  referrals,
  clients,
  now,
  onAsk,
}: {
  locale: L;
  referrals: PartnerReferral[];
  /** The clients who share with the partner now (partner_clients()). */
  clients: PartnerProgress[];
  now: Date;
  onAsk: (referralId: string) => Promise<boolean>;
}) {
  const c = PORTAL_COPY[locale];
  const portal = PARTNER_COPY[locale].portal;
  const [filter, setFilter] = useState<Filter>("all");
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const counts = pipelineCounts(referrals);
  const byClient = new Map(clients.map((p) => [p.clientId, p]));
  const linked = new Set(referrals.map((r) => r.sharedClientId).filter(Boolean));
  // Clients who added the partner by code are not referrals: listed under "Everyone".
  const extra = clients.filter((p) => !linked.has(p.clientId));
  const shown = filter === "all" ? referrals : referrals.filter((r) => r.status === filter);
  const total = referrals.length;

  const ask = async (id: string) => {
    setBusy(true);
    setFailed(null);
    const ok = await onAsk(id);
    setBusy(false);
    if (ok) setAsking(null);
    else setFailed(id);
  };

  return (
    <div className="space-y-6">
      <section aria-labelledby="pipeline" data-testid="partner-pipeline">
        <h2 id="pipeline" className="px-1 text-[13px] font-semibold uppercase tracking-wide text-slate-500">
          {c.pipelineTitle} · {total}
        </h2>
        <p className="px-1 pb-2 text-[13px] leading-snug text-slate-500">{c.pipelineHelp}</p>
        <ol className="grid grid-cols-5 gap-1.5 sm:gap-2" role="list">
          {PIPELINE_STAGES.map((stage, i) => {
            const pressed = filter === stage;
            return (
              <li key={stage} className="relative min-w-0">
                <button
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => setFilter(pressed ? "all" : stage)}
                  className={`pressable flex h-full w-full flex-col items-center justify-center rounded-2xl px-1 py-3 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 sm:py-4 ${
                    pressed ? "bg-blue-900 text-white" : "card text-slate-900 hover:bg-slate-50"
                  }`}
                  data-testid={`stage-${stage}`}
                >
                  <span className="text-[24px] font-semibold leading-none tabular-nums sm:text-[30px]">{counts[stage]}</span>
                  <span className={`mt-1.5 block w-full text-[10.5px] font-semibold leading-tight tracking-tight sm:text-[13px] sm:tracking-normal ${pressed ? "text-blue-100" : "text-slate-600"}`}>
                    {REFERRAL_STATUS_LABEL[locale][stage]}
                  </span>
                </button>
                {i < PIPELINE_STAGES.length - 1 && (
                  <span aria-hidden="true" className="pointer-events-none absolute -right-[7px] top-1/2 z-10 hidden -translate-y-1/2 text-slate-300 sm:block">
                    <Icon name="chevron" size={14} />
                  </span>
                )}
              </li>
            );
          })}
        </ol>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-[13px] text-slate-500">
          <span>{counts.not_continued > 0 ? c.notContinued(counts.not_continued) : ""}</span>
          {filter !== "all" && (
            <button type="button" onClick={() => setFilter("all")} className="font-medium text-blue-700 underline-offset-2 hover:underline">
              {c.all}
            </button>
          )}
        </div>
      </section>

      <section aria-labelledby="people" data-testid="partner-people">
        <h2 id="people" className="px-1 text-[13px] font-semibold uppercase tracking-wide text-slate-500">
          {c.peopleTitle} · {filter === "all" ? total + extra.length : shown.length}
          {filter !== "all" && ` · ${REFERRAL_STATUS_LABEL[locale][filter]}`}
        </h2>
        <p className="px-1 pb-2 text-[13px] leading-snug text-slate-500">{c.peopleHelp}</p>
        <ul className="card overflow-hidden" aria-live="polite">
          {shown.length === 0 && (filter !== "all" || extra.length === 0) && <li className="px-5 py-5 text-[14px] text-slate-500">{c.peopleEmpty}</li>}
          {shown.map((r, i) => {
            const progress = r.sharedClientId ? byClient.get(r.sharedClientId) ?? null : null;
            const state = shareAskState(r, now);
            const name = progress?.name || `${r.firstName}${r.lastInitial ? ` ${r.lastInitial}.` : ""}`;
            const stage = progress ? partnerStage(progress, locale, now) : null;
            return (
              <li key={r.id} className={`px-4 py-4 sm:px-5 ${i > 0 ? "border-t hairline" : ""}`} data-testid="person-row">
                <div className="flex items-start gap-3">
                  <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[15px] font-semibold text-blue-700">
                    {name.slice(0, 1)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 text-[16px] font-semibold leading-tight text-slate-900">{name}</p>
                      <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_TONE[r.status]}`}>{REFERRAL_STATUS_LABEL[locale][r.status]}</span>
                    </div>
                    <p className="mt-1 text-[14px] leading-snug text-slate-700">{stage ? stage.sentence : portal.statusMeaning[r.status]}</p>
                    <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-slate-600" data-testid="care-line">
                      <Icon name="person" size={15} className="shrink-0 text-slate-400" />
                      <span className="min-w-0">{r.care ? careLine(r.care, locale) : c.careNone}</span>
                    </p>
                    <p className="mt-0.5 text-[12.5px] text-slate-500">
                      {c.referredOn(dayLabel(r.referredAt, locale))}
                      {" · "}
                      {r.contactedAt ? (
                        <span data-testid="contacted-at">{c.contactedAt(dateTimeLabel(r.contactedAt, locale))}</span>
                      ) : r.status === "referred" ? (
                        c.waitingContact
                      ) : (
                        c.byLink
                      )}
                    </p>
                    <div className="mt-2.5">
                      {state === "sharing" && r.sharedClientId && (
                        <Link
                          href={`/socios/portal/cliente/${r.sharedClientId}`}
                          className="pressable inline-flex min-h-11 items-center gap-2 rounded-full bg-blue-50 px-4 text-[14px] font-semibold text-blue-700 hover:bg-blue-100"
                        >
                          {progress ? c.shares(SHARE_LEVEL_LABEL[locale][progress.level]) : c.open}
                          {stage?.next ? <span className="font-normal text-blue-700/80">· {stage.next.label} {caseDay(stage.next.at, locale)}</span> : null}
                          <Icon name="chevron" size={15} />
                        </Link>
                      )}
                      {state === "requested" && r.shareRequestedAt && (
                        <p className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-[13px] font-medium text-slate-700" data-testid="requested-on">
                          <Icon name="clock" size={14} className="text-slate-500" />
                          {c.requestedOn(dayLabel(r.shareRequestedAt, locale))} · {c.sharesStep}
                        </p>
                      )}
                      {state === "no_account" && <p className="text-[13px] text-slate-500">{c.sharesStep} · {c.noAccount}</p>}
                      {state === "can_ask" && asking !== r.id && (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                          <span className="text-[13px] text-slate-500">{c.sharesStep}</span>
                          <button
                            type="button"
                            onClick={() => setAsking(r.id)}
                            className="pressable inline-flex min-h-11 items-center gap-1.5 rounded-full border border-blue-200 px-4 text-[14px] font-semibold text-blue-700 hover:bg-blue-50"
                            data-testid="ask-share"
                          >
                            <Icon name="chat" size={15} />
                            {c.ask}
                          </button>
                        </div>
                      )}
                      {state === "can_ask" && asking === r.id && (
                        <div className="rounded-2xl bg-slate-50 p-4" role="group" aria-labelledby={`ask-${r.id}`} data-testid="ask-confirm">
                          <p id={`ask-${r.id}`} className="text-[15px] font-semibold text-slate-900">{c.askTitle(r.firstName)}</p>
                          <p className="mt-1 text-[13.5px] leading-snug text-slate-600">{c.askBody}</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button type="button" disabled={busy} onClick={() => ask(r.id)} className="pressable inline-flex h-11 items-center rounded-full bg-blue-900 px-5 text-[14px] font-semibold text-white disabled:bg-slate-300">
                              {busy ? c.asking : c.askSend}
                            </button>
                            <button type="button" onClick={() => setAsking(null)} className="pressable inline-flex h-11 items-center rounded-full px-4 text-[14px] font-medium text-blue-700">
                              {c.askCancel}
                            </button>
                          </div>
                          {failed === r.id && <p className="mt-2 text-[13px] text-red-600" role="alert">{c.askError}</p>}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
          {filter === "all" &&
            extra.map((p, i) => (
              <li key={p.clientId} className={`px-4 py-4 sm:px-5 ${shown.length + i > 0 ? "border-t hairline" : ""}`} data-testid="person-row">
                <Link href={`/socios/portal/cliente/${p.clientId}`} className="flex items-start gap-3">
                  <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[15px] font-semibold text-blue-900">
                    {p.name.slice(0, 1)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0 text-[16px] font-semibold leading-tight text-slate-900">{p.name}</span>
                      <StageChip progress={p} locale={locale} now={now} />
                    </span>
                    <span className="mt-1 block text-[14px] leading-snug text-slate-700">{partnerStage(p, locale, now).sentence}</span>
                    <span className="mt-1 block text-[12.5px] text-slate-500">
                      {c.addedYou} · {c.shares(SHARE_LEVEL_LABEL[locale][p.level])}
                    </span>
                  </span>
                  <Icon name="chevron" size={18} className="mt-1 shrink-0 text-slate-300" />
                </Link>
              </li>
            ))}
        </ul>
        <p className="px-1 pt-2 text-[12.5px] leading-relaxed text-slate-500">{portal.statusHelp}</p>
      </section>
    </div>
  );
}
