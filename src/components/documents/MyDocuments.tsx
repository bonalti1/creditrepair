"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { useLocale } from "@/lib/i18n";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  clientReviewLine,
  currentReview,
  DOCUMENT_KIND_LABEL,
  EXTRA_KIND_HINT,
  uploadableExtraKinds,
  type ClientFile,
  type DocumentReview,
  type ExtraDocumentKind,
} from "@/lib/fulfillment/documents";
import type { DocumentKind } from "@/lib/staff/types";

// "Mis documentos" / "My documents": every document the client gave us, what
// our team said about each (accepted, or not accepted with the reason and a
// button to upload another), and the other documents CRC lets clients send
// (proof for a disputed item, a creditor's letter, court papers). Never a
// Social Security card. The power of attorney appears only once the attorney
// approved its text (fulfillment/documents.ts).
//
// Demo: an invented state, labelled; uploads are not stored.

interface Data {
  identity: Array<{ kind: DocumentKind; uploadedAt: string }>;
  files: ClientFile[];
  reviews: DocumentReview[];
  kinds: ExtraDocumentKind[];
}

const COPY = {
  en: {
    title: "Your documents",
    required: "Needed for every letter",
    others: "Other documents",
    othersLead: "Optional. Anything that backs up what you told us about an item. Our team reads it; it is not mailed unless a person decides it should be.",
    onFile: "On file",
    missing: "Missing",
    accepted: "Accepted",
    notAccepted: "Not accepted",
    reviewing: "Received",
    upload: "Upload",
    uploadAgain: "Upload a new one",
    kind: "What is it?",
    description: "A few words (optional)",
    descriptionHint: "For example: “Letter from Midland saying it was paid”. Please don't write your Social Security number.",
    send: "Send it",
    sending: "Sending…",
    sent: "Received. Our team will look at it.",
    remove: "Take it back",
    none: "Nothing yet.",
    error: "We could not upload it. Please try again.",
    never: "We never ask for your Social Security card, and we never keep one.",
    demo: "Demo: invented documents; nothing you choose is uploaded.",
  },
  es: {
    title: "Tus documentos",
    required: "Necesarios para cada carta",
    others: "Otros documentos",
    othersLead: "Opcional. Lo que respalde lo que nos dijiste de un punto. Nuestro equipo lo lee; no se envía por correo a menos que una persona lo decida.",
    onFile: "En archivo",
    missing: "Falta",
    accepted: "Aceptado",
    notAccepted: "No aceptado",
    reviewing: "Recibido",
    upload: "Subir",
    uploadAgain: "Subir uno nuevo",
    kind: "¿Qué es?",
    description: "Unas palabras (opcional)",
    descriptionHint: "Por ejemplo: «Carta de Midland que dice que se pagó». Por favor, no escribas tu número de Seguro Social.",
    send: "Enviarlo",
    sending: "Enviando…",
    sent: "Recibido. Nuestro equipo lo va a revisar.",
    remove: "Retirarlo",
    none: "Nada todavía.",
    error: "No se pudo subir. Intenta de nuevo.",
    never: "Nunca te pedimos tu tarjeta de Seguro Social, y nunca guardamos una.",
    demo: "Demo: documentos inventados; lo que elijas no se sube.",
  },
} as const;

function demoData(): Data {
  const at = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  return {
    identity: [
      { kind: "government_id", uploadedAt: at(6) },
      { kind: "proof_of_address", uploadedAt: at(6) },
    ],
    files: [{ id: "demo-f1", kind: "supporting_document", fileName: "statement.pdf", contentType: "application/pdf", bytes: 182_000, description: "Statement showing the payment", uploadedAt: at(3), uploadedBy: "client", withdrawnAt: null }],
    reviews: [
      { id: "demo-r1", kind: "government_id", fileId: null, documentUploadedAt: at(6), decision: "accepted", reasonCode: null, note: "", askAgain: false, by: "", at: at(5) },
      { id: "demo-r2", kind: "proof_of_address", fileId: null, documentUploadedAt: at(6), decision: "rejected", reasonCode: "too_old", note: "", askAgain: true, by: "", at: at(5) },
    ],
    kinds: uploadableExtraKinds(),
  };
}

