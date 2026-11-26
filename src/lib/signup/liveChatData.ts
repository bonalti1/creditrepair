"use client";

import { useMemo } from "react";
import type { Bilingual } from "../content/types";
import { checkStaffReply, type ReplyProblem } from "../staff/conversation";
import type { StaffLocale } from "../staff/i18n/locale";
import { can, deniedReason, type Viewer } from "../staff/permissions";
import { isSupabaseConfigured } from "../supabase/config";
import type { LiveChatThread } from "./liveChat";
import { demoHandBack, demoJoin, demoReply, demoThread, demoThreads, demoWaitingCount } from "./liveChatDemo";

// The console's «Live chats» data: /api/staff/signup-chats with a database
// (polled: the app uses no realtime), the browser's demo store otherwise.
// A reply is checked here as it is typed (checkStaffReply) and again on the server.

export type ChatActResult = { ok: true; thread: LiveChatThread } | { ok: false; message: Bilingual; problems?: ReplyProblem[] };

const msg = (en: string, es: string): Bilingual => ({ en, es });

export function useLiveChats(viewer: Viewer | null, locale: StaffLocale) {
  const live = isSupabaseConfigured();
  const role = viewer?.role ?? null;
  return useMemo(() => {
    const allowed = can(role, "leads.work");
    const refused: ChatActResult = { ok: false, message: { en: deniedReason("leads.work", "en"), es: deniedReason("leads.work", "es") } };
    const post = async (body: Record<string, unknown>): Promise<ChatActResult> => {
      try {
        const res = await fetch("/api/staff/signup-chats", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const out = (await res.json().catch(() => ({}))) as { thread?: LiveChatThread; code?: string; problems?: ReplyProblem[] };
        if (res.ok && out.thread) return { ok: true, thread: out.thread };
        if (out.code === "reply_rules") return { ok: false, message: msg("This reply breaks a rule on what we can say in writing.", "Esta respuesta rompe una regla de lo que podemos decir por escrito."), problems: out.problems };
        if (out.code === "join_first") return { ok: false, message: msg("Join the chat before writing in it.", "Entra al chat antes de escribir.") };
        return { ok: false, message: msg("That did not go through. Try again.", "No se pudo. Inténtalo de nuevo.") };
      } catch {
        return { ok: false, message: msg("No connection. Try again.", "Sin conexión. Inténtalo de nuevo.") };
      }
    };
    return {
      live,
      async list(): Promise<{ threads: LiveChatThread[]; sample: boolean } | null> {
        if (!allowed) return null;
        if (!live) return { threads: demoThreads(), sample: true };
        try {
          const res = await fetch("/api/staff/signup-chats", { cache: "no-store" });
          return res.ok ? { threads: ((await res.json()) as { threads: LiveChatThread[] }).threads, sample: false } : null;
        } catch {
          return null;
        }
      },
      async waiting(): Promise<number | null> {
        if (!allowed) return null;
        if (!live) return demoWaitingCount();
        try {
          const res = await fetch("/api/staff/signup-chats?count=1", { cache: "no-store" });
          return res.ok ? ((await res.json()) as { waiting: number }).waiting : null;
        } catch {
          return null;
        }
      },
      async thread(caseRef: string): Promise<LiveChatThread | null> {
        if (!allowed) return null;
        if (!live) return demoThread(caseRef);
        try {
          const res = await fetch(`/api/staff/signup-chats?case=${encodeURIComponent(caseRef)}`, { cache: "no-store" });
          return res.ok ? ((await res.json()) as { thread: LiveChatThread }).thread : null;
        } catch {
          return null;
        }
      },
      async join(caseRef: string): Promise<ChatActResult> {
        if (!allowed) return refused;
        if (!live) {
          const t = demoJoin(caseRef, viewer?.name ?? "Equipo");
          return t ? { ok: true, thread: t } : { ok: false, message: msg("Not found.", "No se encontró.") };
        }
        return post({ action: "join", caseRef });
      },
      async reply(caseRef: string, text: string): Promise<ChatActResult> {
        if (!allowed) return refused;
        const problems = checkStaffReply(text, locale);
        if (problems.length > 0) return { ok: false, message: msg("This reply breaks a rule on what we can say in writing.", "Esta respuesta rompe una regla de lo que podemos decir por escrito."), problems };
        if (!live) {
          const t = demoReply(caseRef, viewer?.name ?? "Equipo", text);
          return t ? { ok: true, thread: t } : { ok: false, message: msg("Join the chat before writing in it.", "Entra al chat antes de escribir.") };
        }
        return post({ action: "reply", caseRef, text });
      },
      async handBack(caseRef: string): Promise<ChatActResult> {
        if (!allowed) return refused;
        if (!live) {
          const t = demoHandBack(caseRef);
          return t ? { ok: true, thread: t } : { ok: false, message: msg("Nobody is in this chat.", "Nadie está en este chat.") };
        }
        return post({ action: "hand_back", caseRef });
      },
    };
  }, [live, role, viewer, locale]);
}
