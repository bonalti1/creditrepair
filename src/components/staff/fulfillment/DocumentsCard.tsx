"use client";

import { useState } from "react";
import {
  clientReviewLine,
  currentReview,
  DOCUMENT_KIND_LABEL,
  NOT_COLLECTED,
  powerOfAttorneyEnabled,
  REJECT_REASON_LABEL,
  REJECT_REASONS,
  type RejectReason,
  type ReviewableKind,
} from "@/lib/fulfillment/documents";
import { openDocumentUrl, reviewDocument } from "@/lib/fulfillment/staffActions";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { formatBytes, shortDay } from "@/lib/staff/format";
import type { DocumentKind, StaffClient } from "@/lib/staff/types";
import { Chip, ClientLanguageTag, ROW_BUTTON, WAITING_TONE } from "@/components/staff/ui";

// The client's documents and a person's review of each (fulfillment/documents.ts):
// what is on file, Open (a two-minute link), Accept, or Not accepted with a
// reason the client reads in their language and a request to upload it again.
// A required document not accepted counts as missing: no round goes with it.
// What Credalti never collects is said here too.

const field = "h-11 w-full rounded-xl bg-white px-3 text-[15px] text-slate-900 shadow-[0_0_0_1px_rgba(0,0,0,0.12)] outline-none focus:ring-2 focus:ring-blue-300";

interface Item {
  key: string;
  kind: ReviewableKind;
  fileId: string | null;
  onFile: boolean;
  uploadedAt: string | null;
  detail: string | null;
  waiting: boolean;
}

