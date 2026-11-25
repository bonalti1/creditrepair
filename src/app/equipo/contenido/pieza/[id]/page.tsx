"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { checkPiece, blockingIssues } from "@/lib/content/check";
import { approvalHolds } from "@/lib/content/hash";
import { AUDIENCE_LABEL, CHANNEL_LABEL, LANGUAGE_LABEL, THEME_LABEL, TYPE_LABEL } from "@/lib/content/labels";
import { attributeLeads } from "@/lib/content/results";
import { canMove } from "@/lib/content/rules";
import { useContent, type ActResult } from "@/lib/content/store";
import { AUDIENCES, CHANNELS, CONTENT_TYPES, LANGUAGES, THEMES, type ChecklistKey, type ContentPiece, type ContentStatus, type CopyField, type CopyLang, type PieceCopy } from "@/lib/content/types";
import { getTeamData } from "@/lib/staff/teamData";
import { can, deniedReason } from "@/lib/staff/permissions";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import Icon from "@/components/Icon";
import { DeniedNote, PRIMARY_BUTTON_COMPACT, QUIET_BUTTON, SECONDARY_BUTTON_COMPACT, SectionTitle } from "@/components/staff/ui";
import { AltiAssist } from "@/components/staff/content/AltiAssist";
import { ApprovalPanel, CheckSummary, Checklist } from "@/components/staff/content/PieceChecks";
import { PieceFiles } from "@/components/staff/content/PieceFiles";
import { PiecePosting } from "@/components/staff/content/PiecePosting";
import { PieceHistory, PieceResults } from "@/components/staff/content/PieceResults";
import { PieceWords } from "@/components/staff/content/PieceWords";
import { ContentGate, DemoNote, FIELD, LABEL, Notice, StatusChip, Tag } from "@/components/staff/content/ui";

// One piece: its details and words (checked as they are typed), its files,
// the checklist and the approval, Alti's assistant, posting and scheduling,
// results and history. On a wide screen the words are on the left and the
// checks on the right; on a phone everything is one column.

type Draft = Pick<ContentPiece, "title" | "type" | "channels" | "language" | "audience" | "theme" | "goal" | "characters" | "links" | "owner" | "dueDate" | "copy">;

const draftOf = (p: ContentPiece): Draft => ({
  title: p.title,
  type: p.type,
  channels: p.channels,
  language: p.language,
  audience: p.audience,
  theme: p.theme,
  goal: p.goal,
  characters: p.characters,
  links: p.links,
  owner: p.owner,
  dueDate: p.dueDate,
  copy: p.copy,
});

export default function PiecePage() {
  const t = useTx();
  return (
    <ContentGate needs="content.view" title={t("Pieza", "Piece")}>
      <Suspense fallback={<div className="h-40" aria-busy="true" />}>
        <Piece />
      </Suspense>
    </ContentGate>
  );
}

