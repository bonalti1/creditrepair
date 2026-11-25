"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLocale } from "@/lib/i18n";
import { useCase } from "@/lib/case/useCase";
import { DEMO_PORTAL_PARTNER } from "@/lib/partners/demo";
import { CARE_ROLE_LABEL, careLine, teamNoteProblems, TEAM_PROMISE, type TeamNote } from "@/lib/partners/portal";
import { PORTAL_COPY } from "@/lib/partners/portalCopy";
import { addDemoNote, DEMO_ME, demoClientCare, demoThread } from "@/lib/partners/portalDemo";
import type { CareTeamMember } from "@/lib/partners/rules";
import { progressFromCaseFacts, type PartnerProgress } from "@/lib/partners/sharing";
import { PARTNER_SHARING_COPY } from "@/lib/partners/sharingCopy";
import { demoPartnerClients, demoPartnerHomeReady, readDemoClientSharing } from "@/lib/partners/sharingDemo";
import type { PartnerHomeRow } from "@/lib/aftercare/homeReady";
import type { ReplyProblem } from "@/lib/staff/conversation";
import PartnerHomeReady from "./PartnerHomeReady";
import { getStaffData } from "@/lib/staff/data";
import { isDemoMode } from "@/lib/supabase/config";
import Icon from "@/components/Icon";
import LocaleToggle from "@/components/LocaleToggle";
import Logo from "@/components/Logo";
import ClientProgressView from "./ClientProgressView";
import { dateTimeLabel } from "./PortalPipeline";

// One client's page in the partner portal: the stage, what comes next, the
// milestone dates and, at the "summary" level, the two counts; who on the team
// takes care of them and the team's promise; and the notes between the
// partner and the team about this client, both ways (migration 0033). With a
// database it is GET /api/partners/clients/<id>, which the database limits
// and logs as a view the client can see. The client never sees the notes.

export default function PartnerClientContent({ id }: { id: string }) {
  return isDemoMode() && id === DEMO_ME ? <DeviceClient /> : <ClientPage id={id} deviceProgress={null} />;
}

/** Demo only: this device's own case, as the partner who referred it would see it (the demo portal's "you"). */
function DeviceClient() {
  const { locale } = useLocale();
  const kase = useCase(locale);
  const [now] = useState(() => new Date());
  const progress = useMemo<PartnerProgress | null>(() => {
    const level = readDemoClientSharing().levels[DEMO_PORTAL_PARTNER] ?? "none";
    if (level === "none") return null;
    let name = "Rosa Martínez";
    try {
      name = window.localStorage.getItem("bonalti.inviteName") || name;
    } catch {
      // ignore
    }
    const since = readDemoClientSharing().history.find((h) => h.partnerId === DEMO_PORTAL_PARTNER && h.previousLevel === "none")?.at ?? now.toISOString();
    return progressFromCaseFacts(kase.facts, { clientId: DEMO_ME, name, goal: "mortgage", level, sharedAt: since });
  }, [kase.facts, now]);
  return <ClientPage id={DEMO_ME} deviceProgress={progress} />;
}

