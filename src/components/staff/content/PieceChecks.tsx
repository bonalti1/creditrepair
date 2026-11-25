"use client";

import { useState } from "react";
import { approvalBlockers, blockingIssues, checklistFor, type ChecklistItem, type ContentIssue } from "@/lib/content/check";
import { GROUP_LABEL } from "@/lib/content/labels";
import type { ActResult } from "@/lib/content/store";
import type { ChecklistKey, ContentPiece } from "@/lib/content/types";
import { can, deniedReason } from "@/lib/staff/permissions";
import type { StaffRole } from "@/lib/staff/types";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import Icon from "@/components/Icon";
import { DeniedNote, PRIMARY_BUTTON_COMPACT, SECONDARY_BUTTON_COMPACT, SectionTitle } from "@/components/staff/ui";
import { FIELD, Notice } from "./ui";

// The compliance and brand check on a piece, the approval checklist, and the
// approval itself. The check (src/lib/content/check.ts) runs on what is on
// screen as it is typed; the server runs it again before saving an approval.

const FIELD_NAME: Record<ContentIssue["field"], [string, string]> = {
  hook: ["Gancho", "Hook"],
  onScreen: ["Texto en pantalla", "On-screen text"],
  script: ["Guion", "Script"],
  caption: ["Texto de la publicación", "Caption"],
  cta: ["Llamada a la acción", "Call to action"],
  piece: ["Toda la pieza", "Whole piece"],
  assets: ["Archivos", "Files"],
  links: ["Enlaces", "Links"],
};

/** One issue: what, where, why, and what to do instead. */
export function IssueLine({ issue, showWhere = true }: { issue: ContentIssue; showWhere?: boolean }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const block = issue.severity === "block";
  return (
    <li className={`rounded-2xl px-3.5 py-2.5 ${block ? "bg-red-50" : "bg-amber-50"}`} data-testid={`issue-${issue.rule}`} data-severity={issue.severity}>
      <p className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] font-semibold uppercase tracking-wide ${block ? "text-red-700" : "text-amber-700"}`}>
        <span>{block ? t("Bloquea la aprobación", "Blocks approval") : t("Conviene revisar", "Worth fixing")}</span>
        {showWhere ? (
          <span className="font-medium normal-case tracking-normal text-slate-600">
            · {t(...FIELD_NAME[issue.field])}
            {issue.lang ? ` · ${issue.lang.toUpperCase()}` : ""}
          </span>
        ) : null}
      </p>
      {issue.match ? <p className="mt-1 text-[13.5px] text-slate-900">“{issue.match}”</p> : null}
      <p className="mt-0.5 text-[13.5px] leading-snug text-slate-700">{issue.explain[locale]}</p>
      <p className="mt-0.5 text-[13px] leading-snug text-slate-600">
        <span className="font-semibold">{t("Qué hacer: ", "What to do: ")}</span>
        {issue.fix[locale]}
      </p>
    </li>
  );
}

export function CheckSummary({ issues }: { issues: ContentIssue[] }) {
  const t = useTx();
  const blocking = blockingIssues(issues);
  const warnings = issues.length - blocking.length;
  const pieceLevel = issues.filter((i) => ["piece", "assets", "links"].includes(i.field));
  return (
    <section aria-labelledby="check-title" data-testid="check-summary">
      <SectionTitle>
        <span id="check-title">{t("Revisión de cumplimiento y marca", "Compliance and brand check")}</span>
      </SectionTitle>
      <div className="card px-4 py-4">
        {issues.length === 0 ? (
          <p className="flex items-center gap-2 text-[14.5px] font-medium text-blue-900">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-700 text-white">
              <Icon name="check" size={15} />
            </span>
            {t("Sin problemas: pasa todas las reglas en cada idioma.", "No issues: it passes every rule in each language.")}
          </p>
        ) : (
          <p className="text-[14.5px] text-slate-800" aria-live="polite">
            {blocking.length > 0 ? <span className="font-semibold text-red-700">{t(`${blocking.length} bloquean la aprobación`, `${blocking.length} block approval`)}</span> : null}
            {blocking.length > 0 && warnings > 0 ? " · " : null}
            {warnings > 0 ? <span className="font-semibold text-amber-700">{t(`${warnings} conviene revisar`, `${warnings} worth fixing`)}</span> : null}
          </p>
        )}
        {issues.length > 0 ? <p className="mt-1 text-[13px] text-slate-500">{t("Cada problema aparece también junto al texto donde está.", "Each issue also shows beside the words it is in.")}</p> : null}
        {pieceLevel.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {pieceLevel.map((issue) => (
              <IssueLine key={issue.id} issue={issue} />
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

function ItemRow({ item, disabled, onToggle }: { item: ChecklistItem; disabled: boolean; onToggle: (key: ChecklistKey, value: boolean) => void }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const id = `check-${item.key}`;
  return (
    <li className="flex gap-3 py-2.5" data-testid={id}>
      {item.mode === "auto" ? (
        <span
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${item.done ? "bg-blue-700 text-white" : "bg-red-50 text-red-700 ring-1 ring-red-200"}`}
          aria-hidden="true"
        >
          {item.done ? <Icon name="check" size={14} /> : <Icon name="close" size={13} />}
        </span>
      ) : (
        <input id={id + "-box"} type="checkbox" checked={item.done} disabled={disabled} onChange={(e) => onToggle(item.key, e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-blue-700" />
      )}
      <div className="min-w-0">
        <label htmlFor={item.mode === "person" ? id + "-box" : undefined} className="block text-[14px] font-medium leading-snug text-slate-900">
          {item.label[locale]}
          {item.mode === "auto" ? (
            <span className={`ml-1.5 text-[12px] font-semibold ${item.done ? "text-blue-700" : "text-red-700"}`}>
              {item.done ? t("· lo revisó la app", "· checked by the app") : t("· falta", "· missing")}
            </span>
          ) : null}
        </label>
        <p className="text-[12.5px] leading-snug text-slate-500">{item.help[locale]}</p>
      </div>
    </li>
  );
}