function Piece() {
  const t = useTx();
  const { locale } = useStaffLocale();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const content = useContent(params.id);
  const piece = content.pieces.find((p) => p.id === params.id) ?? null;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const [members, setMembers] = useState<Array<{ handle: string; name: string }>>([]);
  const [linksText, setLinksText] = useState("");

  const dirty = Boolean(piece && draft && JSON.stringify(draftOf(piece)) !== JSON.stringify(draft));
  useEffect(() => {
    if (piece && (!draft || !dirty)) {
      setDraft(draftOf(piece));
      setLinksText(piece.links.join("\n"));
    }
    // Only when the stored piece changes: an edit in progress is kept.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piece?.updatedAt, piece?.id]);
  useEffect(() => {
    void getTeamData()
      .load()
      .then((team) => setMembers(team.members.filter((m) => m.active && !m.pending).map((m) => ({ handle: m.handle, name: m.name }))));
  }, []);

  const merged = useMemo(() => (piece && draft ? { ...piece, ...draft } : piece), [piece, draft]);
  const issues = useMemo(() => (merged ? checkPiece(merged) : []), [merged]);
  const attribution = useMemo(() => (piece ? (attributeLeads([piece], content.leads).get(piece.campaignCode.toLowerCase()) ?? null) : null), [piece, content.leads]);

  if (!content.ready) return <div className="h-40" aria-busy="true" />;
  if (!piece || !draft || !merged) {
    return (
      <main className="animate-rise">
        <h1 className="text-[28px] font-semibold tracking-tight text-slate-900">{t("No se encontró la pieza", "Piece not found")}</h1>
        <Link href="/equipo/contenido" className="mt-4 inline-flex h-11 items-center text-[15px] font-medium text-blue-700">
          {t("Volver al tablero", "Back to the board")}
        </Link>
      </main>
    );
  }

  const editable = can(content.role, "content.edit") && !["posted", "measured", "archived"].includes(piece.status);
  const say = (r: ActResult, ok: string) => setMessage(r.ok ? { text: ok, tone: "info" } : { text: r.message[locale], tone: "error" });
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...(d ?? draftOf(piece)), ...patch }));
  const setWord = (field: CopyField, lang: CopyLang, value: string) => setDraft((d) => {
    const base = d ?? draftOf(piece);
    return { ...base, copy: { ...base.copy, [field]: { ...base.copy[field], [lang]: value } } };
  });

  const save = async () => {
    setSaving(true);
    const before = draftOf(piece);
    const patch: Record<string, unknown> = {};
    for (const key of Object.keys(draft) as Array<keyof Draft>) if (JSON.stringify(draft[key]) !== JSON.stringify(before[key])) patch[key] = draft[key];
    const r = await content.act({ action: "update", id: piece.id, patch });
    setSaving(false);
    const wasApproved = Boolean(piece.approval);
    say(r, r.ok && wasApproved && r.piece && !r.piece.approval ? t("Guardado. Cambió lo aprobado, así que volvió a revisión.", "Saved. Approved content changed, so it went back to review.") : t("Guardado.", "Saved."));
  };

  const move = async (to: ContentStatus, ok: string) => say(await content.act({ action: "move", id: piece.id, to }), ok);
  const submit = async () => say(await content.act({ action: "submit", id: piece.id }), t("Enviada a revisión.", "Sent for review."));
  const toggleCheck = async (key: ChecklistKey, value: boolean) => say(await content.act({ action: "update", id: piece.id, patch: { checklist: { [key]: value } } }), t("Lista actualizada.", "Checklist updated."));
  const insertAltiWords = (copy: Partial<PieceCopy>) => {
    setDraft((d) => ({ ...(d ?? draftOf(piece)), copy: { ...(d ?? draftOf(piece)).copy, ...copy } }));
    setMessage({ text: t("Texto de Alti en el editor. Revísalo y guarda.", "Alti's words are in the editor. Review them and save."), tone: "info" });
  };
  const blocking = blockingIssues(issues).length;
  const canSubmit = ["idea", "planned", "in_production", "changes"].includes(piece.status);

  return (
    <main className="animate-rise">
      <Link href="/equipo/contenido" className="inline-flex h-11 items-center gap-1 text-[14px] font-medium text-blue-700">
        <Icon name="chevron" size={16} className="rotate-180" />
        {t("Tablero", "Board")}
      </Link>
      <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-slate-900 [text-wrap:balance]">{piece.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <StatusChip status={piece.status} />
            <Tag>{TYPE_LABEL[locale][piece.type]}</Tag>
            <Tag tone="bg-blue-50 text-blue-700">{LANGUAGE_LABEL[locale][piece.language]}</Tag>
            <Tag>{AUDIENCE_LABEL[locale][piece.audience]}</Tag>
            <Tag>{piece.campaignCode}</Tag>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {can(content.role, "content.edit") ? (
            <>
              {canMove(piece.status, "planned") && piece.status === "idea" ? (
                <button type="button" onClick={() => void move("planned", t("Planeada.", "Planned."))} className={SECONDARY_BUTTON_COMPACT}>
                  {t("Planear", "Plan it")}
                </button>
              ) : null}
              {canMove(piece.status, "in_production") && ["idea", "planned", "changes"].includes(piece.status) ? (
                <button type="button" onClick={() => void move("in_production", t("En producción.", "In production."))} className={SECONDARY_BUTTON_COMPACT}>
                  {t("A producción", "Start production")}
                </button>
              ) : null}
              {canSubmit ? (
                <button type="button" onClick={() => void submit()} disabled={dirty} className={`${PRIMARY_BUTTON_COMPACT} px-5`} data-testid="submit">
                  {t("Mandar a revisión", "Send for review")}
                </button>
              ) : null}
              {piece.status === "failed" && approvalHolds(piece) ? (
                <button type="button" onClick={() => void move("approved", t("Aprobada otra vez; prográmala de nuevo.", "Approved again; schedule it again."))} className={SECONDARY_BUTTON_COMPACT}>
                  {t("Volver a aprobada", "Back to approved")}
                </button>
              ) : null}
              <button
                type="button"
                onClick={async () => {
                  const r = await content.act({ action: "duplicate", id: piece.id });
                  if (r.ok && r.piece) router.push(`/equipo/contenido/pieza/${r.piece.id}`);
                  else say(r, "");
                }}
                className={QUIET_BUTTON}
              >
                {t("Duplicar", "Duplicate")}
              </button>
              {piece.status === "archived" ? (
                <button type="button" onClick={() => void move("idea", t("Restaurada como idea.", "Restored as an idea."))} className={QUIET_BUTTON}>
                  {t("Restaurar", "Restore")}
                </button>
              ) : (
                <button type="button" onClick={() => void move("archived", t("Archivada.", "Archived."))} className={QUIET_BUTTON}>
                  {t("Archivar", "Archive")}
                </button>
              )}
            </>
          ) : null}
        </div>
      </div>
      <DemoNote live={content.live} />
      {piece.changesNote && piece.status === "changes" ? (
        <div className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-[14px] leading-snug text-blue-900" role="status">
          <p className="font-semibold">{t("Cambios pedidos", "Changes requested")}</p>
          <p>“{piece.changesNote}”</p>
        </div>
      ) : null}
      {canSubmit && blocking > 0 ? (
        <p className="mt-3 text-[13.5px] text-red-700">{t(`Tiene ${blocking} problemas que bloquean: corrígelos antes de mandarla a revisión.`, `It has ${blocking} blocking issues: fix them before sending it for review.`)}</p>
      ) : null}
      {dirty ? <p className="mt-3 text-[13.5px] text-amber-700">{t("Cambios sin guardar.", "Unsaved changes.")}</p> : null}
      {message ? (
        <div className="mt-3">
          <Notice message={message.text} tone={message.tone} />
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <section aria-labelledby="details-title">
            <SectionTitle>
              <span id="details-title">{t("Detalles", "Details")}</span>
            </SectionTitle>
            <div className="card grid gap-3 px-4 py-4 sm:grid-cols-2">
              <label className={`${LABEL} sm:col-span-2`}>
                {t("Título", "Title")}
                <input value={draft.title} onChange={(e) => set({ title: e.target.value })} readOnly={!editable} maxLength={120} className={`${FIELD} mt-1 h-11`} />
              </label>
              <label className={LABEL}>
                {t("Tipo", "Type")}
                <select value={draft.type} onChange={(e) => set({ type: e.target.value as Draft["type"] })} disabled={!editable} className={`${FIELD} mt-1 h-11`}>
                  {CONTENT_TYPES.map((x) => (
                    <option key={x} value={x}>
                      {TYPE_LABEL[locale][x]}
                    </option>
                  ))}
                </select>
              </label>
              <label className={LABEL}>
                {t("Idioma", "Language")}
                <select value={draft.language} onChange={(e) => set({ language: e.target.value as Draft["language"] })} disabled={!editable} className={`${FIELD} mt-1 h-11`}>
                  {LANGUAGES.map((x) => (
                    <option key={x} value={x}>
                      {LANGUAGE_LABEL[locale][x]}
                    </option>
                  ))}
                </select>
              </label>
              <label className={LABEL}>
                {t("Público", "Audience")}
                <select value={draft.audience} onChange={(e) => set({ audience: e.target.value as Draft["audience"] })} disabled={!editable} className={`${FIELD} mt-1 h-11`}>
                  {AUDIENCES.map((x) => (
                    <option key={x} value={x}>
                      {AUDIENCE_LABEL[locale][x]}
                    </option>
                  ))}
                </select>
              </label>
              <label className={LABEL}>
                {t("Tema", "Theme")}
                <select value={draft.theme} onChange={(e) => set({ theme: e.target.value as Draft["theme"] })} disabled={!editable} className={`${FIELD} mt-1 h-11`}>
                  {THEMES.map((x) => (
                    <option key={x} value={x}>
                      {THEME_LABEL[locale][x]}
                    </option>
                  ))}
                </select>
              </label>
              <label className={LABEL}>
                {t("Responsable", "Owner")}
                <select value={draft.owner ?? ""} onChange={(e) => set({ owner: e.target.value || null })} disabled={!can(content.role, "content.edit")} className={`${FIELD} mt-1 h-11`}>
                  <option value="">{t("Sin responsable", "No owner")}</option>
                  {[...new Set([...members.map((m) => m.handle), ...(draft.owner ? [draft.owner] : [])])].map((h) => (
                    <option key={h} value={h}>
                      {members.find((m) => m.handle === h)?.name ?? h}
                    </option>
                  ))}
                </select>
              </label>
              <label className={LABEL}>
                {t("Fecha de entrega", "Due date")}
                <input type="date" value={draft.dueDate ?? ""} onChange={(e) => set({ dueDate: e.target.value || null })} disabled={!can(content.role, "content.edit")} className={`${FIELD} mt-1 h-11`} />
              </label>
              <label className={`${LABEL} sm:col-span-2`}>
                {t("Objetivo y público, en una línea", "Goal and audience, in a line")}
                <input value={draft.goal} onChange={(e) => set({ goal: e.target.value })} readOnly={!can(content.role, "content.edit")} maxLength={300} className={`${FIELD} mt-1 h-11`} />
              </label>
              <fieldset className="sm:col-span-2">
                <legend className={LABEL}>{t("Canales", "Channels")}</legend>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {CHANNELS.map((c) => (
                    <label key={c} className={`inline-flex h-10 cursor-pointer items-center gap-2 rounded-full px-3 text-[13.5px] ring-1 ${draft.channels.includes(c) ? "bg-blue-50 text-blue-900 ring-blue-300" : "text-slate-700 ring-slate-200"}`}>
                      <input type="checkbox" checked={draft.channels.includes(c)} disabled={!editable} onChange={() => set({ channels: draft.channels.includes(c) ? draft.channels.filter((x) => x !== c) : [...draft.channels, c] })} className="h-4 w-4 accent-blue-700" />
                      {CHANNEL_LABEL[locale][c]}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="sm:col-span-2">
                <legend className={LABEL}>{t("Personajes en los visuales", "Characters in the visuals")}</legend>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {(["alti", "altibot"] as const).map((c) => (
                    <label key={c} className={`inline-flex h-10 cursor-pointer items-center gap-2 rounded-full px-3 text-[13.5px] ring-1 ${draft.characters.includes(c) ? "bg-blue-50 text-blue-900 ring-blue-300" : "text-slate-700 ring-slate-200"}`}>
                      <input type="checkbox" checked={draft.characters.includes(c)} disabled={!editable} onChange={() => set({ characters: draft.characters.includes(c) ? draft.characters.filter((x) => x !== c) : [...draft.characters, c] })} className="h-4 w-4 accent-blue-700" />
                      {c === "alti" ? t("Alti (asistente con IA)", "Alti (AI assistant)") : t("El robot (solo cameo)", "The robot (cameo only)")}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className={`${LABEL} sm:col-span-2`}>
                {t("Enlaces (uno por línea, https)", "Links (one per line, https)")}
                <textarea
                  value={linksText}
                  onChange={(e) => {
                    setLinksText(e.target.value);
                    set({ links: e.target.value.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 10) });
                  }}
                  readOnly={!editable}
                  rows={2}
                  className={`${FIELD} mt-1 resize-y py-2`}
                  placeholder="https://credalti.example/empezar"
                />
              </label>
            </div>
          </section>

          <section aria-labelledby="words-title">
            <SectionTitle
              aside={
                piece.aiDraft ? <span className="text-[12.5px] font-medium text-amber-700">{t("Borrador de Alti (IA): edítalo", "Alti's draft (AI): edit it")}</span> : null
              }
            >
              <span id="words-title">{t("Texto", "Words")}</span>
            </SectionTitle>
            <div className="card px-4 py-4">
              <PieceWords piece={merged} issues={issues} editable={editable} onChange={setWord} />
              {editable ? (
                <div className={`${dirty ? "sticky bottom-20 z-10 shadow-[0_-8px_16px_-12px_rgba(18,33,58,0.25)] md:bottom-3" : ""} mt-5 flex flex-wrap items-center gap-2 rounded-2xl bg-white/95 py-2 backdrop-blur`}>
                  <button type="button" onClick={() => void save()} disabled={!dirty || saving} className={`${PRIMARY_BUTTON_COMPACT} px-6`} data-testid="save">
                    {saving ? t("Guardando…", "Saving…") : t("Guardar", "Save")}
                  </button>
                  {dirty ? (
                    <button type="button" onClick={() => { setDraft(draftOf(piece)); setLinksText(piece.links.join("\n")); }} className={QUIET_BUTTON}>
                      {t("Descartar cambios", "Discard changes")}
                    </button>
                  ) : null}
                  {piece.approval ? <span className="text-[12.5px] text-slate-500">{t("Guardar un cambio la devuelve a revisión.", "Saving a change sends it back to review.")}</span> : null}
                </div>
              ) : !can(content.role, "content.edit") ? (
                <div className="mt-4">
                  <DeniedNote>{deniedReason("content.edit", locale)}</DeniedNote>
                </div>
              ) : (
                <p className="mt-4 text-[13px] text-slate-500">{t("Ya se publicó: el texto no cambia. Duplícala para hacer otra versión.", "It's already posted: the words no longer change. Duplicate it to make another version.")}</p>
              )}
            </div>
          </section>

          <PieceFiles
            piece={piece}
            fileUrls={content.fileUrls}
            editable={editable}
            upload={(file, alt) => content.uploadFile(piece.id, file, alt)}
            addLink={(url, name, alt) => content.addLink(piece.id, url, name, alt)}
            act={content.act}
          />
        </div>

        <div className="min-w-0 space-y-6">
          <CheckSummary issues={issues} />
          <Checklist piece={merged} issues={issues} role={content.role} onToggle={(k, v) => void toggleCheck(k, v)} />
          <ApprovalPanel piece={piece} issues={checkPiece(piece)} role={content.role} dirty={dirty} act={content.act} />
          {editable ? <AltiAssist piece={merged} open={search.get("alti") === "1"} onUse={insertAltiWords} assist={content.assist} /> : null}
          <PiecePosting
            piece={piece}
            schedules={content.schedules}
            settings={content.settings}
            connections={content.connections}
            role={content.role}
            act={content.act}
            schedule={content.schedule}
            cancelSchedule={content.cancelSchedule}
          />
          <PieceResults piece={piece} results={content.results} attribution={attribution} role={content.role} addResult={content.addResult} />
          <PieceHistory events={content.events.filter((e) => e.pieceId === piece.id)} />
        </div>
      </div>
    </main>
  );
}
