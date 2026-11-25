"use client";

import { useState } from "react";
import { can, deniedReason } from "@/lib/staff/permissions";
import { useStaffLocale, useText, useTx } from "@/lib/staff/i18n/StaffLocale";
import { blockingVideoIssues, checkVideo, videoApprovalBlockers, videoChecklist, type VideoIssue } from "@/lib/video/check";
import { currentExport } from "@/lib/video/hash";
import { VIDEO_TEXT } from "@/lib/video/labels";
import type { VideoStudio } from "@/lib/video/store";
import { newVideoId } from "@/lib/video/timeline";
import type { VideoChecklistKey, VideoProject } from "@/lib/video/types";
import Icon from "@/components/Icon";
import { DeniedNote, PRIMARY_BUTTON, QUIET_BUTTON, SECONDARY_BUTTON_COMPACT, SectionTitle } from "@/components/staff/ui";
import { FIELD, LABEL, Notice } from "./ui";

// Check before approval (docs/VIDEO.md): every word through the claim rules,
// the checklist (rights to the footage and the music, a client only with
// written consent on record, Alti's AI label, no score on screen, captions
// that match), then the approval, which needs content.approve and an export
// of exactly this version.

export function IssueList({ issues, empty }: { issues: readonly VideoIssue[]; empty?: string }) {
  const { locale } = useStaffLocale();
  const text = useText(VIDEO_TEXT);
  if (issues.length === 0) {
    return empty ? (
      <p className="flex items-center gap-1.5 text-[13.5px] font-medium text-green-700">
        <Icon name="check" size={16} />
        {empty}
      </p>
    ) : null;
  }
  return (
    <ul className="space-y-1.5" data-testid="video-issues">
      {issues.map((issue) => (
        <li key={issue.id} className={`rounded-[10px] px-3 py-2 text-[13.5px] leading-snug ${issue.severity === "block" ? "bg-red-50 text-red-800" : "bg-amber-50 text-blue-900"}`} data-severity={issue.severity}>
          <p>
            <span className="font-semibold">{text.field[issue.field]}</span>
            {issue.match ? <span className="text-slate-600"> · «{issue.match}»</span> : null}
          </p>
          <p className="mt-0.5">{issue.explain[locale]}</p>
          <p className="mt-0.5 text-slate-600">{issue.fix[locale]}</p>
        </li>
      ))}
    </ul>
  );
}