export default function MyDocuments() {
  const { locale } = useLocale();
  const l = locale === "en" ? "en" : "es";
  const c = COPY[l];
  const live = isSupabaseConfigured();
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [kind, setKind] = useState<ExtraDocumentKind>("supporting_document");
  const [description, setDescription] = useState("");

  const load = useCallback(async () => {
    if (!live) return setData(demoData());
    const res = await fetch("/api/documents", { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return setData({ identity: [], files: [], reviews: [], kinds: uploadableExtraKinds() });
    setData((await res.json()) as Data);
  }, [live]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) return null;
  const docs = {
    documents: data.identity.map((d) => d.kind),
    documentUploadedAt: Object.fromEntries(data.identity.map((d) => [d.kind, d.uploadedAt])),
    documentReviews: data.reviews,
    files: data.files,
  };

  const uploadIdentity = async (k: DocumentKind, file: File) => {
    setBusy(k);
    setMessage(null);
    if (!live) {
      setBusy(null);
      return setMessage(c.demo);
    }
    const form = new FormData();
    form.set("kind", k);
    form.set("file", file);
    const res = await fetch("/api/intake/document", { method: "POST", body: form }).catch(() => null);
    setBusy(null);
    if (!res?.ok) return setMessage(c.error);
    setMessage(c.sent);
    await load();
  };

  const uploadExtra = async (file: File) => {
    setBusy("extra");
    setMessage(null);
    if (!live) {
      setBusy(null);
      return setMessage(c.demo);
    }
    const form = new FormData();
    form.set("kind", kind);
    form.set("description", description);
    form.set("file", file);
    const res = await fetch("/api/documents", { method: "POST", body: form }).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      const body = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
      return setMessage(body?.error ?? c.error);
    }
    setDescription("");
    setMessage(c.sent);
    await load();
  };

  const withdraw = async (id: string) => {
    if (!live) return setMessage(c.demo);
    await fetch("/api/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "withdraw", id }) }).catch(() => null);
    await load();
  };

  const statusOf = (k: DocumentKind | ExtraDocumentKind, fileId: string | null, onFile: boolean) => {
    if (!onFile) return { label: c.missing, tone: "bg-amber-100 text-blue-900", review: null as DocumentReview | null };
    const review = currentReview(docs, k as Exclude<DocumentKind, "ssn_card">, fileId);
    if (review?.decision === "accepted") return { label: c.accepted, tone: "bg-green-50 text-green-700", review };
    if (review?.decision === "rejected") return { label: c.notAccepted, tone: "bg-red-50 text-red-700", review };
    return { label: fileId ? c.reviewing : c.onFile, tone: "bg-green-50 text-green-700", review: null };
  };

  const fileButton = (label: string, onFile: (f: File) => void, disabled: boolean, testId: string) => (
    <label className={`pressable mt-3 flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-amber-400 px-5 text-[16px] font-semibold text-blue-900 hover:bg-amber-500 ${disabled ? "opacity-60" : ""}`} data-testid={testId}>
      <Icon name="doc" size={18} />
      {label}
      <input
        type="file"
        accept="image/jpeg,image/png,application/pdf"
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFile(f);
        }}
      />
    </label>
  );

  return (
    <div className="space-y-5" data-testid="my-documents">
      <section>
        <h2 className="px-1 pb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500">{c.required}</h2>
        <ul className="card overflow-hidden">
          {(["government_id", "proof_of_address"] as const).map((k, i) => {
            const onFile = docs.documents.includes(k);
            const st = statusOf(k, null, onFile);
            return (
              <li key={k} className={`px-4 py-3.5 ${i > 0 ? "border-t hairline" : ""}`} data-testid={`my-doc-${k}`}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[17px] font-medium text-slate-900">{DOCUMENT_KIND_LABEL[l][k]}</span>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold ${st.tone}`}>{st.label}</span>
                </div>
                {st.review && <p className="mt-1.5 text-[14px] leading-snug text-slate-700">{clientReviewLine(st.review, l)}</p>}
                {(!onFile || st.review?.decision === "rejected") && fileButton(busy === k ? c.sending : onFile ? c.uploadAgain : c.upload, (f) => void uploadIdentity(k, f), busy !== null, `upload-${k}`)}
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2 className="px-1 pb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500">{c.others}</h2>
        <div className="card px-4 py-4">
          <p className="text-[14px] leading-relaxed text-slate-600">{c.othersLead}</p>
          {data.files.length === 0 ? (
            <p className="mt-3 text-[14px] text-slate-500">{c.none}</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {data.files.map((f) => {
                const st = statusOf(f.kind, f.id, true);
                return (
                  <li key={f.id} className="rounded-xl border border-slate-200 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 text-[15px] font-medium text-slate-900">{DOCUMENT_KIND_LABEL[l][f.kind]}</span>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold ${st.tone}`}>{st.label}</span>
                    </div>
                    <p className="mt-0.5 break-words text-[13px] text-slate-500">{[f.description, f.fileName].filter(Boolean).join(" · ")}</p>
                    {st.review && <p className="mt-1 text-[14px] leading-snug text-slate-700">{clientReviewLine(st.review, l)}</p>}
                    <button type="button" onClick={() => void withdraw(f.id)} className="mt-1 inline-flex min-h-11 items-center text-[14px] font-medium text-blue-700">
                      {c.remove}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-4 space-y-3 border-t hairline pt-4">
            <label className="block text-[14px] font-medium text-slate-700">
              {c.kind}
              <select className="mt-1 h-12 w-full rounded-xl bg-white px-3 text-[16px] text-slate-900 shadow-[0_0_0_1px_rgba(0,0,0,0.12)]" value={kind} onChange={(e) => setKind(e.target.value as ExtraDocumentKind)}>
                {data.kinds.map((k) => (
                  <option key={k} value={k}>
                    {DOCUMENT_KIND_LABEL[l][k]}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-[13px] leading-snug text-slate-500">{EXTRA_KIND_HINT[l][kind]}</p>
            <label className="block text-[14px] font-medium text-slate-700">
              {c.description}
              <input className="mt-1 h-12 w-full rounded-xl bg-white px-3 text-[16px] text-slate-900 shadow-[0_0_0_1px_rgba(0,0,0,0.12)]" value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} />
            </label>
            <p className="text-[12.5px] leading-snug text-slate-500">{c.descriptionHint}</p>
            {fileButton(busy === "extra" ? c.sending : c.send, (f) => void uploadExtra(f), busy !== null, "upload-extra")}
          </div>
        </div>
      </section>

      {message && (
        <p role="status" className="rounded-2xl bg-slate-100 px-4 py-3 text-[14px] leading-snug text-slate-800">
          {message}
        </p>
      )}
      <p className="px-1 text-[13px] leading-relaxed text-slate-500">{c.never}</p>
      {!live && <p className="px-1 text-[13px] leading-relaxed text-slate-500">{c.demo}</p>}
    </div>
  );
}
