"use client";

import { useRef, useState } from "react";
import type { RawReport } from "@/lib/domain/parser";
import type { ReportValidation, ReviewedItem } from "@/lib/intake/report/validate";
import type { AiReportEnvelope } from "@/lib/intake/report/envelope";
import { BUREAU_NAME } from "@/lib/reports/merge";
import { formatBytes } from "@/lib/staff/format";
import { Chip, QUIET_BUTTON, ROW_BUTTON } from "@/components/staff/ui";
import Icon from "@/components/Icon";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";

// The AI reader on the import screen (src/lib/intake, docs/INTAKE.md).
//
//   AiReportUpload  pick the PDF or saved page, send it to the server to be
//                   read. Nothing is saved to the client's report.
//   AiReviewPanel   inside the preview: what the AI was not sure about, each
//                   with its page and quote, the report-level warnings, and
//                   every item it read. The person compares the marked ones
//                   with the document before "Guardar reporte".
//
// The AI never says what is inaccurate; neither does this screen.
//
// The screen's words are in the member's language; what the automatic check
// wrote about an item (its reasons and warnings) is shown as it wrote it.

export interface AiReading {
  envelope: AiReportEnvelope;
  /** The envelope as the `ai_document` reader's source. */
  source: string;
  raw: RawReport;
  validation: ReportValidation;
  simulated: boolean;
  costUsd: number;
  fileName: string;
}

const ACCEPT = ".pdf,.html,.htm,.txt,application/pdf,text/html,text/plain";
/** The server's own limit is checked there; this one only saves a pointless upload. */
const MAX_UPLOAD = 20 * 1024 * 1024;

