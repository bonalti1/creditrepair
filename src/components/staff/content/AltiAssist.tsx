"use client";

import { useState } from "react";
import { aiByline } from "@/lib/brand";
import type { AssistRequest, AssistResult } from "@/lib/content/assist";
import { blockingIssues } from "@/lib/content/check";
import { languagesOf, type Bilingual, type ContentPiece, type PieceCopy } from "@/lib/content/types";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { CharacterAvatar } from "@/components/Character";
import { PRIMARY_BUTTON_COMPACT, SECONDARY_BUTTON_COMPACT, SectionTitle } from "@/components/staff/ui";
import { IssueLine } from "./PieceChecks";
import { FIELD, Notice } from "./ui";

// Alti's writing assistant on a piece. Alti is AI and says so: the panel is
// labelled "Alti · AI assistant" and every output is marked as his draft. The
// words go through the same check as the piece, here and again once inserted;
// "Use these words" puts them in the editor, where a person reads, edits and
// saves them. Nothing is approved or published from here.

export function AltiAssist({ piece, open, onUse, assist }: { piece: ContentPiece; open: boolean; onUse: (copy: Partial<PieceCopy>) => void; assist: (r: AssistRequest) => Promise<AssistResult | { error: Bilingual }> }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const [show, setShow] = useState(open);
  const [topic, setTopic] = useState(piece.goal || piece.title);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AssistResult | null>(null);
  const [hook, setHook] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const langs = languagesOf(piece.language);

  const write = async () => {
    setBusy(true);
    setError(null);
    const out = await assist({ topic, type: piece.type, audience: piece.audience, theme: piece.theme });
    setBusy(false);
    if ("error" in out) return setError(out.error[locale]);
    setResult(out);
    setHook(0);
  };

  const use = () => {
    if (!result) return;
    const pick = (b: Bilingual): Bilingual => ({ en: langs.includes("en") ? b.en : "", es: langs.includes("es") ? b.es : "" });
    onUse({ hook: pick(result.hooks[hook] ?? result.hooks[0]!), onScreen: pick(result.onScreen), script: pick(result.script), caption: pick(result.caption), cta: pick(result.cta) });
  };

  const Pair = ({ label, value }: { label: string; value: Bilingual }) => (
    <div>
      <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <div className={`mt-1 grid gap-2 ${langs.length > 1 ? "sm:grid-cols-2" : ""}`}>
        {langs.map((l) => (
          <p key={l} lang={l} className="whitespace-pre-line rounded-xl bg-slate-50 px-3 py-2 text-[14px] leading-snug text-slate-800">
            <span className="mr-1 text-[11px] font-semibold text-slate-500">{l.toUpperCase()}</span>
            {value[l] || <span className="text-slate-400">—</span>}
          </p>
        ))}
      </div>
    </div>
  );

  return (
    <section aria-labelledby="alti-title" data-testid="alti-assist">
      <SectionTitle>
        <span id="alti-title">{t("Escribir con Alti", "Write with Alti")}</span>
      </SectionTitle>
      <div className="card px-4 py-4">
        <div className="flex items-start gap-3">
          <CharacterAvatar character="assistant" size={44} tone="navy" decorative />
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-slate-900">{aiByline(locale)}</p>
            <p className="text-[13px] leading-snug text-slate-500">
              {t(
                "Ideas de gancho, guion con texto en pantalla y el texto de la publicación, en inglés y español, dentro de las reglas. Es un borrador: léelo y edítalo.",
                "Hook ideas, a script with on-screen text and a caption, in English and Spanish, within the rules. It's a draft: read and edit it.",
              )}
            </p>
          </div>
        </div>
        {!show ? (
          <button type="button" onClick={() => setShow(true)} className={`${SECONDARY_BUTTON_COMPACT} mt-3 px-5`}>
            {t("Pedirle un borrador", "Ask for a draft")}
          </button>
        ) : (
          <form
            className="mt-3 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void write();
            }}
          >
            <label className="block text-[13px] font-medium text-slate-700">
              {t("Tema", "Topic")}
              <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={300} className={`${FIELD} mt-1 h-11`} />
            </label>
            <button type="submit" disabled={busy || topic.trim().length < 3} className={`${PRIMARY_BUTTON_COMPACT} px-5`} data-testid="alti-write">
              {busy ? t("Alti está escribiendo…", "Alti is writing…") : t("Escribir el borrador", "Write the draft")}
            </button>
          </form>
        )}
        {error ? (
          <div className="mt-3">
            <Notice message={error} tone="error" />
          </div>
        ) : null}
        {result ? (
          <div className="mt-4 space-y-3 border-t hairline pt-4" aria-live="polite" data-testid="alti-result">
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-[13px] leading-snug text-blue-900">
              <span className="font-semibold">{t("Borrador de Alti (IA).", "Draft by Alti (AI).")}</span>{" "}
              {result.source === "model"
                ? t("Lo escribió el modelo de IA; pasó por las mismas reglas.", "Written by the AI model; run through the same rules.")
                : t("Hecho con una plantilla ya revisada (el servidor no tiene la clave de IA).", "Built from a pre-checked template (the server has no AI key).")}
            </p>
            <fieldset>
              <legend className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{t("Ganchos: elige uno", "Hooks: pick one")}</legend>
              <ul className="mt-1 space-y-1.5">
                {result.hooks.map((h, i) => (
                  <li key={i}>
                    <label className={`flex cursor-pointer gap-2.5 rounded-xl px-3 py-2 ring-1 ${hook === i ? "bg-blue-50 ring-blue-300" : "ring-slate-200"}`}>
                      <input type="radio" name="hook" checked={hook === i} onChange={() => setHook(i)} className="mt-1 h-4 w-4 accent-blue-700" />
                      <span className="text-[14px] leading-snug text-slate-800">
                        {langs.map((l) => (
                          <span key={l} lang={l} className="block">
                            <span className="mr-1 text-[11px] font-semibold text-slate-500">{l.toUpperCase()}</span>
                            {h[l]}
                          </span>
                        ))}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
            <Pair label={t("Texto en pantalla", "On-screen text")} value={result.onScreen} />
            <Pair label={t("Guion", "Script")} value={result.script} />
            <Pair label={t("Texto de la publicación", "Caption")} value={result.caption} />
            <Pair label={t("Llamada a la acción", "Call to action")} value={result.cta} />
            {result.issues.length > 0 ? (
              <ul className="space-y-1.5">
                {result.issues.map((issue) => (
                  <IssueLine key={issue.id} issue={issue} />
                ))}
              </ul>
            ) : (
              <p className="text-[13.5px] text-blue-900">{t("Pasa todas las reglas. Aun así, léelo: es un borrador.", "It passes every rule. Still, read it: it's a draft.")}</p>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={use} className={`${PRIMARY_BUTTON_COMPACT} px-5`} data-testid="alti-use">
                {t("Usar este texto", "Use these words")}
              </button>
              <button type="button" onClick={() => void write()} disabled={busy} className={SECONDARY_BUTTON_COMPACT}>
                {t("Otra versión", "Another version")}
              </button>
            </div>
            {blockingIssues(result.issues).length > 0 ? <p className="text-[12.5px] text-slate-500">{t("Si lo usas, corrige lo marcado antes de mandarlo a revisión.", "If you use it, fix what is marked before sending it for review.")}</p> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
