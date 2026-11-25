"use client";

import { useState } from "react";
import type { ContentIssue } from "@/lib/content/check";
import { languagesOf, type ContentPiece, type CopyField, type CopyLang } from "@/lib/content/types";
import { useTx } from "@/lib/staff/i18n/StaffLocale";
import { IssueLine } from "./PieceChecks";
import { FIELD } from "./ui";

// The piece's words, in each of its languages: hook, on-screen text, script,
// caption, call to action. The check runs on every keystroke and each issue
// shows under the field and language it is in. Side by side on a wide screen;
// one language at a time (tabs) on a phone.

const FIELDS: Array<{ key: CopyField; label: [string, string]; help: [string, string]; rows: number; max: number }> = [
  { key: "hook", label: ["Gancho (primeros 3 segundos)", "Hook (first 3 seconds)"], help: ["Menos de 12 palabras.", "Under 12 words."], rows: 2, max: 400 },
  { key: "onScreen", label: ["Texto en pantalla", "On-screen text"], help: ["Las pocas palabras que se ven en grande.", "The few words shown big."], rows: 2, max: 400 },
  { key: "script", label: ["Guion (lo que se dice)", "Script (what is said)"], help: ["Para video: 15 a 30 segundos, frases cortas.", "For video: 15 to 30 seconds, short sentences."], rows: 5, max: 6000 },
  { key: "caption", label: ["Texto de la publicación", "Caption"], help: ["Termina con \"Los resultados varían\".", "End with \"Results vary\"."], rows: 4, max: 2200 },
  { key: "cta", label: ["Llamada a la acción", "Call to action"], help: ["2 a 4 palabras, sin presión.", "2 to 4 words, no pressure."], rows: 1, max: 400 },
];

const LANG_NAME: Record<CopyLang, [string, string]> = { en: ["Inglés", "English"], es: ["Español", "Spanish"] };

export function PieceWords({ piece, issues, editable, onChange }: { piece: ContentPiece; issues: ContentIssue[]; editable: boolean; onChange: (field: CopyField, lang: CopyLang, value: string) => void }) {
  const t = useTx();
  const langs = languagesOf(piece.language);
  const [tab, setTab] = useState<CopyLang>(langs[0]!);
  const shownTab = langs.includes(tab) ? tab : langs[0]!;

  return (
    <div data-testid="piece-words">
      {langs.length > 1 ? (
        <div className="mb-3 inline-flex rounded-full bg-slate-100 p-1 lg:hidden" role="tablist" aria-label={t("Idioma del texto", "Language of the words")}>
          {langs.map((l) => (
            <button key={l} type="button" role="tab" aria-selected={shownTab === l} onClick={() => setTab(l)} className={`h-9 rounded-full px-4 text-[14px] font-medium ${shownTab === l ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}>
              {t(...LANG_NAME[l])}
            </button>
          ))}
        </div>
      ) : null}
      <div className="space-y-5">
        {FIELDS.map((f) => (
          <fieldset key={f.key} className="min-w-0">
            <legend className="text-[14px] font-semibold text-slate-900">{t(...f.label)}</legend>
            <p className="text-[12.5px] text-slate-500">{t(...f.help)}</p>
            <div className={`mt-2 grid gap-3 ${langs.length > 1 ? "lg:grid-cols-2" : ""}`}>
              {langs.map((lang) => {
                const here = issues.filter((i) => i.field === f.key && (i.lang === lang || (i.lang === null && lang === langs[0])));
                const id = `${f.key}-${lang}`;
                return (
                  <div key={lang} className={langs.length > 1 && shownTab !== lang ? "hidden lg:block" : ""}>
                    <label htmlFor={id} className="mb-1 block text-[12px] font-semibold uppercase tracking-wide text-slate-500">
                      {t(...LANG_NAME[lang])}
                    </label>
                    <textarea
                      id={id}
                      value={piece.copy[f.key][lang]}
                      onChange={(e) => onChange(f.key, lang, e.target.value)}
                      readOnly={!editable}
                      rows={f.rows}
                      maxLength={f.max}
                      lang={lang}
                      aria-invalid={here.some((i) => i.severity === "block") || undefined}
                      aria-describedby={here.length ? `${id}-issues` : undefined}
                      className={`${FIELD} resize-y py-2 leading-snug ${here.some((i) => i.severity === "block") ? "ring-red-300" : ""}`}
                    />
                    {here.length > 0 ? (
                      <ul id={`${id}-issues`} className="mt-2 space-y-1.5">
                        {here.map((issue) => (
                          <IssueLine key={issue.id} issue={issue} showWhere={false} />
                        ))}
                      </ul>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
    </div>
  );
}