function ClientPage({ id, deviceProgress }: { id: string; deviceProgress: PartnerProgress | null }) {
  const { locale } = useLocale();
  const s = PARTNER_SHARING_COPY[locale];
  const p = PORTAL_COPY[locale];
  const demo = isDemoMode();
  const [client, setClient] = useState<PartnerProgress | null | "missing">(null);
  const [homeReady, setHomeReady] = useState<PartnerHomeRow[]>([]);
  const [care, setCare] = useState<CareTeamMember | null>(null);
  const [thread, setThread] = useState<TeamNote[]>([]);
  const [now] = useState(() => new Date());
  const [text, setText] = useState("");
  const [send, setSend] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [problems, setProblems] = useState<ReplyProblem[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (demo) {
        if (id === DEMO_ME) {
          if (!cancelled) {
            setClient(deviceProgress ?? "missing");
            setCare(demoClientCare(null, new Date()));
            setThread(demoThread(DEMO_ME, DEMO_PORTAL_PARTNER));
          }
          return;
        }
        const clients = await getStaffData().listClients();
        const found = demoPartnerClients(DEMO_PORTAL_PARTNER, clients, new Date()).find((c) => c.clientId === id);
        const record = clients.find((c) => c.id === id) ?? null;
        if (!cancelled) {
          setClient(found ?? "missing");
          setHomeReady(found && record ? demoPartnerHomeReady(DEMO_PORTAL_PARTNER, record, found) : []);
          setCare(found ? demoClientCare(record, new Date()) : null);
          setThread(found ? demoThread(id, DEMO_PORTAL_PARTNER) : []);
        }
        return;
      }
      const res = await fetch(`/api/partners/clients/${encodeURIComponent(id)}`, { cache: "no-store" }).catch(() => null);
      if (res?.status === 403) return window.location.assign("/socios/portal");
      const body = res?.ok ? ((await res.json()) as { client: PartnerProgress; homeReady?: PartnerHomeRow[]; care?: CareTeamMember | null; thread?: TeamNote[] }) : null;
      if (!cancelled) {
        setClient(body?.client ?? "missing");
        setHomeReady(body?.homeReady ?? []);
        setCare(body?.care ?? null);
        setThread(body?.thread ?? []);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [demo, id, deviceProgress]);

  const write = async (e: React.FormEvent) => {
    e.preventDefault();
    if (text.trim().length < 2 || send === "sending") return;
    // The same checks as the server's (portal.ts teamNoteProblems): said here first, checked there again.
    const found = teamNoteProblems(text, locale);
    setProblems(found);
    if (found.length > 0) return;
    setSend("sending");
    if (demo) {
      const note = addDemoNote(id, DEMO_PORTAL_PARTNER, { authorKind: "partner", authorFirstName: "Laura", authorRole: null, body: text.trim() });
      setThread((t) => [...t, note]);
    } else {
      const res = await fetch("/api/partners/portal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "message", clientId: id, text, locale }) }).catch(() => null);
      const body = res ? ((await res.json().catch(() => ({}))) as { note?: TeamNote; problems?: ReplyProblem[] }) : {};
      if (!res?.ok) {
        if (body.problems?.length) setProblems(body.problems);
        return setSend(body.problems?.length ? "idle" : "error");
      }
      if (body.note) setThread((t) => [...t, body.note!]);
    }
    setText("");
    setSend("sent");
  };

  return (
    <main className="min-h-dvh bg-slate-50 pb-12">
      <header className="sticky top-0 z-20 border-b hairline bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4">
          <Link href="/socios/portal" className="inline-flex min-h-11 items-center gap-1 text-[15px] font-medium text-blue-700">
            <Icon name="chevron" size={16} className="rotate-180" />
            {s.back}
          </Link>
          <div className="flex items-center gap-2">
            {demo && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-blue-900">Demo</span>}
            <LocaleToggle />
            <Logo size={22} />
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-4 pt-6">
        {client === "missing" && <p className="card mx-auto max-w-xl p-5 text-[15px] text-slate-600">{s.notFound}</p>}
        {client && client !== "missing" && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-start">
            <div className="min-w-0 space-y-6">
              <ClientProgressView progress={client} locale={locale} now={now} />
              {homeReady.length > 0 && <PartnerHomeReady rows={homeReady} locale={locale} />}
            </div>
            <div className="min-w-0 space-y-6">
              <section className="card p-5" aria-labelledby="care" data-testid="client-care">
                <h2 id="care" className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{p.careTitle(client.name)}</h2>
                {care ? (
                  <div className="mt-3 flex items-center gap-3">
                    <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-700">
                      <Icon name="person" size={22} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[17px] font-semibold text-slate-900">{care.firstName}</span>
                      <span className="block text-[13.5px] text-slate-600">{careLine(care, locale).split(" · ")[1]}</span>
                    </span>
                  </div>
                ) : (
                  <p className="mt-2 text-[14px] text-slate-600">{p.careClient}</p>
                )}
                <ul className="mt-4 space-y-1.5 border-t hairline pt-3">
                  {TEAM_PROMISE[locale].lines.slice(1, 3).map((line) => (
                    <li key={line} className="flex gap-2 text-[13px] leading-snug text-slate-600">
                      <Icon name="check" size={15} className="mt-0.5 shrink-0 text-blue-700" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="card p-5" aria-labelledby="escribir" data-testid="partner-thread">
                <h2 id="escribir" className="text-[17px] font-semibold text-slate-900">{p.threadTitle}</h2>
                <p className="mt-1 text-[13px] leading-snug text-slate-600">{p.threadHelp}</p>
                <ol className="mt-4 space-y-3" aria-live="polite">
                  {thread.length === 0 && <li className="text-[14px] text-slate-500">{p.threadEmpty}</li>}
                  {thread.map((n) => {
                    const mine = n.authorKind === "partner";
                    return (
                      <li key={n.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[88%] rounded-2xl px-4 py-3 ${mine ? "bg-blue-900 text-white" : "bg-slate-100 text-slate-900"}`}>
                          <p className={`text-[12px] font-semibold ${mine ? "text-blue-100" : "text-slate-600"}`}>
                            {mine ? p.you : n.authorRole ? `${n.authorFirstName} · ${CARE_ROLE_LABEL[locale][n.authorRole]}` : n.authorFirstName}
                          </p>
                          <p className="mt-0.5 whitespace-pre-line break-words text-[14.5px] leading-snug">{n.body}</p>
                          <p className={`mt-1 text-[11.5px] ${mine ? "text-blue-200" : "text-slate-500"}`}>{dateTimeLabel(n.at, locale)}</p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
                <form onSubmit={write} className="mt-4 space-y-3">
                  <label htmlFor="team-note" className="sr-only">{p.writePlaceholder}</label>
                  <textarea
                    id="team-note"
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value);
                      if (send !== "idle") setSend("idle");
                    }}
                    placeholder={p.writePlaceholder}
                    maxLength={1500}
                    rows={3}
                    aria-describedby="team-note-help"
                    className="w-full rounded-2xl bg-white px-4 py-3 text-[16px] shadow-[0_0_0_1px_rgba(0,0,0,0.1)] outline-none focus:ring-2 focus:ring-blue-300"
                  />
                  <p id="team-note-help" className="text-[12.5px] leading-snug text-slate-500">{s.writeHelp}</p>
                  {problems.length > 0 && (
                    <div className="rounded-2xl bg-amber-50 px-4 py-3 text-[13.5px] text-blue-900" role="alert" data-testid="note-problems">
                      <p className="font-semibold">{p.problemsTitle}</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5">
                        {problems.map((pr) => (
                          <li key={`${pr.phrase}-${pr.why}`}>
                            «{pr.phrase}»: {pr.why}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <button type="submit" disabled={text.trim().length < 2 || send === "sending"} className="pressable flex h-12 w-full items-center justify-center rounded-full bg-blue-900 text-[15px] font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500">
                    {send === "sending" ? p.sending : p.send}
                  </button>
                  {send === "sent" && <p className="rounded-2xl bg-green-50 px-4 py-3 text-[14px] text-green-700" role="status">{p.sent}</p>}
                  {send === "error" && <p className="text-[14px] text-red-600" role="alert">{p.error}</p>}
                </form>
              </section>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
