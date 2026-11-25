"use client";

import { aiByline, teamByline } from "@/lib/brand";
import { shortDateTime } from "@/lib/staff/format";
import type { LeadMessage, LeadStage } from "@/lib/leads/types";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";

// Small pieces of the lead inbox.

export function stageTone(stage: LeadStage): string {
  switch (stage) {
    case "new":
      return "bg-amber-100 text-blue-900";
    case "contacted":
    case "qualified":
      return "bg-blue-50 text-blue-700";
    case "invited":
      return "bg-blue-100 text-blue-900";
    case "signed":
      return "bg-green-50 text-green-700";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

/**
 * One message, like WhatsApp: the lead on the left; the team and Alti on the
 * right. Alti's carry "Alti · AI assistant" (never a person's name); a
 * teammate's carry their own name; HighLevel's say they were read from there.
 */
export function Bubble({ message }: { message: LeadMessage }) {
  const { locale } = useStaffLocale();
  const t = useTx();
  const mine = message.role === "assistant";
  const who =
    message.role === "user"
      ? null
      : message.source === "human"
        ? teamByline(message.authorName ?? "", locale)
        : message.source === "highlevel"
          ? t("Escrito en HighLevel", "Written in HighLevel")
          : aiByline(locale);
  // The AI label is already the first line of an automatic message: shown once, as the byline.
  const text = message.source === "coach" || message.source === "journey" ? message.text.replace(/^🤖\s*Alti · [^\n]*\n/, "").replace(/^🤖\s*/, "") : message.text;
  const tone =
    message.role === "user"
      ? "bg-white text-slate-900 shadow-[0_0_0_1px_rgba(0,0,0,0.06)]"
      : message.source === "human"
        ? "bg-blue-900 text-white"
        : message.source === "highlevel"
          ? "bg-slate-200 text-slate-900"
          : "bg-amber-50 text-slate-900 shadow-[0_0_0_1px_rgba(239,181,55,0.45)]";
  return (
    <li className={`flex ${mine ? "justify-end" : "justify-start"}`} data-testid="lead-message" data-source={message.source}>
      <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 sm:max-w-[75%] ${tone} ${mine ? "rounded-br-md" : "rounded-bl-md"}`}>
        {who && <p className={`mb-0.5 text-[11.5px] font-semibold ${message.source === "human" ? "text-blue-100" : "text-slate-500"}`}>{who}</p>}
        <p className="whitespace-pre-wrap break-words text-[14.5px] leading-snug">{text}</p>
        <p className={`mt-1 text-right text-[11px] tabular-nums ${message.source === "human" ? "text-blue-200" : "text-slate-500"}`}>{shortDateTime(message.at, locale)}</p>
      </div>
    </li>
  );
}