export function CheckPanel({ project, studio }: { project: VideoProject; studio: VideoStudio }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const [message, setMessage] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const [note, setNote] = useState("");
  const [consent, setConsent] = useState({ name: "", signedOn: "", where: "" });
  const [busy, setBusy] = useState(false);
  const issues = checkVideo(project, studio.tracks);
  const blocking = blockingVideoIssues(issues);
  const checklist = videoChecklist(project, studio.tracks, issues);
  const blockers = videoApprovalBlockers(project, studio.tracks);
  const mayEdit = can(studio.role, "content.edit") && !["published", "archived"].includes(project.status);
  const mayApprove = can(studio.role, "content.approve");
  const exported = currentExport(project);

  const run = async (fn: () => Promise<{ ok: boolean; message?: { en: string; es: string } }>, ok: string) => {
    setBusy(true);
    const result = await fn();
    setBusy(false);
    setMessage(result.ok ? { text: ok, tone: "info" } : { text: result.message?.[locale] ?? t("No se pudo.", "It didn't work."), tone: "error" });
  };
  const tick = (key: VideoChecklistKey, value: boolean) => run(() => studio.act({ action: "update", id: project.id, patch: { checklist: { [key]: value } } }), t("Lista actualizada.", "Checklist updated."));
  const appears = (value: boolean) => run(() => studio.act({ action: "update", id: project.id, patch: { clientAppears: value } }), t("Guardado.", "Saved."));
  const addConsent = () => {
    if (consent.name.trim().length < 2 || !consent.signedOn || consent.where.trim().length < 2) {
      setMessage({ text: t("Escribe el nombre, la fecha de la firma y dónde se guarda el consentimiento.", "Write the name, the date it was signed and where the consent is kept."), tone: "error" });
      return;
    }
    const record = { id: newVideoId("cn"), name: consent.name.trim(), signedOn: consent.signedOn, where: consent.where.trim(), recordedBy: studio.handle, recordedAt: new Date().toISOString() };
    void run(async () => {
      const r = await studio.act({ action: "update", id: project.id, patch: { consents: [...project.consents, record] } });
      if (r.ok) setConsent({ name: "", signedOn: "", where: "" });
      return r;
    }, t("Consentimiento registrado.", "Consent recorded."));
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section aria-labelledby="words-h" className="min-w-0">
        <SectionTitle>
          <span id="words-h">{t("Las palabras", "The words")}</span>
          <span className={`text-[13px] font-semibold ${blocking.length ? "text-red-700" : "text-green-700"}`} data-testid="check-count">
            {blocking.length ? t(`${blocking.length} por resolver`, `${blocking.length} to resolve`) : t("Sin bloqueos", "Nothing blocking")}
          </span>
        </SectionTitle>
        <div className="card px-4 py-4">
          <p className="mb-3 text-[13.5px] leading-snug text-slate-600">
            {t(
              "Cada título, subtítulo, tarjeta, el guion y el texto de la publicación pasan por las mismas reglas que todo el contenido: nada de resultados prometidos, nada «gratis», ningún puntaje, sin presión, solo Texas.",
              "Every title, caption, card, the script and the post's words go through the same rules as all content: no promised results, nothing called free, no scores, no pressure, Texas only.",
            )}
          </p>
          <IssueList issues={issues} empty={t("Todas las palabras pasan las reglas.", "Every word passes the rules.")} />
        </div>
      </section>

      <div className="min-w-0 space-y-5">
        <section aria-labelledby="checklist-h">
          <SectionTitle>
            <span id="checklist-h">{t("Lista antes de aprobar", "Checklist before approval")}</span>
          </SectionTitle>
          <div className="card px-4 py-4">
            <ul className="space-y-2" data-testid="video-checklist">
              {checklist.map((item) => (
                <li key={item.key} className="flex items-start gap-3">
                  {item.by === "person" ? (
                    <input
                      id={`chk-${item.key}`}
                      type="checkbox"
                      className="mt-1 h-5 w-5 shrink-0 accent-blue-900"
                      checked={item.done}
                      disabled={!mayEdit || busy}
                      onChange={(e) => tick(item.key as VideoChecklistKey, e.target.checked)}
                      data-testid={`chk-${item.key}`}
                    />
                  ) : (
                    <span aria-hidden="true" className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${item.done ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                      <Icon name={item.done ? "check" : "close"} size={14} />
                    </span>
                  )}
                  <label htmlFor={item.by === "person" ? `chk-${item.key}` : undefined} className="min-w-0 text-[14px] leading-snug">
                    <span className="font-medium text-slate-900">{item.label[locale]}</span>
                    {item.by === "app" ? <span className="ml-1 text-[12px] text-slate-500">{t("(lo decide la app)", "(the app decides)")}</span> : null}
                    <span className="block text-[13px] text-slate-500">{item.hint[locale]}</span>
                    <span className="sr-only">{item.done ? t("Hecho", "Done") : t("Falta", "Missing")}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="consent-h">
          <SectionTitle>
            <span id="consent-h">{t("¿Aparece un cliente?", "Does a client appear?")}</span>
          </SectionTitle>
          <div className="card space-y-3 px-4 py-4">
            <p className="text-[13.5px] leading-snug text-slate-600">
              {t("Su cara, su voz o su nombre. Un cliente sale solo con un consentimiento por escrito, firmado y registrado aquí.", "Their face, voice or name. A client appears only with written, signed consent recorded here.")}
            </p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby="consent-h">
              {[
                { value: false, label: t("No, ningún cliente", "No client") },
                { value: true, label: t("Sí, aparece un cliente", "Yes, a client appears") },
              ].map((option) => (
                <button
                  key={String(option.value)}
                  type="button"
                  role="radio"
                  aria-checked={project.clientAppears === option.value}
                  disabled={!mayEdit || busy}
                  onClick={() => appears(option.value)}
                  className={`pressable inline-flex h-11 items-center rounded-full border px-4 text-[14px] font-semibold ${project.clientAppears === option.value ? "border-blue-900 bg-blue-900 text-white" : "border-slate-300 bg-white text-slate-700"}`}
                  data-testid={option.value ? "client-yes" : "client-no"}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {project.clientAppears ? (
              <div className="space-y-2">
                {project.consents.length > 0 ? (
                  <ul className="space-y-1.5">
                    {project.consents.map((c) => (
                      <li key={c.id} className="rounded-[10px] bg-green-50 px-3 py-2 text-[13.5px] text-green-800">
                        <span className="font-semibold">{c.name}</span> · {t("firmado el", "signed on")} {c.signedOn} · {c.where}
                        <span className="block text-[12px] text-green-700">{t(`Registrado por ${c.recordedBy}`, `Recorded by ${c.recordedBy}`)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {mayEdit ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label>
                      <span className={LABEL}>{t("Nombre de la persona", "The person's name")}</span>
                      <input className={`${FIELD} mt-1 h-11`} value={consent.name} maxLength={120} onChange={(e) => setConsent({ ...consent, name: e.target.value })} />
                    </label>
                    <label>
                      <span className={LABEL}>{t("Fecha de la firma", "Date signed")}</span>
                      <input type="date" className={`${FIELD} mt-1 h-11`} value={consent.signedOn} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setConsent({ ...consent, signedOn: e.target.value })} />
                    </label>
                    <label className="sm:col-span-2">
                      <span className={LABEL}>{t("Dónde se guarda el consentimiento firmado", "Where the signed consent is kept")}</span>
                      <input className={`${FIELD} mt-1 h-11`} value={consent.where} maxLength={300} onChange={(e) => setConsent({ ...consent, where: e.target.value })} />
                    </label>
                    <button type="button" disabled={busy} onClick={addConsent} className={`${SECONDARY_BUTTON_COMPACT} sm:col-span-2`}>
                      {t("Registrar el consentimiento", "Record the consent")}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>

        <section aria-labelledby="approval-h">
          <SectionTitle>
            <span id="approval-h">{t("Aprobación", "Approval")}</span>
          </SectionTitle>
          <div className="card space-y-3 px-4 py-4" data-testid="approval-panel">
            {project.approval ? (
              <p className="rounded-[10px] bg-green-50 px-3 py-2 text-[14px] text-green-800">
                {t(`Aprobado por ${project.approval.by}.`, `Approved by ${project.approval.by}.`)} {t("Cualquier cambio quita la aprobación.", "Any change drops the approval.")}
              </p>
            ) : null}
            {project.changesNote ? (
              <p className="rounded-[10px] bg-amber-50 px-3 py-2 text-[14px] text-blue-900">
                <span className="font-semibold">{t("Cambios pedidos: ", "Changes asked: ")}</span>
                {project.changesNote}
              </p>
            ) : null}
            {!exported && ["planned", "editing", "ready"].includes(project.status) ? (
              <p className="text-[13.5px] text-slate-600">{t("Primero exporta el MP4 de esta versión en el editor: lo aprobado es ese archivo.", "First export the MP4 of this version in the editor: what is approved is that file.")}</p>
            ) : null}
            {["planned", "editing"].includes(project.status) && mayEdit ? (
              <button type="button" disabled={busy || !exported} onClick={() => run(() => studio.act({ action: "submit", id: project.id }), t("Enviado a aprobación.", "Sent for approval."))} className={`${PRIMARY_BUTTON} w-full`} data-testid="submit-video">
                {t("Mandar a aprobación", "Send for approval")}
              </button>
            ) : null}
            {project.status === "ready" ? (
              mayApprove ? (
                <div className="space-y-2">
                  {blockers.length > 0 ? (
                    <ul className="space-y-1 text-[13.5px] text-red-700" data-testid="approval-blockers">
                      {blockers.map((b) => (
                        <li key={b.code} className="flex gap-1.5">
                          <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-red-600" />
                          {b.text[locale]}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <button type="button" disabled={busy || blockers.length > 0} onClick={() => run(() => studio.act({ action: "approve", id: project.id }), t("Aprobado. Ya se puede pasar a Contenido.", "Approved. It can go to Content now."))} className={`${PRIMARY_BUTTON} w-full`} data-testid="approve-video">
                    {t("Aprobar este video", "Approve this video")}
                  </button>
                </div>
              ) : (
                <DeniedNote>{deniedReason("content.approve", locale)}</DeniedNote>
              )
            ) : null}
            {mayApprove && ["ready", "approved"].includes(project.status) ? (
              <div className="space-y-2 border-t border-slate-200 pt-3">
                <label className="block">
                  <span className={LABEL}>{t("Pedir cambios (qué cambiar)", "Ask for changes (what to change)")}</span>
                  <textarea className={`${FIELD} mt-1 min-h-16 py-2`} value={note} maxLength={600} onChange={(e) => setNote(e.target.value)} />
                </label>
                <button
                  type="button"
                  disabled={busy || note.trim().length < 3}
                  onClick={() => run(async () => {
                    const r = await studio.act({ action: "request_changes", id: project.id, note });
                    if (r.ok) setNote("");
                    return r;
                  }, t("Devuelto con la nota.", "Sent back with the note."))}
                  className={SECONDARY_BUTTON_COMPACT}
                >
                  {t("Devolver con cambios", "Send back with changes")}
                </button>
              </div>
            ) : null}
            {project.status === "ready" && mayEdit && !mayApprove ? (
              <button type="button" disabled={busy} onClick={() => run(() => studio.act({ action: "move", id: project.id, to: "editing" }), t("De vuelta en edición.", "Back to editing."))} className={QUIET_BUTTON}>
                {t("Volver a edición", "Back to editing")}
              </button>
            ) : null}
            <Notice message={message?.text ?? null} tone={message?.tone} />
          </div>
        </section>
      </div>
    </div>
  );
}
