"use client";

import { useCallback, useEffect, useState } from "react";
import { SectionTitle } from "@/components/staff/ui";
import { buildDemoPartners } from "@/lib/partners/demo";
import { teamNoteProblems, type TeamNote } from "@/lib/partners/portal";
import { addDemoNote, demoThread, staffAuthorLine } from "@/lib/partners/portalDemo";
import { partnerDisplay } from "@/lib/partners/sharing";
import { demoShares } from "@/lib/partners/sharingDemo";
import type { StaffPartnerThread } from "@/lib/partners/portalServer";
import type { ReplyProblem } from "@/lib/staff/conversation";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import type { StaffClient } from "@/lib/staff/types";
import type { Viewer } from "@/lib/staff/permissions";
import { isDemoMode } from "@/lib/supabase/config";

// "Notes with the partner" on a client's page in the console (migration
// 0033): the notes a referral partner wrote to the team about this client,
// and the team's replies, while the client shares their progress with that
// partner. A reply goes through the same guardrails as the partner's note (no
// promises, no credit data). The client never sees this thread; to tell the
// client something, write in their conversation.

export default function PartnerThreadCard({ client, viewer, canWrite }: { client: StaffClient; viewer: Viewer | null; canWrite: boolean }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const demo = isDemoMode();
  const [threads, setThreads] = useState<StaffPartnerThread[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [problems, setProblems] = useState<Record<string, ReplyProblem[]>>({});
  const [state, setState] = useState<Record<string, "idle" | "sending" | "sent" | "error">>({});

  const load = useCallback(async () => {
    if (demo) {
      const now = new Date();
      const partners = buildDemoPartners(now);
      const shares = demoShares([client], now).filter((s) => s.clientId === client.id);
      setThreads(
        shares.map((s) => {
          const partner = partners.find((p) => p.id === s.partnerId);
          return { partnerId: s.partnerId, partnerName: partner ? partnerDisplay(partner) : s.partnerId, notes: demoThread(client.id, s.partnerId, now), sharing: true };
        }),
      );
      return;
    }
    const res = await fetch(`/api/staff/partner-notes?client=${encodeURIComponent(client.id)}`, { cache: "no-store" }).catch(() => null);
    const body = res?.ok ? ((await res.json()) as { threads?: StaffPartnerThread[] }) : null;
    setThreads(body?.threads ?? []);
  }, [demo, client]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!threads || threads.length === 0) return null;

  const reply = async (partnerId: string) => {
    const text = (drafts[partnerId] ?? "").trim();
    if (text.length < 2) return;
    const found = teamNoteProblems(text, locale);
    setProblems((p) => ({ ...p, [partnerId]: found }));
    if (found.length > 0) return;
    setState((s) => ({ ...s, [partnerId]: "sending" }));
    if (demo) {
      const first = (viewer?.name ?? "Marta Leal").split(" ")[0] ?? "Marta";
      addDemoNote(client.id, partnerId, { authorKind: "staff", authorFirstName: first, authorRole: viewer?.role ?? "specialist", body: text });
    } else {
      const res = await fetch("/api/staff/partner-notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: client.id, partnerId, text, locale }) }).catch(() => null);
      if (!res?.ok) {
        const body = res ? ((await res.json().catch(() => ({}))) as { problems?: ReplyProblem[] }) : {};
        if (body.problems?.length) setProblems((p) => ({ ...p, [partnerId]: body.problems! }));
        setState((s) => ({ ...s, [partnerId]: body.problems?.length ? "idle" : "error" }));
        return;
      }
    }
    setDrafts((d) => ({ ...d, [partnerId]: "" }));
    setState((s) => ({ ...s, [partnerId]: "sent" }));
    await load();
  };

  const when = (iso: string) => new Date(iso).toLocaleString(locale === "es" ? "es-MX" : "en-US", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

  return (
    <section aria-labelledby="socio-notas" data-testid="staff-partner-thread">
      <SectionTitle>
        <span id="socio-notas">{t("Notas con el socio", "Notes with the partner")}</span>
      </SectionTitle>
      <div className="space-y-4">
        {threads.map((thread) => (
          <div key={thread.partnerId} className="card px-5 py-4">
            <p className="text-[14px] font-semibold text-slate-900">{thread.partnerName}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
              {t(
                "Solo el socio y el equipo ven estas notas, mientras el cliente comparte su avance con este socio. El cliente no las ve: para decirle algo, escríbele en su conversación.",
                "Only the partner and the team see these notes, while the client shares their progress with this partner. The client does not see them: to tell the client something, write in their conversation.",
              )}
            </p>
            <ol className="mt-3 space-y-2.5">
              {thread.notes.length === 0 && <li className="text-[14px] text-slate-500">{t("Sin notas todavía.", "No notes yet.")}</li>}
              {thread.notes.map((n: TeamNote) => (
                <li key={n.id} className={`rounded-2xl px-3.5 py-2.5 ${n.authorKind === "partner" ? "bg-amber-50" : "bg-slate-50"}`}>
                  <p className="text-xs font-semibold text-slate-600">
                    {n.authorKind === "partner" ? t(`Socio · ${n.authorFirstName}`, `Partner · ${n.authorFirstName}`) : staffAuthorLine(n, locale)} · {when(n.at)}
                  </p>
                  <p className="mt-0.5 whitespace-pre-line break-words text-[14px] leading-snug text-slate-800">{n.body}</p>
                </li>
              ))}
            </ol>
            {canWrite && thread.sharing ? (
              <div className="mt-3">
                <label htmlFor={`reply-${thread.partnerId}`} className="sr-only">
                  {t("Responder al socio", "Reply to the partner")}
                </label>
                <textarea
                  id={`reply-${thread.partnerId}`}
                  value={drafts[thread.partnerId] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [thread.partnerId]: e.target.value }))}
                  rows={2}
                  maxLength={1500}
                  placeholder={t("Responde al socio. Solo pasos y fechas: sin promesas ni datos de crédito.", "Reply to the partner. Steps and dates only: no promises and no credit data.")}
                  className="w-full resize-y rounded-2xl bg-slate-50 px-3.5 py-2.5 text-[15px] text-slate-900 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-blue-300"
                />
                {(problems[thread.partnerId] ?? []).length > 0 && (
                  <ul className="mt-2 list-disc space-y-0.5 rounded-2xl bg-amber-50 px-4 py-2.5 pl-8 text-[13px] text-blue-900" role="alert">
                    {problems[thread.partnerId]!.map((p) => (
                      <li key={`${p.phrase}-${p.why}`}>
                        «{p.phrase}»: {p.why}
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  onClick={() => reply(thread.partnerId)}
                  disabled={(drafts[thread.partnerId] ?? "").trim().length < 2 || state[thread.partnerId] === "sending"}
                  className="pressable mt-2 flex h-11 w-full items-center justify-center rounded-full bg-blue-900 text-[14px] font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500"
                >
                  {state[thread.partnerId] === "sending" ? t("Enviando…", "Sending…") : t("Responder al socio", "Reply to the partner")}
                </button>
                {state[thread.partnerId] === "sent" && <p className="mt-2 text-[13px] text-green-700" role="status">{t("Enviado. El socio lo ve en la página de este cliente.", "Sent. The partner sees it on this client's page.")}</p>}
                {state[thread.partnerId] === "error" && <p className="mt-2 text-[13px] text-red-600" role="alert">{t("No se pudo enviar. Inténtalo de nuevo.", "It could not be sent. Please try again.")}</p>}
              </div>
            ) : !thread.sharing ? (
              <p className="mt-3 text-xs text-slate-500">{t("El cliente ya no comparte con este socio: no se puede responder.", "The client no longer shares with this partner: no reply can go.")}</p>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
