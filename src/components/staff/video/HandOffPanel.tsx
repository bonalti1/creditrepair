"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { STATUS_LABEL, THEME_LABEL } from "@/lib/content/labels";
import { readDemoContentBoard, useContent } from "@/lib/content/store";
import { emptyCopy, THEMES, type ChecklistKey, type ContentPiece, type Theme } from "@/lib/content/types";
import { can, deniedReason } from "@/lib/staff/permissions";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { aiByline } from "@/lib/brand";
import { approvalHolds } from "@/lib/video/hash";
import { FORMAT_CHANNELS } from "@/lib/video/labels";
import type { VideoStudio } from "@/lib/video/store";
import type { VideoProject } from "@/lib/video/types";
import Icon from "@/components/Icon";
import { DeniedNote, PRIMARY_BUTTON, SectionTitle } from "@/components/staff/ui";
import { FIELD, LABEL, Notice } from "./ui";

// Hand-off to Content (docs/VIDEO.md): an approved video becomes (or joins)
// a Content piece, with its words and the exported MP4 as the piece's file,
// and goes to the piece's review. From there the existing publishing posts
// it (Meta, TikTok, YouTube: src/lib/content/publish), under its own gates:
// no publishing code here. Every step is the content hub's own action
// (useContent: create, update, upload, submit), each safe to run again: a
// step already done is skipped, so a hand-off that stopped halfway finishes.

const OPEN: readonly ContentPiece["status"][] = ["idea", "planned", "in_production", "changes"];

