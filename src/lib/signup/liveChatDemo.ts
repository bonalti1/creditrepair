"use client";

import { LIVE_CHAT_COPY, redactPersonText, type LiveChatMessage, type LiveChatThread } from "./liveChat";
import { altiLiveReply } from "./liveChatAlti";

// The demo's signup chats with a person (no database): kept in this
// browser's storage, so the chat at /registro and the console's «Live chats»
// in another tab of the same browser see the same thread (they poll it, and
// hear the storage event). Two SAMPLE chats always wait on the console. A
// chat started at /registro that no teammate joins within a few seconds is
// joined by a sample teammate, so the person's side can be tried alone.
// Alti answers as on the server (liveChatAlti.ts: the website's library, or
// "a person will answer here"); no model is called.

const KEY = "credalti.demo.signupChats.v1";
export const DEMO_AUTO_JOIN_MS = 8_000;
export const DEMO_CHATS_EVENT = "credalti-demo-chats";

type Store = Record<string, LiveChatThread>;

function read(): Store {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Store;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function write(store: Store) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // This visit only.
  }
  window.dispatchEvent(new Event(DEMO_CHATS_EVENT));
}

let seq = 0;
const msg = (author: LiveChatMessage["author"], text: string, staffName: string | null = null, at = new Date()): LiveChatMessage => ({ id: `demo-${at.getTime().toString(36)}-${(seq++).toString(36)}`, at: at.toISOString(), author, staffName, text });

/** Two signup chats waiting on the console (sample). */
export function sampleLiveChats(now: Date): LiveChatThread[] {
  const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();
  return [
    {
      caseRef: "CR-7KQ4M",
      status: "requested",
      requestedAt: ago(3),
      joinedAt: null,
      joinedBy: null,
      handedBackAt: null,
      locale: "es",
      step: "info",
      state: "TX",
      lastPersonAt: ago(2),
      sample: true,
      messages: [
        { id: "s1-1", at: ago(3), author: "system", staffName: null, text: "requested" },
        { id: "s1-2", at: ago(3), author: "alti", staffName: null, text: LIVE_CHAT_COPY.es.waiting },
        { id: "s1-3", at: ago(2), author: "person", staffName: null, text: "Hola, ¿el DIY lo puedo cambiar a Complete después?" },
      ],
    },
    {
      caseRef: "CR-3HRT9",
      status: "joined",
      requestedAt: ago(14),
      joinedAt: ago(11),
      joinedBy: "Ana",
      handedBackAt: null,
      locale: "en",
      step: "identity",
      state: "TX",
      lastPersonAt: ago(6),
      sample: true,
      messages: [
        { id: "s2-1", at: ago(14), author: "system", staffName: null, text: "requested" },
        { id: "s2-2", at: ago(14), author: "alti", staffName: null, text: LIVE_CHAT_COPY.en.waiting },
        { id: "s2-3", at: ago(13), author: "person", staffName: null, text: "I can't find where to upload my ID." },
        { id: "s2-4", at: ago(11), author: "system", staffName: "Ana", text: "joined" },
        { id: "s2-5", at: ago(10), author: "staff", staffName: "Ana", text: "Hi! It's the step called “Verify identity”, right under your mailing address. A photo from your phone works." },
        { id: "s2-6", at: ago(6), author: "person", staffName: null, text: "Got it, thank you!" },
      ],
    },
  ];
}

/** Every demo chat: the stored ones (a sample the member answered is stored too), then the untouched samples. */
export function demoThreads(now: Date = new Date()): LiveChatThread[] {
  const store = read();
  const samples = sampleLiveChats(now).filter((s) => !store[s.caseRef]);
  return [...Object.values(store), ...samples].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}

export function demoThread(caseRef: string, now: Date = new Date()): LiveChatThread | null {
  return demoThreads(now).find((t) => t.caseRef === caseRef) ?? null;
}

function save(thread: LiveChatThread) {
  const store = read();
  store[thread.caseRef] = thread;
  write(store);
}

export function demoRequest(input: { caseRef: string; locale: "en" | "es"; step: string; state: string | null }, now: Date = new Date()): LiveChatThread {
  const prior = demoThread(input.caseRef, now);
  if (prior && prior.status !== "handed_back") return prior;
  const thread: LiveChatThread = {
    caseRef: input.caseRef,
    status: "requested",
    requestedAt: now.toISOString(),
    joinedAt: null,
    joinedBy: null,
    handedBackAt: null,
    locale: input.locale,
    step: input.step,
    state: input.state,
    lastPersonAt: null,
    messages: [...(prior?.messages ?? []), msg("system", "requested", null, now), msg("alti", LIVE_CHAT_COPY[input.locale].waiting, null, now)],
  };
  save(thread);
  return thread;
}

export function demoPersonSend(caseRef: string, text: string, locale: "en" | "es", now: Date = new Date()): LiveChatThread | null {
  const thread = demoThread(caseRef, now);
  if (!thread) return null;
  const clean = redactPersonText(text);
  if (!clean) return thread;
  const messages = [...thread.messages, msg("person", clean, null, now)];
  // Alti answers only while no person is in the chat.
  const reply = altiLiveReply(clean, locale, thread.status);
  if (reply) messages.push(msg("alti", reply, null, now));
  const next = { ...thread, messages, lastPersonAt: now.toISOString() };
  save(next);
  return next;
}

export function demoJoin(caseRef: string, name: string, now: Date = new Date()): LiveChatThread | null {
  const thread = demoThread(caseRef, now);
  if (!thread) return null;
  const first = name.trim().split(/\s+/)[0] || "Equipo";
  const next: LiveChatThread = { ...thread, status: "joined", joinedAt: now.toISOString(), joinedBy: first, handedBackAt: null, messages: [...thread.messages, msg("system", "joined", first, now)] };
  save(next);
  return next;
}

export function demoReply(caseRef: string, name: string, text: string, now: Date = new Date()): LiveChatThread | null {
  const thread = demoThread(caseRef, now);
  if (!thread || thread.status !== "joined") return null;
  const first = name.trim().split(/\s+/)[0] || "Equipo";
  const next = { ...thread, messages: [...thread.messages, msg("staff", text.trim().slice(0, 2000), first, now)] };
  save(next);
  return next;
}

export function demoHandBack(caseRef: string, now: Date = new Date()): LiveChatThread | null {
  const thread = demoThread(caseRef, now);
  if (!thread || thread.status !== "joined") return null;
  const next: LiveChatThread = { ...thread, status: "handed_back", handedBackAt: now.toISOString(), messages: [...thread.messages, msg("system", "handed_back", null, now)] };
  save(next);
  return next;
}

/** The person's side alone: a sample teammate joins a chat nobody joined after a few seconds, and says hello. */
export function demoAutoJoin(caseRef: string, now: Date = new Date()): LiveChatThread | null {
  const thread = demoThread(caseRef, now);
  if (!thread || thread.status !== "requested" || thread.sample) return thread;
  if (now.getTime() - Date.parse(thread.requestedAt) < DEMO_AUTO_JOIN_MS) return thread;
  const copy = LIVE_CHAT_COPY[thread.locale];
  const joined = demoJoin(caseRef, copy.sampleTeammate, now);
  return joined ? demoReply(caseRef, copy.sampleTeammate, copy.sampleHello, now) : thread;
}

export function demoWaitingCount(now: Date = new Date()): number {
  return demoThreads(now).filter((t) => t.status === "requested").length;
}
