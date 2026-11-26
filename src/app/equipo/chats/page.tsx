"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CharacterAvatar } from "@/components/Character";
import { aiByline, teamByline } from "@/lib/brand";
import { bylineOf, POLL_MS, systemLine, type LiveChatThread } from "@/lib/signup/liveChat";
import { useLiveChats } from "@/lib/signup/liveChatData";
import { DEMO_CHATS_EVENT } from "@/lib/signup/liveChatDemo";
import type { ReplyProblem } from "@/lib/staff/conversation";
import { shortDateTime } from "@/lib/staff/format";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { publishBadges } from "@/lib/staff/navBadges";
import { can, deniedReason } from "@/lib/staff/permissions";
import { useViewer } from "@/lib/staff/useStaff";
import Icon from "@/components/Icon";
import SafeBoundary from "@/components/staff/control/SafeBoundary";
import { BACK_LINK, Chip, DemoNote, EmptyState, GOLD_ROW_BUTTON, NoAccess, ROW_BUTTON } from "@/components/staff/ui";

// «Live chats» (docs/SIGNUP-CHAT.md, «A person joins the chat»): the people
// who asked for a human in Alti's signup chat. Lead Manager, leads.work. Join
// the chat, answer under your own name ("Rolando · Credalti team"), and hand
// it back to Alti when done; Alti is paused while a person is in. Every reply
// passes checkStaffReply here and again on the server. Polled every few
// seconds (the app uses no realtime).

const STEP_LABEL: Record<string, { en: string; es: string }> = {
  start: { en: "Getting started", es: "Empezando" },
  info: { en: "Your info", es: "Sus datos" },
  identity: { en: "Verify identity", es: "Verificar identidad" },
  report: { en: "Their report", es: "Su reporte" },
  signup: { en: "Signing up", es: "Firmando" },
  done: { en: "Signed", es: "Firmó" },
};

function Thread({ thread, locale }: { thread: LiveChatThread; locale: "en" | "es" }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [thread.messages.length]);
  return (
    <div className="max-h-[60vh] space-y-2 overflow-y-auto px-1 py-2" role="log" aria-live="polite" data-testid="chat-thread">
      {thread.messages.map((m) =>
        m.author === "system" ? (
          <p key={m.id} className="mx-auto max-w-md rounded-full bg-slate-100 px-3 py-1 text-center text-[12.5px] text-slate-600">
            {systemLine(m, locale, "staff")}
          </p>
        ) : m.author === "person" ? (
          <div key={m.id} className="flex justify-start">
            <p className="max-w-[85%] whitespace-pre-line rounded-[16px] rounded-bl-[4px] bg-slate-100 px-3.5 py-2 text-[14.5px] text-slate-900 [overflow-wrap:anywhere]">
              <span className="block text-[11.5px] font-semibold text-slate-500">{thread.caseRef}</span>
              {m.text}
            </p>
          </div>
        ) : (
          <div key={m.id} className="flex items-end justify-end gap-1.5">
            <div className="max-w-[85%]">
              <p className="mb-0.5 text-right text-[11.5px] font-semibold text-slate-500" data-testid={m.author === "alti" ? "ai-byline" : "team-byline"}>
                {bylineOf(m, locale)}
              </p>
              <p className={`whitespace-pre-line rounded-[16px] rounded-br-[4px] px-3.5 py-2 text-[14.5px] [overflow-wrap:anywhere] ${m.author === "alti" ? "bg-blue-50 text-blue-950" : "bg-blue-900 text-white"}`}>
                <span className="sr-only">{bylineOf(m, locale)}: </span>
                {m.text}
              </p>
            </div>
            {m.author === "alti" && <CharacterAvatar character="assistant" size={26} decorative />}
          </div>
        ),
      )}
      <div ref={end} />
    </div>
  );
}