function ReviewForm({ onSave, busy, client }: { onSave: (reason: RejectReason, note: string, askAgain: boolean) => void; busy: boolean; client: StaffClient }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const [reason, setReason] = useState<RejectReason>("blurry");
  const [note, setNote] = useState("");
  const [askAgain, setAskAgain] = useState(true);
  return (
    <div className="mt-2 space-y-2 rounded-xl bg-slate-50 p-3" data-testid="reject-form">
      <label className="block text-[13px] font-medium text-slate-700">
        {t("Por qué (el cliente lo lee en su idioma)", "Why (the client reads it in their language)")}
        <select className={`${field} mt-1`} value={reason} onChange={(e) => setReason(e.target.value as RejectReason)}>
          {REJECT_REASONS.map((r) => (
            <option key={r} value={r}>
              {REJECT_REASON_LABEL[locale][r]}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-[13px] font-medium text-slate-700">
        {t("Unas palabras más para el cliente (opcional, en su idioma)", "A few more words for the client (optional, in their language)")}
        <span className="mt-0.5 block">
          <ClientLanguageTag client={client} />
        </span>
        <input className={`${field} mt-1`} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
      </label>
      <label className="flex min-h-11 items-center gap-2 text-[14px] text-slate-700">
        <input type="checkbox" checked={askAgain} onChange={(e) => setAskAgain(e.target.checked)} className="h-5 w-5" />
        {t("Pedirle que suba otro", "Ask them to upload another")}
      </label>
      <p className="text-xs leading-relaxed text-slate-500">
        {t("Sin promesas ni números de su identificación. El cliente verá:", "No promises and no numbers from their ID. The client will read:")}{" "}
        <span className="text-slate-700">
          «{clientReviewLine({ id: "", kind: "government_id", fileId: null, documentUploadedAt: "", decision: "rejected", reasonCode: reason, note, askAgain, by: "", at: "" }, client.locale === "es" ? "es" : "en")}»
        </span>
      </p>
      <button type="button" disabled={busy || (reason === "other" && note.trim().length < 5)} onClick={() => onSave(reason, note.trim(), askAgain)} className={ROW_BUTTON} data-testid="reject-save">
        {t("Guardar: no aceptado", "Save: not accepted")}
      </button>
    </div>
  );
}

export default function DocumentsCard({
  client,
  documents,
  missing,
  demo,
  canReview,
  viewerName,
  onChanged,
}: {
  client: StaffClient;
  /** The kinds to list (required first), as the page decides. */
  documents: DocumentKind[];
  missing: DocumentKind[];
  demo: boolean;
  canReview: boolean;
  viewerName: string;
  onChanged: () => void | Promise<void>;
}) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const items: Item[] = [
    ...documents
      .filter((k): k is Exclude<DocumentKind, "ssn_card"> => k !== "ssn_card")
      .map((kind) => ({
        key: kind,
        kind,
        fileId: null,
        onFile: client.documents.includes(kind),
        uploadedAt: client.documentUploadedAt?.[kind] ?? null,
        detail: null,
        waiting: Boolean(client.agreementSignedAt && missing.includes(kind)) || kind === "identity_theft_report",
      })),
    ...(client.files ?? [])
      .filter((f) => !f.withdrawnAt)
      .map((f) => ({
        key: f.id,
        kind: f.kind,
        fileId: f.id,
        onFile: true,
        uploadedAt: f.uploadedAt,
        detail: [f.description, f.fileName, formatBytes(f.bytes)].filter(Boolean).join(" · "),
        waiting: false,
      })),
  ];

  const review = async (item: Item, decision: "accepted" | "rejected", reasonCode: RejectReason | null = null, note = "", askAgain = false) => {
    setBusy(item.key);
    setMessage(null);
    const result = await reviewDocument(
      demo,
      client.id,
      { kind: item.kind, fileId: item.fileId, decision, reasonCode, note, askAgain, documentUploadedAt: item.uploadedAt ?? new Date().toISOString() },
      viewerName,
    );
    setBusy(null);
    if (!result.ok) return setMessage(result.message);
    setRejecting(null);
    await onChanged();
  };

  const open = async (item: Item) => {
    if (demo) return setMessage(t("Demo: los documentos son inventados y no hay archivo que abrir.", "Demo: the documents are made up and there is no file to open."));
    const url = await openDocumentUrl(client.id, item.kind, item.fileId);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    else setMessage(t("No se pudo abrir el archivo.", "Couldn't open the file."));
  };

  return (
    <div data-testid="documents-card">
      <ul className="card overflow-hidden">
        {items.map((item, index) => {
          const r = item.onFile ? currentReview(client, item.kind, item.fileId) : null;
          const chip = !item.onFile ? (
            <Chip tone={item.waiting ? WAITING_TONE : "bg-slate-100 text-slate-600"}>{t("Falta", "Missing")}</Chip>
          ) : r?.decision === "rejected" ? (
            <Chip tone="bg-red-50 text-red-700">{t("No aceptado", "Not accepted")}</Chip>
          ) : r?.decision === "accepted" ? (
            <Chip tone="bg-green-50 text-green-700">{t("Aceptado", "Accepted")}</Chip>
          ) : (
            <Chip tone="bg-green-50 text-green-700">{t("En archivo", "On file")}</Chip>
          );
          return (
            <li key={item.key} className={`px-5 py-3 ${index > 0 ? "border-t hairline" : ""}`} data-testid={`doc-row-${item.kind}`}>
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 text-[14px] text-slate-900">{DOCUMENT_KIND_LABEL[locale][item.kind]}</span>
                {chip}
              </div>
              {item.detail && <p className="mt-0.5 break-words text-[12.5px] leading-snug text-slate-500">{item.detail}</p>}
              {item.onFile && item.uploadedAt && (
                <p className="mt-0.5 text-[12.5px] text-slate-500">
                  {t(`Subido el ${shortDay(item.uploadedAt, "es")}`, `Uploaded ${shortDay(item.uploadedAt, "en")}`)}
                  {r ? ` · ${r.decision === "accepted" ? t("aceptado por", "accepted by") : t("no aceptado por", "not accepted by")} ${r.by}` : ""}
                </p>
              )}
              {r?.decision === "rejected" && (
                <p className="mt-1 rounded-lg bg-red-50 px-2.5 py-1.5 text-[12.5px] leading-snug text-red-800">
                  {t("El cliente lee:", "The client reads:")} «{clientReviewLine(r, client.locale === "es" ? "es" : "en")}»
                </p>
              )}
              {item.onFile && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => void open(item)} className="pressable inline-flex h-11 items-center rounded-[10px] px-2 text-[14px] font-medium text-blue-700 md:h-9">
                    {t("Abrir", "Open")}
                  </button>
                  {canReview && r?.decision !== "accepted" && (
                    <button type="button" disabled={busy === item.key} onClick={() => void review(item, "accepted")} className={ROW_BUTTON} data-testid={`accept-${item.kind}`}>
                      {t("Aceptar", "Accept")}
                    </button>
                  )}
                  {canReview && r?.decision !== "rejected" && (
                    <button type="button" onClick={() => setRejecting(rejecting === item.key ? null : item.key)} className={ROW_BUTTON} data-testid={`reject-${item.kind}`}>
                      {t("No aceptar…", "Not accepted…")}
                    </button>
                  )}
                </div>
              )}
              {rejecting === item.key && <ReviewForm client={client} busy={busy === item.key} onSave={(reason, note, askAgain) => void review(item, "rejected", reason, note, askAgain)} />}
            </li>
          );
        })}
      </ul>
      {message && (
        <p role="status" className="px-1 pt-2 text-[13px] text-slate-700">
          {message}
        </p>
      )}
      <ul className="space-y-1 px-1 pt-2 text-xs leading-relaxed text-slate-500" data-testid="not-collected">
        <li>{NOT_COLLECTED[locale].ssn}</li>
        <li>{NOT_COLLECTED[locale].ssnProof}</li>
        {!powerOfAttorneyEnabled() && <li>{NOT_COLLECTED[locale].poaOff}</li>}
        <li>
          {t(
            "Un documento requerido que no se acepta cuenta como faltante: no sale ninguna ronda con él, y el sistema le recuerda al cliente que suba otro.",
            "A required document that is not accepted counts as missing: no round goes out with it, and the system reminds the client to upload another.",
          )}
        </li>
      </ul>
    </div>
  );
}