export function AiReportUpload({ clientId, onRead }: { clientId: string; onRead: (reading: AiReading) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const t = useTx();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[] | null>(null);

  const read = async () => {
    if (!file || busy) return;
    setBusy(true);
    setProblems(null);
    try {
      const form = new FormData();
      form.set("clientId", clientId);
      form.set("file", file);
      const response = await fetch("/api/staff/intake/report", { method: "POST", body: form });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        envelope?: AiReportEnvelope | null;
        validation?: ReportValidation;
        simulated?: boolean;
        costUsd?: number;
      };
      if (!response.ok) {
        setProblems([data.error ?? t("No se pudo leer el reporte.", "The report couldn't be read.")]);
        return;
      }
      const validation = data.validation;
      if (!data.envelope || !validation?.raw) {
        setProblems(validation?.fatal.length ? validation.fatal : [t("La lectura no se puede usar.", "The reading can't be used.")]);
        return;
      }
      onRead({
        envelope: data.envelope,
        source: JSON.stringify(data.envelope),
        raw: validation.raw,
        validation,
        simulated: data.simulated === true,
        costUsd: data.costUsd ?? 0,
        fileName: file.name,
      });
    } catch {
      setProblems([t("No se pudo enviar el archivo. Revisa la conexión y vuelve a intentar.", "The file couldn't be sent. Check the connection and try again.")]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3" data-testid="ai-upload">
      <p className="text-[13px] leading-snug text-slate-600">
        {t(
          "El PDF o la página guardada del reporte de 3 burós que el cliente descarga de su monitoreo (IdentityIQ, SmartCredit, MyFreeScoreNow…). La IA lo transcribe con la página y la cita de cada punto, y el sistema revisa la lectura. Aquí verás primero lo que no está claro; no se guarda nada hasta «Guardar reporte».",
          "The PDF or saved page of the 3-bureau report the client downloads from their monitoring (IdentityIQ, SmartCredit, MyFreeScoreNow…). The AI transcribes it with each item's page and quote, and the system checks the reading. You'll see what isn't clear first; nothing is saved until “Save report”.",
        )}
      </p>
      <div className="mt-3">
        {file ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-50 px-4 py-3">
            <p className="flex min-w-0 items-center gap-2 text-[14px] text-slate-900">
              <Icon name="doc" size={18} className="shrink-0 text-slate-500" />
              <span className="min-w-0 break-all">{file.name}</span>
              <span className="shrink-0 text-slate-500">· {formatBytes(file.size)}</span>
            </p>
            <button type="button" onClick={() => setFile(null)} className={QUIET_BUTTON} disabled={busy}>
              {t("Quitar", "Remove")}
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => input.current?.click()} className={`${ROW_BUTTON} h-12 gap-2 px-5`}>
            <Icon name="arrowUp" size={16} strokeWidth={2.25} />
            {t("Elegir el PDF o la página", "Choose the PDF or page")}
          </button>
        )}
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          aria-label={t("Elegir el PDF o la página guardada del reporte", "Choose the report's PDF or saved page")}
          onChange={(e) => {
            const chosen = e.target.files?.[0];
            e.target.value = "";
            if (!chosen) return;
            setProblems(null);
            if (chosen.size > MAX_UPLOAD) {
              setProblems([t(`«${chosen.name}» pesa ${formatBytes(chosen.size)}. El máximo es 20 MB.`, `“${chosen.name}” is ${formatBytes(chosen.size)}. The limit is 20 MB.`)]);
              return;
            }
            setFile(chosen);
          }}
        />
      </div>
      {problems && (
        <div className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-[14px] leading-snug text-red-700" role="alert" data-testid="ai-problems">
          <p className="font-semibold">{t("No se pudo usar la lectura. No se guardó nada en el reporte del cliente.", "The reading couldn't be used. Nothing was saved to the client's report.")}</p>
          <ul className="mt-1 space-y-1">
            {problems.map((p) => (
              <li key={p} className="break-words">
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-4">
        <button
          type="button"
          onClick={read}
          disabled={!file || busy}
          className={`${ROW_BUTTON} h-12 px-6 text-[16px] disabled:bg-slate-100 disabled:text-slate-400`}
        >
          {busy ? t("Leyendo… (puede tardar un minuto)", "Reading… (it can take a minute)") : t("Leer con IA", "Read with AI")}
        </button>
      </div>
    </div>
  );
}

function Citation({ item }: { item: ReviewedItem }) {
  const t = useTx();
  if (!item.citation) return <p className="text-[13px] text-slate-500">{t("Sin cita del documento.", "No quote from the document.")}</p>;
  return (
    <p className="break-words text-[13px] leading-snug text-slate-500">
      {item.citation.page !== null ? t(`Pág. ${item.citation.page}`, `p. ${item.citation.page}`) : t("Página no válida", "Invalid page")} · «{item.citation.quote}»
    </p>
  );
}

const CATEGORY_NAME: Record<"es" | "en", Record<ReviewedItem["category"], string>> = {
  es: { tradeline: "Cuenta", inquiry: "Consulta", public_record: "Registro público", personal_info: "Dato personal" },
  en: { tradeline: "Account", inquiry: "Inquiry", public_record: "Public record", personal_info: "Personal detail" },
};

/** Items a person must look at: low confidence or left out. */
export function flaggedItems(validation: ReportValidation): ReviewedItem[] {
  return validation.items.filter((i) => i.confidence === "low" || i.excluded);
}

export function AiReviewPanel({ reading, demo }: { reading: AiReading; demo: boolean }) {
  const { locale } = useStaffLocale();
  const t = useTx();
  const flagged = flaggedItems(reading.validation);
  const sure = reading.validation.items.filter((i) => i.confidence === "high" && !i.excluded);
  return (
    <div className="mb-5" data-testid="ai-review">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">{t("Lectura con IA", "AI reading")}</p>
        {reading.simulated && <Chip tone="bg-slate-100 text-slate-700">{t("Simulada: sin IA", "Simulated: no AI")}</Chip>}
        <span className="text-[13px] text-slate-500">
          · {reading.fileName}
          {!reading.simulated && reading.costUsd > 0 ? t(` · costo estimado US$${reading.costUsd.toFixed(2)}`, ` · estimated cost US$${reading.costUsd.toFixed(2)}`) : ""}
        </span>
      </div>
      {reading.simulated && (
        <p className="mt-1.5 text-[13px] leading-snug text-slate-600">
          {demo
            ? t(
                "No hay clave de IA configurada: esta es una lectura de ejemplo (el reporte de la demo, con un punto marcado como dudoso), para ver cómo funciona.",
                "No AI key is set up: this is a sample reading (the demo's report, with one item marked doubtful), to show how it works.",
              )
            : t(
                "No hay clave de IA configurada en el servidor: esta lectura es un ejemplo y no se puede guardar en el expediente de un cliente real.",
                "No AI key is set up on the server: this reading is a sample and can't be saved to a real client's file.",
              )}
        </p>
      )}

      {flagged.length > 0 || reading.validation.warnings.length > 0 ? (
        <div className="mt-3 rounded-2xl bg-amber-50 px-4 py-3" role="note" data-testid="ai-flagged">
          <p className="text-[15px] font-semibold text-blue-900">
            {flagged.length === 0
              ? t("Revisa esto contra el documento antes de guardar", "Check this against the document before saving")
              : flagged.length === 1
                ? t("1 punto para revisar contra el documento", "1 item to check against the document")
                : t(`${flagged.length} puntos para revisar contra el documento`, `${flagged.length} items to check against the document`)}
          </p>
          {reading.validation.warnings.length > 0 && (
            <ul className="mt-1.5 space-y-1 text-[14px] leading-snug text-blue-900">
              {reading.validation.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          {flagged.length > 0 && (
            <ul className="mt-2 divide-y divide-amber-200/70">
              {flagged.map((item, index) => (
                <li key={`${item.fingerprint}-${index}`} className="py-2" data-testid="ai-flagged-item">
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                    <p className="min-w-0 flex-1 basis-56 break-words text-[14px] font-medium leading-snug text-slate-900">
                      <span className="font-normal text-slate-600">
                        {BUREAU_NAME[item.bureau]} · {CATEGORY_NAME[locale][item.category]} ·{" "}
                      </span>
                      {item.label}
                    </p>
                    <Chip tone={item.excluded ? "bg-red-50 text-red-700" : "bg-amber-100 text-blue-900"}>
                      {item.excluded ? t("No se guarda", "Not saved") : t("Confianza baja", "Low confidence")}
                    </Chip>
                  </div>
                  <ul className="mt-0.5 space-y-0.5 text-[13px] leading-snug text-slate-700">
                    {item.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                  <Citation item={item} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="mt-3 flex items-start gap-2 rounded-2xl bg-green-50 px-4 py-3 text-[14px] leading-snug text-green-700">
          <Icon name="check" size={18} className="mt-px shrink-0" />
          <span>{t("La IA leyó todo con confianza alta y la revisión automática no encontró nada que marcar.", "The AI read everything with high confidence and the automatic check found nothing to flag.")}</span>
        </p>
      )}

      <details className="mt-3 rounded-2xl bg-slate-50 px-4 py-2.5">
        <summary className="cursor-pointer text-[14px] font-medium text-slate-700">
          {t(`Ver los ${sure.length} puntos leídos con confianza alta, con su cita`, `See the ${sure.length} items read with high confidence, with their quotes`)}
        </summary>
        <ul className="mt-1 divide-y divide-slate-200/70">
          {sure.map((item, index) => (
            <li key={`${item.fingerprint}-${index}`} className="py-1.5">
              <p className="break-words text-[14px] leading-snug text-slate-900">
                <span className="text-slate-500">{BUREAU_NAME[item.bureau]} · </span>
                {item.label}
              </p>
              <Citation item={item} />
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