function Chats() {
  const t = useTx();
  const { locale } = useStaffLocale();
  const { viewer, ready } = useViewer();
  const chats = useLiveChats(viewer, locale);
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const open = params.get("caso");
  const [list, setList] = useState<{ threads: LiveChatThread[]; sample: boolean } | null>(null);
  const [thread, setThread] = useState<LiveChatThread | null>(null);
  const [draft, setDraft] = useState("");
  const [problems, setProblems] = useState<ReplyProblem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const loadList = useCallback(async () => {
    if (document.hidden) return;
    const l = await chats.list();
    setList(l);
    if (l) publishBadges("chats", { leads: l.threads.filter((x) => x.status === "requested").length });
  }, [chats]);
  const loadThread = useCallback(async () => {
    if (!open || document.hidden) return;
    setThread(await chats.thread(open));
  }, [chats, open]);

  useEffect(() => {
    if (!ready || !viewer) return;
    void loadList();
    const a = window.setInterval(() => void loadList(), POLL_MS.staffList);
    const again = () => {
      void loadList();
      void loadThread();
    };
    window.addEventListener("storage", again);
    window.addEventListener(DEMO_CHATS_EVENT, again);
    return () => {
      window.clearInterval(a);
      window.removeEventListener("storage", again);
      window.removeEventListener(DEMO_CHATS_EVENT, again);
    };
  }, [ready, viewer, loadList, loadThread]);

  useEffect(() => {
    if (!ready || !viewer || !open) {
      setThread(null);
      return;
    }
    void loadThread();
    const b = window.setInterval(() => void loadThread(), POLL_MS.staffThread);
    return () => window.clearInterval(b);
  }, [ready, viewer, open, loadThread]);

  if (!ready) return null;
  if (!can(viewer?.role, "leads.work")) return <NoAccess title={t("Chats en vivo", "Live chats")} reason={deniedReason("leads.work", locale)} />;

  const pick = (ref: string | null) => {
    setProblems([]);
    setError(null);
    router.replace(ref ? `${path}?caso=${encodeURIComponent(ref)}` : path, { scroll: false });
  };
  const apply = async (p: Promise<import("@/lib/signup/liveChatData").ChatActResult>) => {
    setSending(true);
    const out = await p;
    setSending(false);
    if (out.ok) {
      setThread(out.thread);
      setProblems([]);
      setError(null);
      void loadList();
      return true;
    }
    setProblems(out.problems ?? []);
    setError(out.message[locale]);
    return false;
  };
  const myFirst = (viewer?.name ?? "").split(" ")[0] ?? "";
  const threads = list?.threads ?? [];

  return (
    <main className="animate-rise min-w-0" data-testid="chats-page">
      <h1 className="page-title">{t("Chats en vivo", "Live chats")}</h1>
      <p className="mt-1 max-w-3xl text-[15px] leading-relaxed text-slate-500">
        {t(
          "Personas que, en el chat de registro con Alti, pidieron hablar con alguien. Entra al mismo chat y responde con tu nombre; Alti se pausa hasta que se lo devuelves.",
          "People who asked, in the signup chat with Alti, to talk with someone. Join the same chat and answer under your name; Alti pauses until you hand it back.",
        )}
      </p>
      {list?.sample && <DemoNote>{t("dos chats de muestra. Abre /registro en otra pestaña y pide una persona: aparece aquí.", "two sample chats. Open /registro in another tab and ask for a person: it shows here.")}</DemoNote>}

      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section aria-labelledby="open-chats" className={open ? "hidden lg:block" : ""}>
          <h2 id="open-chats" className="console-label px-1 pb-2">{t("Chats", "Chats")}</h2>
          {!list ? (
            <div className="h-32" aria-busy="true" />
          ) : threads.length === 0 ? (
            <div className="card">
              <EmptyState pose="thumbsUp" title={t("Nadie espera ahora", "Nobody is waiting right now")}>
                {t("Cuando alguien pida una persona en el chat de registro, aparece aquí y en el círculo rojo de Prospectos.", "When someone asks for a person in the signup chat, they show here and in Lead Manager's red circle.")}
              </EmptyState>
            </div>
          ) : (
            <ul className="space-y-2" data-testid="chat-list">
              {threads.map((th) => {
                const last = [...th.messages].reverse().find((m) => m.author === "person");
                return (
                  <li key={th.caseRef}>
                    <button type="button" onClick={() => pick(th.caseRef)} aria-current={open === th.caseRef} className={`card pressable flex w-full flex-col gap-1 px-4 py-3 text-left hover:ring-2 hover:ring-amber-300 ${open === th.caseRef ? "ring-2 ring-blue-700" : ""}`}>
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono text-[14px] font-semibold text-blue-900">{th.caseRef}</span>
                        {th.status === "requested" ? (
                          <Chip tone="bg-red-50 text-red-700">{t("Espera a una persona", "Waiting for a person")}</Chip>
                        ) : th.status === "joined" ? (
                          <Chip tone="bg-blue-50 text-blue-900">{t(`${th.joinedBy ?? "Alguien"} está en el chat`, `${th.joinedBy ?? "Someone"} is in the chat`)}</Chip>
                        ) : (
                          <Chip tone="bg-slate-100 text-slate-600">{t("Devuelto a Alti", "Handed back to Alti")}</Chip>
                        )}
                      </span>
                      <span className="text-[12.5px] text-slate-500">
                        {(STEP_LABEL[th.step ?? ""] ?? STEP_LABEL.start)![locale]} · {th.state ?? "—"} · {th.locale === "es" ? t("Español", "Spanish") : t("Inglés", "English")} · {shortDateTime(th.requestedAt, locale)}
                        {th.sample && ` · ${t("muestra", "sample")}`}
                      </span>
                      {last && <span className="line-clamp-2 text-[13.5px] text-slate-700 [overflow-wrap:anywhere]">“{last.text}”</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="chat-title" className={open ? "" : "hidden lg:block"}>
          {!open || !thread ? (
            <div className="card hidden px-5 py-8 text-center text-[14px] text-slate-500 lg:block">{t("Elige un chat de la lista.", "Pick a chat from the list.")}</div>
          ) : (
            <SafeBoundary>
              <div className="card px-4 py-4" data-testid="chat-panel">
                <button type="button" onClick={() => pick(null)} className={`${BACK_LINK} lg:hidden`}>
                  ‹ {t("Chats", "Chats")}
                </button>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 id="chat-title" className="font-display text-[17px] font-semibold text-blue-900">
                      {t("Caso", "Case")} <span className="font-mono">{thread.caseRef}</span>
                    </h2>
                    <p className="text-[13px] text-slate-500">
                      {(STEP_LABEL[thread.step ?? ""] ?? STEP_LABEL.start)![locale]} · {thread.state ?? "—"} · {t("Idioma de la persona:", "Person's language:")} {thread.locale === "es" ? t("español", "Spanish") : t("inglés", "English")}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {thread.status !== "joined" ? (
                      <button type="button" className={`${GOLD_ROW_BUTTON} gap-1.5`} disabled={sending} onClick={() => void apply(chats.join(thread.caseRef))} data-testid="join-chat">
                        <Icon name="person" size={15} />
                        {t("Entrar al chat", "Join the chat")}
                      </button>
                    ) : (
                      <button type="button" className={ROW_BUTTON} disabled={sending} onClick={() => void apply(chats.handBack(thread.caseRef))} data-testid="hand-back">
                        {t("Devolver a Alti", "Hand back to Alti")}
                      </button>
                    )}
                  </div>
                </div>
                <p className="mt-2 rounded-[10px] bg-slate-50 px-3 py-2 text-[12.5px] leading-snug text-slate-600">
                  {thread.status === "joined"
                    ? t(`${aiByline("es")} está en pausa. Tus mensajes salen como «${teamByline(myFirst, "es")}».`, `${aiByline("en")} is paused. Your messages show as “${teamByline(myFirst, "en")}”.`)
                    : t("Alti responde con las respuestas de la web mientras nadie entra. Al entrar, Alti se pausa.", "Alti answers from the website's answers while nobody is in. When you join, Alti pauses.")}{" "}
                  {t("Nunca pidas el número de Seguro Social, una tarjeta ni documentos por aquí.", "Never ask for a Social Security number, a card or documents here.")}
                </p>
                <Thread thread={thread} locale={locale} />
                {thread.status === "joined" && (
                  <form
                    className="mt-2 space-y-2"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!draft.trim()) return;
                      if (await apply(chats.reply(thread.caseRef, draft))) setDraft("");
                    }}
                  >
                    <label className="block">
                      <span className="sr-only">{t("Tu respuesta", "Your reply")}</span>
                      <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        rows={3}
                        maxLength={2000}
                        lang={thread.locale}
                        placeholder={thread.locale === "es" ? t("Escribe en español…", "Write in Spanish…") : t("Escribe en inglés…", "Write in English…")}
                        className="w-full rounded-[10px] border border-slate-300 bg-white px-3 py-2 text-[15px] focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
                        data-testid="chat-reply"
                      />
                    </label>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] text-slate-500">{teamByline(myFirst, thread.locale)}</span>
                      <button type="submit" className={GOLD_ROW_BUTTON} disabled={sending || !draft.trim()} data-testid="send-reply">
                        {t("Enviar", "Send")}
                      </button>
                    </div>
                  </form>
                )}
                {(error || problems.length > 0) && (
                  <div className="mt-2 rounded-[10px] bg-red-50 px-3 py-2 text-[13.5px] text-red-800" role="alert" data-testid="reply-problems">
                    {error && <p className="font-semibold">{error}</p>}
                    <ul className="mt-1 list-disc pl-5">
                      {problems.map((p) => (
                        <li key={p.phrase}>
                          «{p.phrase}»: {p.why}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </SafeBoundary>
          )}
        </section>
      </div>
    </main>
  );
}

export default function ChatsPage() {
  return (
    <Suspense fallback={null}>
      <Chats />
    </Suspense>
  );
}
