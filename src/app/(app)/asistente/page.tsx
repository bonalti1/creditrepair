"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useClientReport } from "@/lib/ux/reportStore";
import ReportPending from "@/components/ReportPending";
import { ATTESTATION_TEXT } from "@/lib/compliance/attestation";
import { getCategoryExplainers } from "@/lib/ux/explainers";
import { crossBureauNote, differingAnswerLine } from "@/lib/ux/crossBureau";
import { useFlags, type FlagsMap } from "@/lib/ux/flagsStore";
import { useChatThread, type ChatMsg } from "@/lib/ux/chatStore";
import { contextText, messageText, messageVoice } from "@/lib/ux/chatMessages";
import { HUMAN_HELP, humanHelpHref } from "@/lib/ux/humanHelp";
import { itemCheckHints, itemFacts, itemKindLine, itemLabel, itemReadAloud, itemTitle } from "@/lib/ux/itemDisplay";
import { approvedMessage, letterCoverageRows, waitingNote } from "@/lib/ux/roundCopy";
import { canConfirmDispute, reasonLabel } from "@/lib/ux/disputeReason";
import type { DisputeReasonCode } from "@/lib/letters/reasons";
import { sessionPlan } from "@/lib/ux/sessionPlan";
import { LETTERS_OUT_LINE, reviewCompleteLine, reviewFinishedLine, reviewIntroLine } from "@/lib/ux/reviewChatCopy";
import { isFullService, SERVICE_MODE } from "@/lib/service/mode";
import { useLocale } from "@/lib/i18n";
import { DICTS } from "@/lib/i18n/dictionaries";
import DisputeFields, { EMPTY_DRAFT } from "@/components/DisputeFields";
import ItemFacts from "@/components/ItemFacts";
import SpeakButton from "@/components/SpeakButton";
import Icon from "@/components/Icon";
import { InfoNote, WaitingNote } from "@/components/RoundNotes";
import { CharacterAvatar } from "@/components/Character";
import { ASSISTANT_NAME } from "@/lib/brand";
import TeamMessage from "@/components/TeamMessage";

// The conversation. The client's whole journey lives in one thread with their
// AI assistant: it leads with proactive messages and action cards. The client
// decides and attests, item by item; those answers are theirs alone. What comes
// next depends on the service mode. Full service (the business today): the
// team prepares and mails the letters, and the card after the review only
// shows what goes in each one. Self-serve (kept for later): the same card
// carries the approve button. Free-text questions go to the guardrailed coach. The
// assistant is always identified as AI; a human teammate is one tap away.
// When a teammate answers in the thread, their message is signed with their
// first name and "del equipo" and looks different from the assistant's (TeamMessage).
//
// Faces: the assistant's messages and the header carry BONALTI, the AI
// assistant. A teammate's message never gets a character: it is signed with
// the real person's name, so nobody's words are put in a mascot's mouth. Alti,
// the face of the team as a whole, appears only on the "Persona" button, which
// leads to the team, not to any one message.
// The thread itself is saved (server-side when signed in), so the client picks
// up the same conversation on any device.

type Msg = ChatMsg;

const BUREAU_LABEL: Record<string, string> = {
  equifax: "Equifax",
  experian: "Experian",
  transunion: "TransUnion",
};

/** Button labels in the dictionary carry a leading symbol; the chat uses icons instead. */
const plain = (label: string) => label.replace(/^[^\p{L}]+/u, "");

