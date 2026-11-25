"use client";

import { useEffect, useState } from "react";
import { aiByline } from "@/lib/brand";
import { useStaffLocale, useText, useTx } from "@/lib/staff/i18n/StaffLocale";
import type { VideoAssistResult } from "@/lib/video/assist";
import { checkVideo, type VideoIssue } from "@/lib/video/check";
import { VIDEO_TEXT } from "@/lib/video/labels";
import type { VideoStudio } from "@/lib/video/store";
import { newVideoId } from "@/lib/video/timeline";
import { VIDEO_FORMATS, VIDEO_LIMITS, type Shot, type VideoFormat, type VideoProject } from "@/lib/video/types";
import { CharacterAvatar } from "@/components/Character";
import Icon from "@/components/Icon";
import { PRIMARY_BUTTON_COMPACT, QUIET_BUTTON, SECONDARY_BUTTON_COMPACT, SectionTitle } from "@/components/staff/ui";
import { FIELD, LABEL, Notice } from "./ui";
import { IssueList } from "./CheckPanel";

// The plan: the brief (what it is for), the script, the shot list, the
// post's words and the call to action. Alti (AI, labelled) can draft the
// script and shots from the brief; the draft is checked line by line and
// nothing is saved until a person uses it and saves.

type Draft = { title: string; brief: VideoProject["brief"]; plan: VideoProject["plan"]; language: VideoProject["language"] };

const draftOf = (p: VideoProject): Draft => ({ title: p.title, brief: p.brief, plan: p.plan, language: p.language });