/** The checklist before approval, by group; only what applies to this piece. */
export function Checklist({ piece, issues, role, onToggle }: { piece: ContentPiece; issues: ContentIssue[]; role: StaffRole | null; onToggle: (key: ChecklistKey, value: boolean) => void }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const items = checklistFor(piece, issues).filter((i) => i.applies);
  const editable = can(role, "content.edit") && !["posted", "measured", "archived"].includes(piece.status);
  const groups = (["brand", "legal", "access"] as const).map((g) => ({ group: g, items: items.filter((i) => i.group === g) })).filter((g) => g.items.length > 0);
  const done = items.filter((i) => i.done).length;
  return (
    <section aria-labelledby="checklist-title" data-testid="checklist">
      <SectionTitle aside={<span className="text-[13px] tabular-nums text-slate-500">{t(`${done} de ${items.length}`, `${done} of ${items.length}`)}</span>}>
        <span id="checklist-title">{t("Lista antes de aprobar", "Checklist before approval")}</span>
      </SectionTitle>
      <div className="card px-4 py-2">
        {groups.map(({ group, items: list }) => (
          <div key={group} className="border-b hairline py-1 last:border-b-0">
            <h3 className="pt-2 text-[12px] font-semibold uppercase tracking-wide text-slate-500">{GROUP_LABEL[locale][group]}</h3>
            <ul className="divide-y divide-slate-100">
              {list.map((item) => (
                <ItemRow key={item.key} item={item} disabled={!editable} onToggle={onToggle} />
              ))}
            </ul>
          </div>
        ))}
        {!can(role, "content.edit") ? (
          <div className="py-2">
            <DeniedNote>{deniedReason("content.edit", locale)}</DeniedNote>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** Approve, or send it back with a note. Only for content.approve; the reasons it can't be approved yet are listed. */
export function ApprovalPanel({ piece, issues, role, dirty, act }: { piece: ContentPiece; issues: ContentIssue[]; role: StaffRole | null; dirty: boolean; act: (a: { action: "approve"; id: string } | { action: "request_changes"; id: string; note: string }) => Promise<ActResult> }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const blockers = approvalBlockers(piece, issues);
  const mayApprove = can(role, "content.approve");
  const inReview = piece.status === "review";
  if (!["review", "approved", "scheduled", "failed"].includes(piece.status)) return null;

  const run = async (action: Parameters<typeof act>[0]) => {
    const result = await act(action);
    setMessage(result.ok ? { text: action.action === "approve" ? t("Aprobada.", "Approved.") : t("Devuelta con tu nota.", "Sent back with your note."), tone: "info" } : { text: result.message[locale], tone: "error" });
    if (result.ok) {
      setAsking(false);
      setNote("");
    }
  };

  return (
    <section aria-labelledby="approval-title" data-testid="approval">
      <SectionTitle>
        <span id="approval-title">{t("Aprobación", "Approval")}</span>
      </SectionTitle>
      <div className="card space-y-3 px-4 py-4">
        {piece.approval ? (
          <p className="text-[14px] text-slate-700">
            {t(`Aprobada por ${piece.approval.by}.`, `Approved by ${piece.approval.by}.`)}{" "}
            <span className="text-slate-500">{t("La aprobación es de este texto y estos archivos: cualquier cambio la devuelve a revisión.", "The approval is for these exact words and files: any change sends it back to review.")}</span>
          </p>
        ) : null}
        {inReview ? (
          blockers.length > 0 ? (
            <ul className="space-y-1" data-testid="approval-blockers">
              {blockers.map((b) => (
                <li key={b.code} className="flex items-start gap-2 text-[14px] text-red-700">
                  <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-red-600" />
                  {b.text[locale]}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[14px] text-blue-900">{t("Lista para aprobar: sin problemas que bloqueen y la lista completa.", "Ready to approve: nothing blocking and the checklist complete.")}</p>
          )
        ) : null}
        {dirty ? <p className="text-[13px] text-amber-700">{t("Hay cambios sin guardar. Guárdalos antes de aprobar.", "There are unsaved changes. Save them before approving.")}</p> : null}
        {mayApprove ? (
          <div className="flex flex-wrap gap-2">
            {inReview ? (
              <button type="button" disabled={blockers.length > 0 || dirty} onClick={() => void run({ action: "approve", id: piece.id })} className={`${PRIMARY_BUTTON_COMPACT} px-5`} data-testid="approve">
                {t("Aprobar", "Approve")}
              </button>
            ) : null}
            <button type="button" onClick={() => setAsking((v) => !v)} className={SECONDARY_BUTTON_COMPACT} aria-expanded={asking}>
              {t("Pedir cambios", "Request changes")}
            </button>
          </div>
        ) : (
          <DeniedNote>{deniedReason("content.approve", locale)}</DeniedNote>
        )}
        {asking ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run({ action: "request_changes", id: piece.id, note });
            }}
            className="space-y-2"
          >
            <label className="block text-[13px] font-medium text-slate-700">
              {t("Qué cambiar (lo verá quien la hizo)", "What to change (the maker will see it)")}
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={600} className={`${FIELD} mt-1 resize-y py-2`} />
            </label>
            <button type="submit" disabled={note.trim().length < 3} className={`${SECONDARY_BUTTON_COMPACT} px-5`}>
              {t("Devolver con la nota", "Send back with the note")}
            </button>
          </form>
        ) : null}
        {message ? <Notice message={message.text} tone={message.tone} /> : null}
      </div>
    </section>
  );
}
