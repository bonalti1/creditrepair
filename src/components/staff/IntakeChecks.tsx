"use client";

import { useRef, useState } from "react";
import type { BureauLetterSummary, IntakeRecord, IntakeStatus, LetterOutcome } from "@/lib/intake/types";
import type { StaffClient } from "@/lib/staff/types";
import { longDay } from "@/lib/staff/format";
import { Chip, QUIET_BUTTON } from "@/components/staff/ui";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import Icon from "@/components/Icon";

// On the client page, under "Documentos": what the AI intake recorded
// (src/lib/intake). The newest check of the ID and the proof of address
// ("Revisado automáticamente" or "Para revisar", with the reasons), and the
// bureau letters that arrived. Letters are optional: results come from the
// next report. Staff can upload a letter that reached them another way.
//
// The check's own reasons are quoted as the AI wrote them (to the client).

const DOC_LABEL = {
  es: { government_id: "Identificación", proof_of_address: "Comprobante de domicilio" },
  en: { government_id: "ID", proof_of_address: "Proof of address" },
} as const;
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

export const OUTCOME_STAFF_EN: Record<LetterOutcome, string> = {
  deleted: "Deleted",
  verified: "Verified",
  updated: "Updated",
  in_investigation: "Under investigation",
  more_info_requested: "More information requested",
  frivolous: "“Frivolous”: not investigated",
  unclear: "Unclear",
};

function StatusChip({ status, simulated }: { status: IntakeStatus; simulated: boolean }) {
  const t = useTx();
  const label =
    status === "accepted"
      ? t("Revisado automáticamente", "Checked automatically")
      : status === "needs_person"
        ? t("Para revisar", "To review")
        : status === "read"
          ? t("Leída, con notas", "Read, with notes")
          : t("Sin lectura", "Not read");
  const tone = status === "accepted" ? "bg-green-50 text-green-700" : status === "needs_person" ? "bg-amber-100 text-blue-900" : "bg-slate-100 text-slate-600";
  return (
    <span className="flex flex-wrap gap-1.5">
      <Chip tone={tone}>{label}</Chip>
      {simulated && <Chip tone="bg-slate-100 text-slate-600">{t("Simulado", "Simulated")}</Chip>}
    </span>
  );
}

function LetterItems({ letter }: { letter: BureauLetterSummary }) {
  const t = useTx();
  return (
    <ul className="mt-1 space-y-1">
      {letter.items.map((item, i) => (
        <li key={`${item.creditor}-${i}`} className="text-[13px] leading-snug text-slate-700">
          <span className="font-medium text-slate-900">
            {item.creditor}
            {item.account ? ` ${item.account}` : ""}
          </span>{" "}
          — {t(OUTCOME_STAFF[item.outcome], OUTCOME_STAFF_EN[item.outcome])}
          {!item.fingerprint && <span className="text-amber-700">{t(" · no encontrado en el reporte", " · not found on the report")}</span>}
          {item.citation && (
            <span className="block break-words text-slate-500">
              {item.citation.page ? `${t("Pág.", "p.")} ${item.citation.page} · ` : ""}«{item.citation.quote}»
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function IntakeChecks({ client, demo, canUpload, onChanged }: { client: StaffClient; demo: boolean; canUpload: boolean; onChanged: () => void | Promise<void> }) {
  const { locale } = useStaffLocale();
  const t = useTx();
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
        setProblem(data.error ?? t("No se pudo subir la carta.", "Couldn't upload the letter."));
        return;
      }
      setUploaded({ status: data.status, reasons: data.reasons ?? [], letter: data.letter ?? null, simulated: data.simulated === true });
      await onChanged();
    } catch {
      setProblem(t("No se pudo subir la carta. Revisa la conexión.", "Couldn't upload the letter. Check the connection."));
    } finally {
      setBusy(false);
    }
  };

  const row = (record: IntakeRecord, title: string, extra?: React.ReactNode) => (
    <li key={record.id} className="border-t hairline px-5 py-3" data-testid="intake-record">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[14px] font-medium text-slate-900">
          {title} <span className="font-normal text-slate-500">· {longDay(record.at, locale)}</span>
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
      <p className="px-5 pt-3 text-[13px] font-semibold uppercase tracking-wide text-slate-500">{t("Revisión automática (IA)", "Automatic check (AI)")}</p>
      <ul className="mt-2">
        {checks.length === 0 && letters.length === 0 && (
          <li className="border-t hairline px-5 py-3 text-[14px] text-slate-500">{t("Todavía no hay documentos revisados por la IA.", "No documents checked by the AI yet.")}</li>
        )}
        {checks.map(([kind, record]) => row(record!, DOC_LABEL[locale][kind]))}
        {letters.map((record) =>
          row(
            record,
            t(
              `Carta de ${record.letter?.bureau ? BUREAU[record.letter.bureau] : "un buró"}${record.letter?.letterDate ? ` del ${record.letter.letterDate}` : ""}`,
              `Letter from ${record.letter?.bureau ? BUREAU[record.letter.bureau] : "a bureau"}${record.letter?.letterDate ? ` dated ${record.letter.letterDate}` : ""}`,
            ),
            record.letter && record.letter.items.length > 0 ? <LetterItems letter={record.letter} /> : null,
          ),
        )}
      </ul>
      {canUpload && (
        <div className="border-t hairline px-5 py-3">
          <p className="text-[13px] leading-snug text-slate-500">
            {t(
              "Las cartas de los burós son opcionales: los resultados de cada ronda salen del reporte nuevo. Si una carta te llegó por otro medio, puedes subirla aquí.",
              "Bureau letters are optional: each round's results come from the new report. If a letter reached you another way, you can upload it here.",
            )}
          </p>
          <button type="button" onClick={() => input.current?.click()} disabled={busy} className={`${QUIET_BUTTON} mt-1 -ml-3 text-blue-700`}>
            <Icon name="arrowUp" size={15} strokeWidth={2.25} />
            {busy ? t("Leyendo la carta…", "Reading the letter…") : t("Subir una carta de un buró", "Upload a bureau letter")}
          </button>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,application/pdf,.heic"
            className="sr-only"
            aria-label={t("Elegir la carta del buró", "Choose the bureau letter")}
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
              {demo && <p className="mt-1 text-xs text-slate-500">{t("Demo: no se guardó nada.", "Demo: nothing was saved.")}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