export function PlanPanel({ project, studio, editable }: { project: VideoProject; studio: VideoStudio; editable: boolean }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const text = useText(VIDEO_TEXT);
  const [draft, setDraft] = useState<Draft>(draftOf(project));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const [alti, setAlti] = useState<VideoAssistResult | null>(null);
  const [altiBusy, setAltiBusy] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(project));

  useEffect(() => {
    if (!dirty) setDraft(draftOf(project));
    // Only when the stored video changes: an edit in progress is kept.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.updatedAt]);

  const merged: VideoProject = { ...project, ...draft };
  const issues = checkVideo(merged, studio.tracks).filter((i) => ["hook", "script", "postCaption", "cta", "video"].includes(i.field));
  const setBrief = (patch: Partial<Draft["brief"]>) => setDraft((d) => ({ ...d, brief: { ...d.brief, ...patch } }));
  const setPlan = (patch: Partial<Draft["plan"]>) => setDraft((d) => ({ ...d, plan: { ...d.plan, ...patch } }));
  const setShot = (id: string, patch: Partial<Shot>) => setPlan({ shots: draft.plan.shots.map((s) => (s.id === id ? { ...s, ...patch } : s)) });

  const save = async () => {
    setSaving(true);
    const result = await studio.act({ action: "update", id: project.id, patch: { title: draft.title, language: draft.language, brief: draft.brief, plan: draft.plan } });
    setSaving(false);
    setMessage(result.ok ? { text: t("Plan guardado.", "Plan saved."), tone: "info" } : { text: result.message[locale], tone: "error" });
  };

  const draftWithAlti = async () => {
    setAltiBusy(true);
    setMessage(null);
    const out = await studio.assist({ language: draft.language, brief: { title: draft.brief.title || draft.title, goal: draft.brief.goal, hook: draft.brief.hook, script: draft.brief.script || draft.plan.script, format: draft.brief.format } });
    setAltiBusy(false);
    if ("error" in out) return setMessage({ text: out.error[locale], tone: "error" });
    setAlti(out);
  };

  const useAlti = () => {
    if (!alti) return;
    setDraft((d) => ({ ...d, brief: { ...d.brief, hook: alti.hook }, plan: { ...d.plan, script: alti.script, shots: alti.shots, postCaption: alti.postCaption, cta: alti.cta, aiDraft: true } }));
    setAlti(null);
    setMessage({ text: t("El borrador de Alti está en el plan. Revísalo y guarda.", "Alti's draft is in the plan. Review it and save."), tone: "info" });
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
      <div className="min-w-0 space-y-5">
        <section aria-labelledby="brief-h">
          <SectionTitle>
            <span id="brief-h">{t("El brief", "The brief")}</span>
          </SectionTitle>
          <div className="card grid gap-3 px-4 py-4 md:grid-cols-2 md:px-5">
            <label className="md:col-span-2">
              <span className={LABEL}>{t("Título", "Title")}</span>
              <input className={`${FIELD} mt-1 h-11`} value={draft.title} maxLength={120} disabled={!editable} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </label>
            <label>
              <span className={LABEL}>{t("Formato", "Format")}</span>
              <select className={`${FIELD} mt-1 h-11`} value={draft.brief.format} disabled={!editable} onChange={(e) => setBrief({ format: e.target.value as VideoFormat })}>
                {VIDEO_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {text.format[f]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className={LABEL}>{t("Idioma del video", "Video's language")}</span>
              <select className={`${FIELD} mt-1 h-11`} value={draft.language} disabled={!editable} onChange={(e) => setDraft({ ...draft, language: e.target.value as "en" | "es" })}>
                <option value="en">English</option>
                <option value="es">Español</option>
              </select>
            </label>
            <label className="md:col-span-2">
              <span className={LABEL}>{t("Objetivo", "Goal")}</span>
              <input className={`${FIELD} mt-1 h-11`} value={draft.brief.goal} maxLength={300} disabled={!editable} onChange={(e) => setBrief({ goal: e.target.value })} />
            </label>
            <label className="md:col-span-2">
              <span className={LABEL}>{text.field.hook}</span>
              <input className={`${FIELD} mt-1 h-11`} value={draft.brief.hook} maxLength={200} disabled={!editable} onChange={(e) => setBrief({ hook: e.target.value })} data-testid="plan-hook" />
            </label>
            {draft.brief.source === "ads" && draft.brief.script ? (
              <div className="rounded-[10px] bg-slate-50 px-3 py-2 text-[13.5px] text-slate-700 md:col-span-2">
                <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{t("Notas del brief", "The brief's notes")}</p>
                <p className="mt-0.5 whitespace-pre-line">{draft.brief.script}</p>
              </div>
            ) : null}
          </div>
        </section>

        <section aria-labelledby="script-h">
          <SectionTitle>
            <span id="script-h">{t("Guion y tomas", "Script and shots")}</span>
            {draft.plan.aiDraft ? <span className="text-[12.5px] font-semibold text-amber-700">{t("Borrador de Alti (IA)", "Alti's draft (AI)")}</span> : null}
          </SectionTitle>
          <div className="card space-y-3 px-4 py-4 md:px-5">
            <label className="block">
              <span className={LABEL}>{text.field.script}</span>
              <textarea className={`${FIELD} mt-1 min-h-32 py-2`} value={draft.plan.script} maxLength={6000} disabled={!editable} onChange={(e) => setPlan({ script: e.target.value })} data-testid="plan-script" />
            </label>
            <div>
              <p className={LABEL}>{t("Tomas", "Shots")}</p>
              {draft.plan.shots.length === 0 ? <p className="mt-1 text-[13.5px] text-slate-500">{t("Sin tomas todavía. Agrégalas o pide un borrador a Alti.", "No shots yet. Add them, or ask Alti for a draft.")}</p> : null}
              <ol className="mt-1 space-y-2">
                {draft.plan.shots.map((shot, i) => (
                  <li key={shot.id} className="grid gap-2 rounded-[12px] bg-slate-50 p-2.5 sm:grid-cols-[48px_76px_minmax(0,1fr)]">
                    <span className="flex h-11 items-center font-display text-[15px] font-semibold text-blue-900 tabular-nums">{i + 1}</span>
                    <label>
                      <span className="sr-only">{t("Segundos", "Seconds")}</span>
                      <input type="number" min={0.5} max={60} step={0.5} className={`${FIELD} h-11`} value={shot.seconds} disabled={!editable} onChange={(e) => setShot(shot.id, { seconds: Number(e.target.value) || 1 })} />
                    </label>
                    <div className="grid min-w-0 gap-2">
                      <label>
                        <span className="sr-only">{t("Qué se ve", "What we see")}</span>
                        <input className={`${FIELD} h-11`} placeholder={t("Qué se ve", "What we see")} value={shot.shot} maxLength={300} disabled={!editable} onChange={(e) => setShot(shot.id, { shot: e.target.value })} />
                      </label>
                      <div className="flex gap-2">
                        <label className="min-w-0 flex-1">
                          <span className="sr-only">{t("Texto en pantalla", "Words on screen")}</span>
                          <input className={`${FIELD} h-11`} placeholder={t("Texto en pantalla", "Words on screen")} value={shot.onScreen} maxLength={VIDEO_LIMITS.textMax} disabled={!editable} onChange={(e) => setShot(shot.id, { onScreen: e.target.value })} />
                        </label>
                        {editable ? (
                          <button type="button" className={QUIET_BUTTON} aria-label={t(`Quitar la toma ${i + 1}`, `Remove shot ${i + 1}`)} onClick={() => setPlan({ shots: draft.plan.shots.filter((s) => s.id !== shot.id) })}>
                            <Icon name="close" size={16} />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
              {editable && draft.plan.shots.length < 30 ? (
                <button type="button" className={`${QUIET_BUTTON} mt-1`} onClick={() => setPlan({ shots: [...draft.plan.shots, { id: newVideoId("sh"), seconds: 3, shot: "", onScreen: "" }] })}>
                  <Icon name="plus" size={16} />
                  {t("Agregar una toma", "Add a shot")}
                </button>
              ) : null}
            </div>
            <label className="block">
              <span className={LABEL}>{text.field.postCaption}</span>
              <textarea className={`${FIELD} mt-1 min-h-20 py-2`} value={draft.plan.postCaption} maxLength={2200} disabled={!editable} onChange={(e) => setPlan({ postCaption: e.target.value })} data-testid="plan-caption" />
            </label>
            <label className="block">
              <span className={LABEL}>{t("Llamada a la acción (en la tarjeta final)", "Call to action (on the end card)")}</span>
              <input className={`${FIELD} mt-1 h-11`} value={draft.plan.cta} maxLength={60} disabled={!editable} onChange={(e) => setPlan({ cta: e.target.value })} />
            </label>
            <IssueList issues={issues} empty={t("Las palabras del plan pasan las reglas.", "The plan's words pass the rules.")} />
            <Notice message={message?.text ?? null} tone={message?.tone} />
            {editable ? (
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={!dirty || saving} onClick={save} className={`${PRIMARY_BUTTON_COMPACT} px-6`} data-testid="plan-save">
                  {saving ? t("Guardando…", "Saving…") : t("Guardar el plan", "Save the plan")}
                </button>
                {dirty ? (
                  <button type="button" onClick={() => setDraft(draftOf(project))} className={SECONDARY_BUTTON_COMPACT}>
                    {t("Deshacer cambios", "Discard changes")}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <aside className="min-w-0" aria-labelledby="alti-video-h">
        <SectionTitle>
          <span id="alti-video-h">{t("Borrador con Alti", "Draft with Alti")}</span>
        </SectionTitle>
        <div className="card px-4 py-4" data-testid="video-alti">
          <div className="flex items-start gap-3">
            <CharacterAvatar character="assistant" size={44} tone="navy" decorative />
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-slate-900">{aiByline(locale)}</p>
              <p className="text-[13px] leading-snug text-slate-500">
                {t(
                  "Con el brief escribo un guion, una lista de tomas, el texto de la publicación y la llamada a la acción, dentro de las reglas. Es un borrador: una persona lo revisa y lo guarda.",
                  "From the brief I write a script, a shot list, the post's words and the call to action, within the rules. It's a draft: a person reviews and saves it.",
                )}
              </p>
            </div>
          </div>
          {editable ? (
            <button type="button" disabled={altiBusy} onClick={draftWithAlti} className={`${SECONDARY_BUTTON_COMPACT} mt-3 w-full gap-1.5`} data-testid="alti-draft">
              <Icon name="sparkle" size={16} />
              {altiBusy ? t("Alti está escribiendo…", "Alti is writing…") : t("Escribir el borrador", "Write the draft")}
            </button>
          ) : null}
          {alti ? <AltiDraft result={alti} onUse={editable ? useAlti : null} /> : null}
        </div>
      </aside>
    </div>
  );
}

function AltiDraft({ result, onUse }: { result: VideoAssistResult; onUse: (() => void) | null }) {
  const t = useTx();
  const blocking = result.issues.filter((i: VideoIssue) => i.severity === "block").length;
  return (
    <div className="mt-3 space-y-2 border-t border-slate-200 pt-3 text-[14px]">
      <p className="text-[12px] font-semibold text-amber-700">
        {result.source === "model" ? t("Borrador de Alti (IA)", "Draft by Alti (AI)") : t("Borrador de Alti (IA), desde una plantilla revisada", "Draft by Alti (AI), from a checked template")}
      </p>
      <p>
        <span className="font-semibold text-slate-900">{t("Gancho: ", "Hook: ")}</span>
        {result.hook}
      </p>
      <p className="whitespace-pre-line text-slate-700">{result.script}</p>
      <ol className="list-decimal space-y-1 pl-5 text-[13.5px] text-slate-700">
        {result.shots.map((s) => (
          <li key={s.id}>
            <span className="tabular-nums text-slate-500">{s.seconds}s · </span>
            {s.shot}
            {s.onScreen ? <span className="text-slate-500"> — «{s.onScreen}»</span> : null}
          </li>
        ))}
      </ol>
      <IssueList issues={result.issues} empty={t("Pasa las reglas.", "Passes the rules.")} />
      {onUse ? (
        <button type="button" onClick={onUse} className={`${PRIMARY_BUTTON_COMPACT} w-full`} data-testid="alti-use">
          {blocking > 0 ? t("Usarlo y corregirlo", "Use it and fix it") : t("Usar este borrador", "Use this draft")}
        </button>
      ) : null}
    </div>
  );
}
