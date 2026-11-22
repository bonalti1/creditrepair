"use client";

import { useState } from "react";
import { consentHash, consentText, SHARE_LEVEL_LABEL, SHARE_LEVELS, type L, type PartnerProgress, type ShareLevel, type SharingLevel } from "@/lib/partners/sharing";
import { CLIENT_SHARING_COPY } from "@/lib/partners/sharingCopy";
import ClientProgressView from "./ClientProgressView";

// The client's choice for one partner: No compartir (the default) / Solo el
// avance / Avance y resumen, the exact consent text for the option selected
// (what the partner will and will never see), and a preview of the partner's
// screen built from the client's own facts. Saving sends the hash of the text
// on screen; the server recomputes it and refuses other words.

export interface SharePartnerFace {
  name: string;
  company: string | null;
  logo?: string | null;
}

export type SaveResult = { ok: true; unchanged?: boolean } | { ok: false; message: string };

export function PartnerBadge({ partner, line }: { partner: SharePartnerFace; line: string }) {
  return (
    <div className="flex items-center gap-3">
      {partner.logo ? (
        // A data URL an administrator approved (partners/logo.ts): nothing loads from another server.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={partner.logo} alt="" className="h-11 w-11 shrink-0 rounded-xl border hairline bg-white object-contain" />
      ) : (
        <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[16px] font-semibold text-blue-700">
          {partner.name.trim().slice(0, 1)}
        </span>
      )}
      <div className="min-w-0">
        <p className="text-[12.5px] font-medium text-slate-500">{line}</p>
        <p className="truncate text-[16px] font-semibold text-slate-900">
          {partner.name}
          {partner.company && <span className="font-normal text-slate-500"> · {partner.company}</span>}
        </p>
      </div>
    </div>
  );
}

export default function ShareChoice({
  partner,
  current,
  locale,
  now,
  preview,
  onSave,
  saveLabel,
}: {
  partner: SharePartnerFace;
  current: ShareLevel;
  locale: L;
  now: Date;
  /** The client's own facts as the partner would see them, at a level. */
  preview: (level: SharingLevel) => PartnerProgress | null;
  onSave: (level: ShareLevel, textHash: string) => Promise<SaveResult>;
  saveLabel?: string;
}) {
  const c = CLIENT_SHARING_COPY[locale];
  const [level, setLevel] = useState<ShareLevel>(current);
  const [state, setState] = useState<{ kind: "idle" | "saving" } | { kind: "done"; text: string; ok: boolean }>({ kind: "idle" });
  const text = consentText(level, partner, locale);
  const shown = level === "none" ? null : preview(level);

  const save = async () => {
    setState({ kind: "saving" });
    const result = await onSave(level, consentHash(level, partner, locale));
    setState(result.ok ? { kind: "done", ok: true, text: result.unchanged ? c.unchanged : c.saved } : { kind: "done", ok: false, text: result.message });
  };

  return (
    <div className="space-y-4" data-testid="share-choice">
      <fieldset>
        <legend className="px-1 pb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500">{c.chooseTitle}</legend>
        <div className="card overflow-hidden">
          {SHARE_LEVELS.map((option, i) => (
            <label key={option} className={`flex cursor-pointer items-center gap-3 px-4 py-3.5 ${i > 0 ? "border-t hairline" : ""} ${level === option ? "bg-blue-50/60" : ""}`}>
              <input type="radio" name="share-level" value={option} checked={level === option} onChange={() => setLevel(option)} className="h-5 w-5 shrink-0 accent-blue-700" />
              <span className="flex-1 text-[16px] font-medium text-slate-900">{SHARE_LEVEL_LABEL[locale][option]}</span>
              {current === option && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{c.current}</span>}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="card space-y-3 p-5 text-[14.5px] leading-relaxed text-slate-700" data-testid="consent-text">
        <p className="text-[16px] font-semibold text-slate-900">{text.lead}</p>
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wide text-green-700">{c.willTitle}</p>
          <ul className="mt-1 space-y-1">
            {text.will.map((line) => (
              <li key={line} className="flex gap-2">
                <span aria-hidden="true" className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-green-600" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wide text-red-700">{c.neverTitle}</p>
          <ul className="mt-1 space-y-1">
            {text.never.map((line) => (
              <li key={line} className="flex gap-2">
                <span aria-hidden="true" className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
        {text.notes.map((line) => (
          <p key={line} className="text-[13px] text-slate-500">{line}</p>
        ))}
      </div>

      {shown && (
        <section aria-label={c.previewTitle(partner.name)} data-testid="share-preview">
          <h3 className="px-1 pb-1 text-[13px] font-semibold uppercase tracking-wide text-slate-500">{c.previewTitle(partner.name)}</h3>
          <p className="px-1 pb-2 text-[12.5px] text-slate-500">{c.previewNote}</p>
          <div className="rounded-3xl border-2 border-dashed border-slate-300 p-2.5">
            <ClientProgressView progress={shown} locale={locale} now={now} compact />
          </div>
        </section>
      )}

      <button
        type="button"
        onClick={save}
        disabled={state.kind === "saving"}
        className="pressable flex h-12 w-full items-center justify-center rounded-full bg-blue-900 text-[16px] font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500"
      >
        {state.kind === "saving" ? c.saving : (saveLabel ?? c.save)}
      </button>
      {state.kind === "done" && (
        <p className={`rounded-2xl px-4 py-3 text-[14px] ${state.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`} role="status">
          {state.text}
        </p>
      )}
    </div>
  );
}
