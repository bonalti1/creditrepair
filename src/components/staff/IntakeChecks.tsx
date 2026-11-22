"use client";

import { useRef, useState } from "react";
import type { BureauLetterSummary, IntakeRecord, IntakeStatus, LetterOutcome } from "@/lib/intake/types";
import type { StaffClient } from "@/lib/staff/types";
import { longDay } from "@/lib/staff/format";
import { Chip, QUIET_BUTTON } from "@/components/staff/ui";
import Icon from "@/components/Icon";

// On the client page, under "Documentos": what the AI intake recorded
// (src/lib/intake). The newest check of the ID and the proof of address
// ("Revisado automáticamente" or "Para revisar", with the reasons), and the
// bureau letters that arrived. Letters are optional: results come from the
// next report. Staff can upload a letter that reached them another way.

const DOC_LABEL = { government_id: "Identificación", proof_of_address: "Comprobante de domicilio" } as const;
const BUREAU = { equifax: "Equifax", experian: "Experian", transunion: "TransUnion" } as const;

export const OUTCOME_STAFF: Record<LetterOutcome, string> = {
  deleted: "Eliminado",
  verified: "Verificado",
  updated: "Actualizado",
  in_investigation: "En investigación",
  more_info_requested: "Piden más información",
  frivolous: "«Frívola»: no lo investigan",
  unclear: "No está claro",
};

function StatusChip({ status, simulated }: { status: IntakeStatus; simulated: boolean }) {
  const label =
    status === "accepted" ? "Revisado automáticamente" : status === "needs_person" ? "Para revisar" : status === "read" ? "Leída, con notas" : "Sin lectura";
  const tone = status === "accepted" ? "bg-green-50 text-green-700" : status === "needs_person" ? "bg-amber-100 text-blue-900" : "bg-slate-100 text-slate-600";
  return (
    <span className="flex flex-wrap gap-1.5">
      <Chip tone={tone}>{label}</Chip>
      {simulated && <Chip tone="bg-slate-100 text-slate-600">Simulado</Chip>}
    </span>
  );
}

function LetterItems({ letter }: { letter: BureauLetterSummary }) {
  return (
    <ul className="mt-1 space-y-1">
      {letter.items.map((item, i) => (
        <li key={`${item.creditor}-${i}`} className="text-[13px] leading-snug text-slate-700">
          <span className="font-medium text-slate-900">
            {item.creditor}
            {item.account ? ` ${item.account}` : ""}
          </span>{" "}
          — {OUTCOME_STAFF[item.outcome]}
          {!item.fingerprint && <span className="text-amber-700"> · no encontrado en el reporte</span>}
          {item.citation && (
            <span className="block break-words text-slate-500">
              {item.citation.page ? `Pág. ${item.citation.page} · ` : ""}«{item.citation.quote}»
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function IntakeChecks({ client, demo, canUpload, onChanged }: { client: StaffClient; demo: boolean; canUpload: boolean; onChanged: () => void | Promise<void> }) {
  const records = client.intake ?? [];
  const newest = (kind: "government_id" | "proof_of_address") => records.filter((r) => r.kind === kind).sort((a, b) => b.at.localeCompare(a.at))[0];
  const checks = (["government_id", "proof_of_address"] as const).map((kind) => [kind, newest(kind)] as const).filter(([, r]) => r);
  const letters = records.filter((r) => r.kind === "bureau_letter").sort((a, b) => b.at.localeCompare(a.at));
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [uploaded, setUploaded] = useState<{ status: IntakeStatus; reasons: string[]; letter: BureauLetterSummary | null; simulated: boolean } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setProblem(null);
    setUploaded(null);
    try {
      const form = new FormData();
      form.set("clientId", client.id);
      form.set("file", file);
      const response = await fetch("/api/staff/intake/letter", { method: "POST", body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setProblem(data.error ?? "No se pudo subir la carta.");
        return;
      }
      setUploaded({ status: data.status, reasons: data.reasons ?? [], letter: data.letter ?? null, simulated: data.simulated === true });
      await onChanged();
    } catch {
      setProblem("No se pudo subir la carta. Revisa la conexión.");
    } finally {
      setBusy(false);
    }
  };

  const row = (record: IntakeRecord, title: string, extra?: React.ReactNode) => (
    <li key={record.id} className="border-t hairline px-5 py-3" data-testid="intake-record">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[14px] font-medium text-slate-900">
          {title} <span className="font-normal text-slate-500">· {longDay(record.at)}</span>
        </p>
        <StatusChip status={record.status} simulated={record.simulated} />
      </div>
      {record.reasons.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-[13px] leading-snug text-slate-600">
          {record.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {extra}
    </li>
  );

  return (
    <div className="card mt-3 overflow-hidden" data-testid="intake-checks">
      <p className="px-5 pt-3 text-[13px] font-semibold uppercase tracking-wide text-slate-500">Revisión automática (IA)</p>
      <ul className="mt-2">
        {checks.length === 0 && letters.length === 0 && (
          <li className="border-t hairline px-5 py-3 text-[14px] text-slate-500">Todavía no hay documentos revisados por la IA.</li>
        )}
        {checks.map(([kind, record]) => row(record!, DOC_LABEL[kind]))}
        {letters.map((record) =>
          row(
            record,
            `Carta de ${record.letter?.bureau ? BUREAU[record.letter.bureau] : "un buró"}${record.letter?.letterDate ? ` del ${record.letter.letterDate}` : ""}`,
            record.letter && record.letter.items.length > 0 ? <LetterItems letter={record.letter} /> : null,
          ),
        )}
      </ul>
      {canUpload && (
        <div className="border-t hairline px-5 py-3">
          <p className="text-[13px] leading-snug text-slate-500">
            Las cartas de los burós son opcionales: los resultados de cada ronda salen del reporte nuevo. Si una carta te llegó
            por otro medio, puedes subirla aquí.
          </p>
          <button type="button" onClick={() => input.current?.click()} disabled={busy} className={`${QUIET_BUTTON} mt-1 -ml-3 text-blue-700`}>
            <Icon name="arrowUp" size={15} strokeWidth={2.25} />
            {busy ? "Leyendo la carta…" : "Subir una carta de un buró"}
          </button>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,application/pdf,.heic"
            className="sr-only"
            aria-label="Elegir la carta del buró"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void upload(file);
            }}
          />
          {problem && <p className="mt-1 text-[13px] text-red-700" role="alert">{problem}</p>}
          {uploaded && (
            <div className="mt-2 rounded-2xl bg-slate-50 px-4 py-3" role="status">
              <StatusChip status={uploaded.status} simulated={uploaded.simulated} />
              {uploaded.reasons.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-[13px] leading-snug text-slate-600">
                  {uploaded.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
              {uploaded.letter && <LetterItems letter={uploaded.letter} />}
              {demo && <p className="mt-1 text-xs text-slate-500">Demo: no se guardó nada.</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