export default function Asistente() {
  const { locale, d } = useLocale();
  const es = locale === "es";
  const { flags, review, roundApproved, setRoundApproved, hydrated } = useFlags();
  const { messages, append, hydrated: chatHydrated, signedIn } = useChatThread();
  const seeded = useRef(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [flagging, setFlagging] = useState(false);
  /** The reason, the customer's own words and the attestation checkbox for the item on screen. */
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const threadRef = useRef<HTMLDivElement>(null);
  const flagFormRef = useRef<HTMLDivElement>(null);
  /** How many messages were on screen at the last look; null until the thread first shows. */
  const shownCount = useRef<number | null>(null);
  /** True when this visit started the thread (nothing was saved before). */
  const freshThread = useRef(false);

  // The sample report in the demo; the client's own with a database (lib/ux/reportStore.ts).
  const view = useClientReport();
  const items = view.items;
  const pending = useMemo(() => items.filter((i) => !flags[i.fingerprint]), [items, flags]);
  const current = pending[0];
  const negatives = items.filter((i) => i.negative).length;
  const humanHref = humanHelpHref(locale);

  const session = useMemo(() => sessionPlan(items, flags), [items, flags]);
  const { plan, roundNumber, attestedFlags } = session;
  const confirmedCount = attestedFlags.length;
  // Confirmed items that are not in this round's letters, said plainly above the approve button.
  const waiting = waitingNote(session, locale);

  const phase: "review" | "attack" | "waiting" | "done-empty" = !hydrated
    ? "review"
    : pending.length > 0
      ? "review"
      : roundApproved
        ? "waiting"
        : confirmedCount > 0
          ? "attack"
          : "done-empty";

  /**
   * A scripted line, written in both languages at once. The thread shows the
   * one that matches the active language, so it follows the language switch.
   */
  const line = (role: Msg["role"], esText: string, enText: string): Msg => ({
    role,
    text: es ? esText : enText,
    lang: locale,
    alt: es ? enText : esText,
  });
  const say = (esText: string, enText: string) => append([line("assistant", esText, enText)]);
  const youSay = (esText: string, enText: string) => append([line("user", esText, enText)]);

  // Seed the opening messages once, matched to where the client is. A saved
  // thread is shown as it was left: nothing is added on a return visit.
  useEffect(() => {
    // With a database the thread opens only once the client's own report is known (and there is one).
    if (!hydrated || !chatHydrated || !view.ready || view.waiting || seeded.current) return;
    seeded.current = true;
    if (messages.length > 0) return;
    freshThread.current = true;
    const opening: Msg[] = [
      line(
        "assistant",
        `Hola 👋 Soy ${ASSISTANT_NAME}, tu asistente de crédito con IA. Ya importé tu reporte de los 3 burós: ${DICTS.es.dashboard.items(items.length)}, ${DICTS.es.dashboard.negatives(negatives)}.`,
        `Hi 👋 I'm ${ASSISTANT_NAME}, your AI credit assistant. I already imported your 3-bureau report: ${DICTS.en.dashboard.items(items.length)}, ${DICTS.en.dashboard.negatives(negatives)}.`,
      ),
    ];
    // What follows the review is said in the words of the service mode (reviewChatCopy.ts).
    const second =
      phase === "review"
        ? reviewIntroLine(SERVICE_MODE, pending.length)
        : phase === "attack"
          ? reviewCompleteLine(SERVICE_MODE, confirmedCount)
          : phase === "waiting"
            ? LETTERS_OUT_LINE
            : null;
    if (second) opening.push(line("assistant", second.es, second.en));
    append(opening);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, chatHydrated, view.ready]);

  /**
   * Bring the newest message into view. It goes to the top of the view, or the
   * view goes to the end of the thread, whichever comes first: a short tail
   * lands at the bottom as usual, and a tall card that follows the message is
   * read from its title down instead of from its buttons up.
   */
  const scrollToNewest = (smooth: boolean) => {
    const box = threadRef.current;
    if (!box) return;
    const end = box.scrollHeight - box.clientHeight;
    const newest = box.querySelector<HTMLElement>("[data-newest]");
    const top = newest
      ? newest.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 12
      : end;
    box.scrollTo({ top: Math.max(0, Math.min(top, end)), behavior: smooth ? "smooth" : "auto" });
  };

  // Where the thread sits. A thread started on this visit stays at the top, so
  // The assistant's greeting is the first thing read. A saved thread opens at its newest
  // message. After that, the view moves only when a message is added.
  useEffect(() => {
    if (!hydrated || !chatHydrated || messages.length === 0) return;
    if (shownCount.current === null) {
      shownCount.current = messages.length;
      if (freshThread.current) threadRef.current?.scrollTo({ top: 0 });
      else scrollToNewest(false);
      return;
    }
    if (messages.length > shownCount.current) scrollToNewest(true);
    shownCount.current = messages.length;
  }, [messages.length, hydrated, chatHydrated]);

  // Opening the "inaccurate" form is the customer's own tap: show the form,
  // from its first line (the list of reasons is taller than the screen).
  useEffect(() => {
    const box = threadRef.current;
    const form = flagFormRef.current;
    if (!flagging || !box || !form) return;
    const top = form.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 12;
    box.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }, [flagging]);

  /**
   * After a decision. `confirmed` is how many items are confirmed once this
   * decision counts; `after` is the answers with this decision in them.
   */
  const afterDecision = (confirmed: number, after: FlagsMap) => {
    const left = pending.length - 1;
    // The same account on another bureau, answered differently: say so once,
    // plainly, without suggesting which answer to keep.
    if (current) {
      const differsEs = differingAnswerLine(current, items, after, "es");
      const differsEn = differingAnswerLine(current, items, after, "en");
      if (differsEs && differsEn) say(differsEs, differsEn);
    }
    if (left > 0) {
      say(
        left === 1 ? "Anotado. Último elemento:" : `Anotado. Quedan ${left}.`,
        left === 1 ? "Noted. Last item:" : `Noted. ${left} left.`,
      );
    } else if (roundApproved) {
      // An item reopened after the letters went out: the round itself does not change.
      say(DICTS.es.items.afterMailedNoted, DICTS.en.items.afterMailedNoted);
    } else if (confirmed > 0) {
      const finished = reviewFinishedLine(SERVICE_MODE);
      say(finished.es, finished.en);
    } else {
      say(
        "¡Revisaste todo! 🎉 No marcaste ningún elemento, así que no hay cartas por enviar.",
        "You reviewed everything! 🎉 You didn't flag any items, so there are no letters to send.",
      );
    }
  };

  const decideCorrect = () => {
    if (!current) return;
    youSay(
      `${itemLabel(current, "es")}\n${plain(DICTS.es.items.looksCorrect)}`,
      `${itemLabel(current, "en")}\n${plain(DICTS.en.items.looksCorrect)}`,
    );
    review(current.fingerprint, "correct");
    setDraft(EMPTY_DRAFT);
    afterDecision(confirmedCount, { ...flags, [current.fingerprint]: { state: "correct" } });
  };

  /** A reason, the customer's words when the reason is "other", and the attestation checkbox. */
  const canConfirm = current ? canConfirmDispute(current.category, draft) : false;

  const confirmFlag = () => {
    if (!current || !canConfirm) return;
    const reasonCode = draft.reasonCode as DisputeReasonCode;
    const reason = draft.note.trim();
    youSay(
      `${itemLabel(current, "es")}\n${DICTS.es.items.reasonOf(reasonLabel(reasonCode, "es") ?? "")}\n${ATTESTATION_TEXT.es}`,
      `${itemLabel(current, "en")}\n${DICTS.en.items.reasonOf(reasonLabel(reasonCode, "en") ?? "")}\n${ATTESTATION_TEXT.en}`,
    );
    const attestedAt = new Date().toISOString();
    review(current.fingerprint, "attested", { reason, reasonCode, attestedAt });
    setFlagging(false);
    setDraft(EMPTY_DRAFT);
    afterDecision(confirmedCount + 1, {
      ...flags,
      [current.fingerprint]: { state: "attested", reason, reasonCode, attestedAt },
    });
  };

  /** Self-serve only: under full service the team mails the letters and this is never offered. */
  const approve = () => {
    if (isFullService) return;
    youSay("Apruebo. Envía mis cartas.", "Approved. Send my letters.");
    setRoundApproved(true);
    // Which letters went out, what each covers, and what waits for the next round.
    say(approvedMessage(session, items, "es"), approvedMessage(session, items, "en"));
  };

  /** Demo only (no WhatsApp number): say plainly that nobody is online. No coach call. */
  const explainNoHuman = () => {
    const last = messages[messages.length - 1];
    if (last && (last.text === HUMAN_HELP.demoChat.es || last.text === HUMAN_HELP.demoChat.en)) return;
    say(HUMAN_HELP.demoChat.es, HUMAN_HELP.demoChat.en);
  };

  /** Record an exchange the coach endpoint did not store. Nothing is sent when signed out. */
  const saveExchange = (question: string, answer: string) => {
    if (!signedIn) return;
    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "user", text: question.slice(0, 4000) },
          { role: "assistant", text: answer.slice(0, 4000) },
        ],
      }),
    }).catch(() => undefined);
  };

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    // The coach gets the recent thread as context, starting at a client turn.
    const recent = messages.slice(-12);
    const firstUser = recent.findIndex((m) => m.role === "user");
    const context = (firstUser === -1 ? [] : recent.slice(firstUser)).map((m) => ({
      role: m.role,
      // A teammate's line is marked, so the coach does not take it for its own.
      content: contextText(m).slice(0, 4000),
    }));
    // Shown now; the server records coach exchanges itself (remote: false).
    append([{ role: "user", text: q }], { remote: false });
    setInput("");
    setBusy(true);
    // Shown when the coach cannot answer (always, in the demo). A person is
    // only offered where there is one to reach.
    const wantsHuman = /persona|humano|alguien|person|human/i.test(q);
    const human = humanHref ? HUMAN_HELP.liveChat : HUMAN_HELP.demoChat;
    const fallback = wantsHuman
      ? human
      : {
          es: `Buena pregunta. El coach completo se activa al conectar tu cuenta. Mientras tanto, revisa las explicaciones junto a cada elemento${humanHref ? ", o toca «Persona» para hablar con alguien del equipo" : ""}.`,
          en: `Good question. The full coach activates once your account is connected. Meanwhile, check the explanations next to each item${humanHref ? ", or tap “Person” to talk to someone on our team" : ""}.`,
        };
    const replyWithFallback = () => {
      append([line("assistant", fallback.es, fallback.en)], { remote: false });
      saveExchange(q, fallback[locale]);
    };
    try {
      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [...context, { role: "user", content: q.slice(0, 4000) }] }),
      });
      if (res.ok) {
        const { reply, stored } = (await res.json()) as { reply: string | null; stored?: boolean };
        if (typeof reply === "string" && reply) {
          append([{ role: "assistant", text: reply }], { remote: false });
          // Signed in but the server could not record it: save both lines the
          // ordinary way so the thread is still complete on other devices.
          if (!stored) saveExchange(q, reply);
        } else {
          // No reply and no error: the coach is not configured here (the demo).
          replyWithFallback();
        }
      } else {
        replyWithFallback();
      }
    } catch {
      replyWithFallback();
    } finally {
      setBusy(false);
    }
  };

  if (!hydrated || !chatHydrated || !view.ready) return null;
  if (view.waiting) {
    return (
      <main className="animate-rise space-y-5">
        <ReportPending />
      </main>
    );
  }
  const explainer = current ? getCategoryExplainers(locale)[current.category] : null;
  const heading = current ? itemTitle(current, locale) : null;
  const facts = current ? itemFacts(current, locale) : [];
  const kindLine = current ? itemKindLine(current, locale) : "";
  const hints = current ? itemCheckHints(current, locale, 3) : [];
  const otherBureaus = current ? crossBureauNote(current, items, flags, locale) : null;
  const humanButton =
    "pressable flex h-11 shrink-0 items-center gap-2 rounded-full bg-slate-100 pl-1.5 pr-4 text-[14px] font-semibold text-slate-900";
  // Alti stands for the team the button leads to; the button's label says what it does.
  const humanLabel = (
    <>
      <CharacterAvatar character="team" size={32} decorative />
      {es ? "Persona" : "Person"}
    </>
  );

  return (
    <main className="card animate-rise -mt-1 flex h-[calc(100dvh-9.75rem)] flex-col overflow-hidden sm:h-[calc(100dvh-8.5rem)]">
      <header className="flex items-center gap-3 border-b hairline px-4 py-3">
        <CharacterAvatar character="assistant" size={44} decorative />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] font-semibold leading-tight text-slate-900">
            {ASSISTANT_NAME}
          </span>
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
            {es ? "Asistente con IA" : "AI assistant"}
          </span>
        </span>
        {humanHref ? (
          <a
            href={humanHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={es ? "Hablar con una persona por WhatsApp" : "Talk to a person on WhatsApp"}
            className={humanButton}
          >
            {humanLabel}
          </a>
        ) : (
          <button
            type="button"
            onClick={explainNoHuman}
            aria-label={es ? "Hablar con una persona" : "Talk to a person"}
            className={humanButton}
          >
            {humanLabel}
          </button>
        )}
      </header>

      <div ref={threadRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-4">
        {messages.map((m, i) => {
          const shown = messageText(m, locale);
          const voice = messageVoice(m, locale);
          // BONALTI's face on the assistant's lines only, once per run of them (on the last).
          const next = messages[i + 1];
          const lastOfRun = !next || messageVoice(next, locale).kind !== "assistant";
          return (
            <div
              key={i}
              data-newest={i === messages.length - 1 ? "" : undefined}
              className={`animate-rise flex items-end gap-1.5 ${voice.kind === "client" ? "justify-end" : ""}`}
            >
              {voice.kind === "assistant" &&
                (lastOfRun ? (
                  <CharacterAvatar character="assistant" size={28} decorative className="mb-0.5" />
                ) : (
                  <span aria-hidden="true" className="w-7 shrink-0" />
                ))}
              {voice.kind === "team" && voice.byline ? (
                // A person wrote this one: signed, outlined, and never labelled as AI.
                <TeamMessage byline={voice.byline} text={shown} />
              ) : (
                <div
                  className={`max-w-[78%] whitespace-pre-line break-words px-4 py-2.5 text-[16px] leading-snug ${
                    voice.kind === "client"
                      ? "rounded-[22px] rounded-br-md bg-blue-700 text-white"
                      : "rounded-[22px] rounded-bl-md bg-slate-100 text-slate-900"
                  }`}
                >
                  {shown}
                </div>
              )}
              {/* Read-aloud says who wrote a teammate's message before reading it. */}
              {voice.kind !== "client" && <SpeakButton text={voice.spoken} compact />}
            </div>
          );
        })}

        {phase === "review" && current && heading && (
          <div className="animate-rise mt-3 rounded-3xl border hairline bg-white p-5 shadow-[0_8px_24px_-14px_rgba(0,0,0,0.25)]">
            <div className="flex items-start justify-between gap-2">
              <p className="flex min-h-11 min-w-0 flex-1 flex-wrap items-center content-center gap-x-2 gap-y-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <span>{BUREAU_LABEL[current.bureau]}</span>
                {current.negative && (
                  <span className="whitespace-nowrap rounded-full bg-red-50 px-2.5 py-0.5 text-[13px] font-medium normal-case tracking-normal text-red-700">
                    {d.items.negativeBadge}
                  </span>
                )}
              </p>
              <SpeakButton text={`${itemReadAloud(current, locale)} ${hints.join(" ")}`} />
            </div>
            {heading.kicker && <p className="mt-2 text-[14px] font-semibold text-slate-500">{heading.kicker}</p>}
            <p className={`break-words text-[22px] font-semibold leading-tight text-slate-900 ${heading.kicker ? "mt-0.5" : "mt-2"}`}>
              {heading.title}
            </p>
            <p className="mt-2 text-[15px] leading-relaxed text-slate-600">{kindLine}</p>
            <ItemFacts facts={facts} heading={d.items.reportSays} className="mt-3" />
            {otherBureaus && (
              <InfoNote testId="cross-bureau-note" className="mt-3">
                {otherBureaus.text}
              </InfoNote>
            )}
            {roundApproved && (
              <InfoNote testId="after-mailed-note" className="mt-3">
                {d.items.afterMailedCard}
              </InfoNote>
            )}
            {hints.length > 0 && (
              <ul className="mt-3 space-y-2">
                {hints.map((h, i) => (
                  <li key={i} className="flex gap-2 text-[14px] leading-snug text-slate-600">
                    <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
                    {h}
                  </li>
                ))}
              </ul>
            )}

            {!flagging ? (
              <div className="mt-5 grid gap-2.5">
                <button
                  onClick={decideCorrect}
                  className="pressable flex h-[52px] items-center justify-center gap-2 rounded-full bg-slate-100 text-[16px] font-semibold text-slate-900"
                >
                  <Icon name="check" size={18} className="text-green-600" strokeWidth={2.25} />
                  {plain(d.items.looksCorrect)}
                </button>
                <button
                  onClick={() => setFlagging(true)}
                  className="pressable flex h-[52px] items-center justify-center rounded-full bg-blue-50 text-[16px] font-semibold text-blue-700"
                >
                  {plain(d.items.looksWrong)}
                </button>
              </div>
            ) : (
              <div ref={flagFormRef} className="mt-5 border-t hairline pt-5">
                <DisputeFields category={current.category} draft={draft} onChange={setDraft} />
                <div className="mt-3 grid grid-cols-[1fr_auto] gap-2.5">
                  <button
                    onClick={confirmFlag}
                    disabled={!canConfirm}
                    className="pressable h-[52px] rounded-full bg-amber-400 text-[16px] font-semibold text-blue-900 disabled:bg-slate-200 disabled:text-slate-500"
                  >
                    {d.items.confirm}
                  </button>
                  <button
                    onClick={() => {
                      setFlagging(false);
                      setDraft({ ...draft, attested: false });
                    }}
                    className="pressable h-[52px] rounded-full bg-slate-100 px-5 text-[16px] font-medium text-slate-700"
                  >
                    {d.items.back}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {phase === "attack" && (
          <div className="animate-rise mt-3 rounded-3xl border hairline bg-white p-5 shadow-[0_8px_24px_-14px_rgba(0,0,0,0.25)]">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <p className="text-[20px] font-semibold text-slate-900">{d.attack.title(roundNumber)}</p>
              {isFullService && (
                <span
                  data-testid="letter-status"
                  className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[13px] font-semibold text-amber-700"
                >
                  {d.team.statusPreparing}
                </span>
              )}
            </div>
            {isFullService && (
              <p className="mt-1.5 text-[15px] font-semibold leading-snug text-slate-900">{d.team.lettersLead}</p>
            )}
            <p className="mt-1 text-[14px] leading-snug text-slate-500">
              {isFullService
                ? d.team.lettersSubtitle(plan.letters.length, session.inRound.length)
                : d.attack.subtitle(plan.letters.length, session.inRound.length)}
            </p>
            {/* Every letter, with what it covers: the recipient alone does not say what is being mailed. */}
            <ul className="mt-3 divide-y divide-slate-100">
              {plan.letters.map((l, i) => (
                <li key={i} className="flex items-start gap-3 py-2.5 text-[15px] leading-snug text-slate-700">
                  <Icon name="doc" size={18} className="mt-0.5 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-medium text-slate-900">{l.target.name}</span>
                    {letterCoverageRows(l, items, session.itemReasons, locale).map((row) => (
                      <span key={row.key} data-testid="letter-covers" className="mt-1 block break-words text-[14px] text-slate-600">
                        {row.label}
                        {/* The reason the customer gave, and the sentence the letter prints for it. */}
                        {row.reasonLabel && (
                          <span className="block text-[13px] text-slate-500">{d.items.reasonOf(row.reasonLabel)}</span>
                        )}
                        {row.sentence && (
                          <span data-testid="reason-sentence" className="block text-[13px] text-slate-500">
                            {d.items.inLetter} <span className="font-serif italic text-slate-700">{row.sentence}</span>
                          </span>
                        )}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
            {waiting && <WaitingNote note={waiting} className="mt-3" />}
            <div className="mt-4 grid gap-2.5">
              {/* Full service has no approve step: the team prepares and mails. */}
              {!isFullService && (
                <button
                  onClick={approve}
                  className="pressable h-14 w-full rounded-full bg-amber-400 text-[17px] font-semibold text-blue-900 hover:bg-amber-500"
                >
                  {es
                    ? plan.letters.length === 1 ? "Aprobar y enviar 1 carta" : `Aprobar y enviar ${plan.letters.length} cartas`
                    : plan.letters.length === 1 ? "Approve and send 1 letter" : `Approve and send ${plan.letters.length} letters`}
                </button>
              )}
              <Link
                href="/attack"
                className="pressable flex h-12 w-full items-center justify-center rounded-full bg-slate-100 text-[16px] font-medium text-slate-900 hover:bg-slate-200"
              >
                {d.team.readLetters(plan.letters.length)}
              </Link>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              {isFullService ? d.team.changeNote : d.attack.approveNote}
            </p>
          </div>
        )}

        {phase === "done-empty" && (
          <div className="animate-rise mt-3 rounded-3xl bg-green-50 p-5 text-[15px] leading-relaxed text-green-900">
            {d.items.doneNoItems}
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        className="flex items-center gap-2 border-t hairline px-3 py-2.5"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={es ? "Pregúntame lo que sea" : "Ask me anything"}
          aria-label={es ? "Escribe tu mensaje" : "Type your message"}
          className="h-11 flex-1 rounded-full bg-slate-100 px-5 text-[16px] outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-blue-300"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          aria-label={es ? "Enviar" : "Send"}
          className="pressable flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-400 text-blue-900 disabled:bg-slate-200 disabled:text-slate-400"
        >
          <Icon name="arrowUp" size={20} strokeWidth={2.25} />
        </button>
      </form>
    </main>
  );
}