export function HandOffPanel({ project, studio }: { project: VideoProject; studio: VideoStudio }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const content = useContent();
  const [mode, setMode] = useState<"new" | "attach">("new");
  const [attachTo, setAttachTo] = useState("");
  const [theme, setTheme] = useState<Theme>("process");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const exportRecord = project.exports.find((e) => project.approval && e.hash === project.approval.hash) ?? null;
  const piece = project.contentPieceId ? content.pieces.find((p) => p.id === project.contentPieceId) ?? null : null;
  const candidates = useMemo(() => content.pieces.filter((p) => OPEN.includes(p.status) || p.status === "review"), [content.pieces]);
  const mayHandOff = can(studio.role, "content.edit");

  if (project.status === "published") {
    return (
      <div className="card px-4 py-5" data-testid="handoff-done">
        <p className="text-[15px] text-slate-800">{t("Este video ya está en Contenido. Se publica desde la pieza, con sus propias reglas y su aprobación.", "This video is in Content now. It is posted from the piece, under its own rules and approval.")}</p>
        {project.contentPieceId ? (
          <Link href={`/equipo/contenido/pieza/${project.contentPieceId}`} className="mt-3 inline-flex h-11 items-center gap-1 text-[15px] font-semibold text-blue-700">
            {t("Abrir la pieza de Contenido", "Open the Content piece")}
            <Icon name="chevron" size={16} />
          </Link>
        ) : null}
      </div>
    );
  }

  if (project.status !== "approved" || !approvalHolds(project)) {
    return (
      <div className="card px-4 py-5 text-[15px] text-slate-700" data-testid="handoff-wait">
        {t("Un video pasa a Contenido cuando está aprobado tal como se exportó. Termina la revisión primero.", "A video goes to Content once it is approved as exported. Finish the check first.")}
      </div>
    );
  }

  const handOff = async () => {
    if (!exportRecord) return setMessage({ text: t("No se encuentra la exportación aprobada.", "The approved export can't be found."), tone: "error" });
    setBusy(true);
    setMessage(null);
    const fail = (text: string) => {
      setBusy(false);
      setStep(null);
      setMessage({ text, tone: "error" });
    };
    const lang = project.language;
    let pieceId = project.contentPieceId ?? (mode === "attach" ? attachTo : null);

    // 1. The piece: a new one with the video's words, or the one chosen.
    if (!pieceId) {
      setStep(t("Creando la pieza…", "Creating the piece…"));
      const copy = emptyCopy();
      copy.hook[lang] = project.brief.hook;
      // Alti's label is burned into the video under him; the piece says it too.
      const label = project.edit.alti.enabled ? aiByline(lang) : "";
      const words = [...project.edit.overlays.map((o) => [o.text, o.sub].filter(Boolean).join(" — ")), project.edit.outro.enabled ? project.edit.outro.line : ""].filter(Boolean).join("\n");
      copy.onScreen[lang] = [label, words].filter(Boolean).join("\n").slice(0, 400);
      copy.script[lang] = project.plan.script;
      copy.caption[lang] = project.plan.postCaption;
      copy.cta[lang] = project.plan.cta;
      const created = await content.act({
        action: "create",
        title: project.title,
        type: project.edit.aspect === "16:9" ? "youtube" : "short_video",
        channels: FORMAT_CHANNELS[project.brief.format],
        language: lang,
        audience: lang === "es" ? "hispanic" : "consumers",
        theme,
        goal: project.brief.goal,
        copy,
        characters: project.edit.alti.enabled ? ["alti"] : [],
      });
      if (!created.ok || !created.piece) return fail(created.ok ? t("No se pudo crear la pieza.", "The piece could not be created.") : created.message[locale]);
      pieceId = created.piece.id;
    } else if (mode === "attach" && !attachTo && !project.contentPieceId) {
      return fail(t("Elige la pieza.", "Pick the piece."));
    }
    // Remember the piece on the video at once, so a hand-off that stops here picks up where it was.
    if (project.contentPieceId !== pieceId) {
      const linked = await studio.act({ action: "link_piece", id: project.id, pieceId });
      if (!linked.ok) return fail(linked.message[locale]);
    }

    // 2. The approved MP4 as the piece's file (once).
    await content.reload();
    const current = (await currentPiece(content, pieceId)) ?? null;
    if (!current) return fail(t("La pieza de Contenido ya no existe.", "The Content piece no longer exists."));
    if (!current.assets.some((a) => a.name.includes(exportRecord.id))) {
      setStep(t("Pasando el MP4 a la pieza…", "Handing the MP4 to the piece…"));
      const blob = await studio.getFile(exportRecord.ref);
      if (!blob) return fail(t("El MP4 aprobado no está disponible. Exporta otra vez desde el editor.", "The approved MP4 isn't available. Export it again from the editor."));
      const name = `${project.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "video"}-${exportRecord.id}.mp4`;
      const uploaded = await content.uploadFile(pieceId, new File([blob], name, { type: "video/mp4" }), "");
      if (!uploaded.ok) return fail(uploaded.message[locale]);
    }

    // 3. What the Video Studio already made sure of, ticked on the piece's checklist; then the piece goes to its review.
    const after = await currentPiece(content, pieceId);
    if (after && OPEN.includes(after.status)) {
      setStep(t("Mandando la pieza a revisión…", "Sending the piece for review…"));
      const checklist: Partial<Record<ChecklistKey, boolean>> = { colours: true, fonts: true };
      if (project.edit.logo.enabled || project.edit.intro.enabled || project.edit.outro.enabled) checklist.logo = true;
      if (project.edit.alti.enabled) checklist.altiLabel = true;
      if (project.checklist.captionsMatch) checklist.captions = true;
      await content.act({ action: "update", id: pieceId, patch: { checklist } });
      const submitted = await content.act({ action: "submit", id: pieceId });
      if (!submitted.ok) return fail(submitted.message[locale]);
    }

    // 4. The video: handed to Content.
    setStep(t("Terminando…", "Finishing…"));
    const published = await studio.act({ action: "publish", id: project.id, pieceId });
    setBusy(false);
    setStep(null);
    if (!published.ok) return setMessage({ text: published.message[locale], tone: "error" });
    setMessage({ text: t("Listo: el video está en Contenido, en revisión.", "Done: the video is in Content, in review."), tone: "info" });
  };

  return (
    <section aria-labelledby="handoff-h" className="max-w-2xl">
      <SectionTitle>
        <span id="handoff-h">{t("Pasar a Contenido", "Hand to Content")}</span>
      </SectionTitle>
      <div className="card space-y-4 px-4 py-4 md:px-5" data-testid="handoff">
        <p className="text-[14px] leading-relaxed text-slate-700">
          {t(
            "La pieza de Contenido lleva el MP4 aprobado y las palabras del video. Allí pasa por su revisión y se publica (por una persona o por la app, cuando las cuentas estén conectadas). Aquí no se publica nada.",
            "The Content piece carries the approved MP4 and the video's words. There it goes through its review and is posted (by a person, or by the app once the accounts are connected). Nothing is posted from here.",
          )}
        </p>
        {project.contentPieceId ? (
          <p className="rounded-[10px] bg-amber-50 px-3 py-2 text-[13.5px] text-blue-900">{t("Un paso anterior quedó a medias: se termina con la misma pieza.", "An earlier hand-off stopped halfway: it finishes with the same piece.")}</p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("Pieza", "Piece")}>
              {(["new", "attach"] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={`pressable inline-flex h-11 items-center rounded-full border px-4 text-[14px] font-semibold ${mode === m ? "border-blue-900 bg-blue-900 text-white" : "border-slate-300 bg-white text-slate-700"}`}>
                  {m === "new" ? t("Crear una pieza nueva", "Create a new piece") : t("Agregar a una pieza existente", "Add to an existing piece")}
                </button>
              ))}
            </div>
            {mode === "new" ? (
              <label className="block max-w-sm">
                <span className={LABEL}>{t("Tema (para los resultados)", "Theme (for the results)")}</span>
                <select className={`${FIELD} mt-1 h-11`} value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
                  {THEMES.map((th) => (
                    <option key={th} value={th}>
                      {THEME_LABEL[locale][th]}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="block">
                <span className={LABEL}>{t("La pieza", "The piece")}</span>
                <select className={`${FIELD} mt-1 h-11`} value={attachTo} onChange={(e) => setAttachTo(e.target.value)}>
                  <option value="">{t("Elige una pieza…", "Pick a piece…")}</option>
                  {candidates.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title} · {STATUS_LABEL[locale][p.status]}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
        {mayHandOff ? (
          <button type="button" disabled={busy || (mode === "attach" && !attachTo && !project.contentPieceId)} onClick={handOff} className={`${PRIMARY_BUTTON} w-full sm:w-auto`} data-testid="handoff-go">
            {busy ? step ?? t("Trabajando…", "Working…") : t("Pasar a Contenido", "Hand to Content")}
          </button>
        ) : (
          <DeniedNote>{deniedReason("content.edit", locale)}</DeniedNote>
        )}
        {piece ? (
          <Link href={`/equipo/contenido/pieza/${piece.id}`} className="inline-flex h-11 items-center gap-1 text-[14px] font-semibold text-blue-700">
            {t("Abrir la pieza", "Open the piece")}
            <Icon name="chevron" size={16} />
          </Link>
        ) : null}
        <Notice message={message?.text ?? null} tone={message?.tone} />
      </div>
    </section>
  );
}

/** The piece as the content hub has it now (after a reload). */
async function currentPiece(content: ReturnType<typeof useContent>, id: string): Promise<ContentPiece | null> {
  // useContent's state updates on the next render: read the board directly for the freshest copy.
  try {
    if (!content.live) return readDemoContentBoard().pieces.find((p) => p.id === id) ?? null;
    const res = await fetch(`/api/staff/content?id=${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { piece?: ContentPiece };
    return body.piece ?? null;
  } catch {
    return null;
  }
}
