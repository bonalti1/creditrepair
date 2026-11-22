"use client";

import { useId, useMemo, useRef, useState } from "react";
import type { RawReport } from "@/lib/domain/parser";
import type { ItemCategory, ReportItem } from "@/lib/domain/types";
import { BUREAU_NAME, importPreview, toRawReport, type ImportPreview } from "@/lib/reports/merge";
import {
  ACCEPTED_FILE_EXTENSIONS,
  getReportReader,
  MAX_SOURCE_BYTES,
  REPORT_READERS,
  ReportReadError,
  suggestReader,
} from "@/lib/reports/readers";
import { TEMPLATE_FILE_NAME, templateJson } from "@/lib/reports/template";
import type { StaffData } from "@/lib/staff/data";
import { count, formatBytes, longDay } from "@/lib/staff/format";
import { ACTOR_LABELS, STAGE_TEXT } from "@/lib/staff/stage";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { staffMessage } from "@/lib/staff/i18n/messages";
import type { StaffLocale } from "@/lib/staff/i18n/locale";
import type { StaffClient } from "@/lib/staff/types";
import { staffAuthor } from "@/lib/staff/useStaff";
import { itemLabel } from "@/lib/ux/itemDisplay";
import { Chip, PRIMARY_BUTTON, QUIET_BUTTON, ROW_BUTTON, SECONDARY_BUTTON } from "@/components/staff/ui";
import Icon from "@/components/Icon";
import { AiReportUpload, AiReviewPanel, flaggedItems, type AiReading } from "@/components/staff/AiReportReview";

// Bringing a client's report in. Staff choose where it comes from, paste the
// text or pick a file, and press "Revisar": the report is read and shown
// (what it holds, what changed against the one on file, what saving would do)
// before anything is saved. Only then is there a "Guardar reporte" button.
//
// Two sources can be read: the app's own JSON format, and any provider's PDF
// or saved page through the AI reader ("Subir PDF del reporte", src/lib/intake):
// the AI transcribes it with a citation per item, deterministic checks mark
// what is doubtful, and the preview lists those first for a person to compare
// with the document. For a provider's page pasted as text there is still no
// reader of its own: the page can be kept as a sample.
//
// Nothing here writes what a client said about an item.

const CATEGORY: Record<StaffLocale, Record<ItemCategory, [singular: string, plural: string]>> = {
  es: {
    tradeline: ["cuenta", "cuentas"],
    inquiry: ["consulta", "consultas"],
    public_record: ["registro público", "registros públicos"],
    personal_info: ["dato personal", "datos personales"],
  },
  en: {
    tradeline: ["account", "accounts"],
    inquiry: ["inquiry", "inquiries"],
    public_record: ["public record", "public records"],
    personal_info: ["personal detail", "personal details"],
  },
};
const CATEGORY_ORDER: ItemCategory[] = ["tradeline", "inquiry", "public_record", "personal_info"];

const FIELD =
  "w-full rounded-2xl bg-slate-50 px-3.5 text-[15px] text-slate-900 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-blue-300";

function categoryLine(byCategory: Record<ItemCategory, number>, locale: StaffLocale): string {
  const parts = CATEGORY_ORDER.filter((c) => byCategory[c] > 0).map((c) => count(byCategory[c], ...CATEGORY[locale][c]));
  return parts.length > 0 ? parts.join(" · ") : locale === "es" ? "sin puntos" : "no items";
}

function download(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function ItemRow({ item, children, flagged }: { item: ReportItem; children?: React.ReactNode; flagged?: boolean }) {
  const { locale } = useStaffLocale();
  const t = useTx();
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 py-2">
      <div className="min-w-0 flex-1 basis-56">
        <p className="break-words text-[14px] leading-snug text-slate-900">
          <span className="text-slate-500">{BUREAU_NAME[item.bureau]} · </span>
          {itemLabel(item, locale)}
        </p>
        {children}
      </div>
      <span className="flex shrink-0 flex-wrap gap-1.5">
        {flagged && <Chip tone="bg-amber-100 text-blue-900">{t("Revisar", "Check")}</Chip>}
        {item.negative && <Chip tone="bg-slate-100 text-slate-600">{t("Se ve negativo", "Looks negative")}</Chip>}
      </span>
    </li>
  );
}

function Group({ title, n, children }: { title: string; n: number; children?: React.ReactNode }) {
  return (
    <div className="border-t hairline py-3">
      <p className="text-[14px] font-semibold text-slate-900">
        {title} <span className="font-normal tabular-nums text-slate-500">· {n}</span>
      </p>
      {n > 0 && <ul className="mt-0.5 divide-y divide-slate-100">{children}</ul>}
    </div>
  );
}

function Preview({ preview, flagged }: { preview: ImportPreview; flagged?: ReadonlySet<string> }) {
  const { locale } = useStaffLocale();
  const t = useTx();
  const STAGES = STAGE_TEXT[locale];
  const comparison = preview.comparison;
  return (
    <div data-testid="import-preview">
      <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">{t("Lo que trae este reporte", "What this report has")}</p>
      <p className="mt-1 text-[17px] font-medium leading-snug text-slate-900">
        {t(`Reporte del ${longDay(preview.reportDate, "es")}`, `Report from ${longDay(preview.reportDate, "en")}`)}
        <span className="font-normal text-slate-500">
          {" "}
          ·{" "}
          {preview.ageDays === 0
            ? t("de hoy", "today")
            : preview.ageDays === 1
              ? t("de ayer", "yesterday")
              : t(`de hace ${preview.ageDays} días`, `${preview.ageDays} days old`)}
        </span>
      </p>
      <p className="mt-0.5 text-[14px] leading-snug text-slate-600">
        {t(count(preview.total, "punto", "puntos"), count(preview.total, "item", "items"))}: {categoryLine(preview.byCategory, locale)}.{" "}
        {t(count(preview.negative, "se ve negativo", "se ven negativos"), count(preview.negative, "looks negative", "look negative"))}.
      </p>

      <ul className="mt-3 overflow-hidden rounded-2xl bg-slate-50">
        {preview.bureaus.map((b, index) => (
          <li
            key={b.bureau}
            className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-2.5 ${index > 0 ? "border-t hairline" : ""}`}
          >
            <p className="min-w-0 text-[14px] leading-snug text-slate-900">
              <span className="font-semibold">{BUREAU_NAME[b.bureau]}</span>
              <span className="text-slate-600"> · {categoryLine(b.byCategory, locale)}</span>
              {b.negative > 0 && (
                <span className="text-slate-500"> · {t(count(b.negative, "se ve negativo", "se ven negativos"), count(b.negative, "looks negative", "look negative"))}</span>
              )}
            </p>
            <p className="shrink-0 text-[14px] tabular-nums text-slate-600">
              {b.score !== null ? (
                <>
                  {t("Puntaje", "Score")} <span className="font-semibold text-slate-900">{b.score}</span>
                </>
              ) : (
                t("Sin puntaje", "No score")
              )}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs leading-relaxed text-slate-500">
        {t(
          "«Se ve negativo» es una lectura automática del reporte (cobranzas, pagos tardíos, consultas duras). No decide nada: solo el cliente dice qué es inexacto.",
          "“Looks negative” is an automatic reading of the report (collections, late payments, hard inquiries). It decides nothing: only the client says what's inaccurate.",
        )}
      </p>

      {comparison && (
        <div className="mt-5" data-testid="import-changes">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">
            {t(`Qué cambia contra el reporte del ${longDay(comparison.previousDate, "es")}`, `What changes against the ${longDay(comparison.previousDate, "en")} report`)}
          </p>
          <div className="mt-2">
            <Group title={t("Ya no aparecen", "No longer showing")} n={comparison.removed.length}>
              {comparison.removed.map(({ item, inRound }) => (
                <ItemRow key={item.fingerprint} item={item} flagged={flagged?.has(item.fingerprint)}>
                  {inRound !== null && (
                    <p className="text-[13px] leading-snug text-green-700">{t(`Se disputó en la ronda ${inRound}.`, `Disputed in round ${inRound}.`)}</p>
                  )}
                </ItemRow>
              ))}
            </Group>
            <Group title={t("Nuevos", "New")} n={comparison.added.length}>
              {comparison.added.map((item) => (
                <ItemRow key={item.fingerprint} item={item} flagged={flagged?.has(item.fingerprint)}>
                  <p className="text-[13px] leading-snug text-slate-500">{t("Queda pendiente de la revisión del cliente.", "Waits for the client's review.")}</p>
                </ItemRow>
              ))}
            </Group>
            <Group title={t("Cambiaron", "Changed")} n={comparison.changed.length}>
              {comparison.changed.map(({ item, differences }) => (
                <ItemRow key={item.fingerprint} item={item} flagged={flagged?.has(item.fingerprint)}>
                  {differences.map((line) => (
                    <p key={line} className="break-words text-[13px] leading-snug text-slate-600">
                      {line}
                    </p>
                  ))}
                </ItemRow>
              ))}
            </Group>
            <div className="border-t hairline pt-3 text-[14px] leading-snug text-slate-600">
              <p>{t(`Sin cambios: ${count(comparison.unchanged, "punto", "puntos")}.`, `Unchanged: ${count(comparison.unchanged, "item", "items")}.`)}</p>
              <p>
                {t(
                  `De los puntos que se ven negativos, ${comparison.removedNegative === 0 ? "ninguno desapareció" : count(comparison.removedNegative, "ya no aparece", "ya no aparecen")} y ${count(comparison.remainingNegative, "sigue", "siguen")} en el reporte.`,
                  `Of the items that look negative, ${comparison.removedNegative === 0 ? "none disappeared" : `${comparison.removedNegative} no longer ${comparison.removedNegative === 1 ? "shows" : "show"}`} and ${comparison.remainingNegative} ${comparison.remainingNegative === 1 ? "is" : "are"} still on the report.`,
                )}
              </p>
              {comparison.scores.length > 0 && (
                <p className="tabular-nums">
                  {t("Puntajes:", "Scores:")}{" "}
                  {comparison.scores
                    .map((s) => `${BUREAU_NAME[s.bureau]} ${s.from ?? t("sin puntaje", "no score")} → ${s.to ?? t("sin puntaje", "no score")}`)
                    .join(" · ")}
                  .
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {preview.notes.length > 0 && (
        <ul className="mt-4 space-y-1 rounded-2xl bg-amber-50 px-4 py-3 text-[14px] leading-snug text-blue-900" role="note">
          {preview.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      {preview.blocked ? (
        <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-[14px] leading-snug text-red-700" role="alert">
          <span className="font-semibold">{t("Este reporte no se puede guardar.", "This report can't be saved.")}</span> {preview.blocked}
        </p>
      ) : (
        <div className="mt-5" data-testid="import-effects">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">{t("Al guardar", "When you save")}</p>
          <ul className="mt-1.5 space-y-1.5">
            {preview.effects.map((line) => (
              <li key={line} className="flex gap-2 text-[14px] leading-snug text-slate-800">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" aria-hidden="true" />
                <span className="min-w-0">{line}</span>
              </li>
            ))}
            {preview.after && (
              <li className="flex gap-2 text-[14px] leading-snug text-slate-800">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" aria-hidden="true" />
                <span className="min-w-0">
                  {preview.after.stageBefore === preview.after.stageAfter
                    ? t(`La etapa no cambia: sigue en «${STAGES[preview.after.stageAfter].label}».`, `The stage doesn't change: it stays at “${STAGES[preview.after.stageAfter].label}”.`)
                    : t(
                        `La etapa pasa de «${STAGES[preview.after.stageBefore].label}» a «${STAGES[preview.after.stageAfter].label}».`,
                        `The stage goes from “${STAGES[preview.after.stageBefore].label}” to “${STAGES[preview.after.stageAfter].label}”.`,
                      )}{" "}
                  {t("Sigue", "Next:")} {ACTOR_LABELS[locale][preview.after.next.actor].toLowerCase()}:{" "}
                  {preview.after.next.text.charAt(0).toLowerCase() + preview.after.next.text.slice(1)}.
                </span>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function ReportImport({
  client,
  data,
  onSaved,
  onSampleSaved,
  onClose,
}: {
  client: StaffClient;
  data: StaffData;
  /** The report was saved. `message` says what happened, for the page to show. */
  onSaved: (message: string) => void | Promise<void>;
  /** A sample was saved; the page reloads its list. */
  onSampleSaved: () => void | Promise<void>;
  onClose: () => void;
}) {
  const id = useId();
  const { locale } = useStaffLocale();
  const t = useTx();
  const fileInput = useRef<HTMLInputElement>(null);
  const [readerKey, setReaderKey] = useState("credalti_json");
  const [pasted, setPasted] = useState("");
  const [file, setFile] = useState<{ name: string; size: number; text: string } | null>(null);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [reviewed, setReviewed] = useState<{ raw: RawReport; preview: ImportPreview; ai?: AiReading } | null>(null);
  // An AI reading with anything marked: the person confirms they compared it with the document.
  const [checkedAgainstDocument, setCheckedAgainstDocument] = useState(false);
  const [sampleNote, setSampleNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reader = getReportReader(readerKey) ?? REPORT_READERS[0]!;
  const source = file ? file.text : pasted;
  const hasSource = source.trim().length > 0;
  const suggestion = useMemo(() => (hasSource ? suggestReader(source) : null), [hasSource, source]);
  const otherSource = suggestion && suggestion.key !== reader.key ? suggestion : null;

  /** Anything typed or chosen makes an earlier result out of date. */
  const edited = () => {
    setProblems(null);
    setReviewed(null);
    setSampleNote(null);
    setCheckedAgainstDocument(false);
  };

  const aiRead = (reading: AiReading) => {
    setProblems(null);
    setCheckedAgainstDocument(false);
    setReviewed({ raw: reading.raw, preview: importPreview(client, reading.raw, new Date().toISOString(), locale), ai: reading });
  };
  const ai = reviewed?.ai ?? null;
  const needsCheck = ai ? flaggedItems(ai.validation).length > 0 || ai.validation.warnings.length > 0 : false;
  const flaggedSet = ai ? new Set(flaggedItems(ai.validation).map((i) => i.fingerprint)) : undefined;

  const chooseFile = async (chosen: File | undefined) => {
    if (!chosen) return;
    edited();
    const name = chosen.name.toLowerCase();
    if (!ACCEPTED_FILE_EXTENSIONS.some((extension) => name.endsWith(extension))) {
      setProblems([t(`«${chosen.name}» no es un archivo .json, .txt o .html. No se cargó.`, `“${chosen.name}” isn't a .json, .txt or .html file. It wasn't loaded.`)]);
      return;
    }
    if (chosen.size > MAX_SOURCE_BYTES) {
      setProblems([
        t(`«${chosen.name}» pesa ${formatBytes(chosen.size)}. El máximo es 5 MB. No se cargó.`, `“${chosen.name}” is ${formatBytes(chosen.size)}. The limit is 5 MB. It wasn't loaded.`),
      ]);
      return;
    }
    // Read here, in the browser: nothing leaves this computer until "Guardar".
    setFile({ name: chosen.name, size: chosen.size, text: await chosen.text() });
  };

  const tooLarge = () => {
    const bytes = file ? file.size : new Blob([pasted]).size;
    if (bytes <= MAX_SOURCE_BYTES) return false;
    setProblems([t(`El texto pesa ${formatBytes(bytes)}. El máximo es 5 MB. No se guardó nada.`, `The text is ${formatBytes(bytes)}. The limit is 5 MB. Nothing was saved.`)]);
    return true;
  };

  const review = () => {
    edited();
    if (tooLarge()) return;
    try {
      const raw = reader.read(source);
      setReviewed({ raw, preview: importPreview(client, raw, new Date().toISOString(), locale) });
    } catch (error) {
      setProblems(
        error instanceof ReportReadError
          ? error.problems
          : [t("No se pudo leer este texto. Revisa que sea el reporte completo y vuelve a intentar.", "This text couldn't be read. Check that it's the whole report and try again.")],
      );
    }
  };

  const save = async () => {
    if (!reviewed || reviewed.preview.blocked || busy) return;
    if (needsCheck && !checkedAgainstDocument) return;
    setBusy(true);
    try {
      // An AI reading travels as its envelope: the server reads (validates) it again before saving.
      await data.saveReport(client.id, reviewed.ai
        ? { readerKey: "ai_document", report: reviewed.raw, by: staffAuthor(), source: reviewed.ai.source }
        : { readerKey: reader.key, report: reviewed.raw, by: staffAuthor(), source });
      const p = reviewed.preview;
      const STAGES = STAGE_TEXT[locale];
      await onSaved(
        t(
          `Reporte del ${longDay(p.reportDate, "es")} guardado: ${count(p.total, "punto", "puntos")}.${
            p.after && p.after.stageBefore !== p.after.stageAfter ? ` Ahora está en «${STAGES[p.after.stageAfter].label}».` : ""
          }`,
          `Report from ${longDay(p.reportDate, "en")} saved: ${count(p.total, "item", "items")}.${
            p.after && p.after.stageBefore !== p.after.stageAfter ? ` They're now at “${STAGES[p.after.stageAfter].label}”.` : ""
          }`,
        ),
      );
    } catch (error) {
      setReviewed(null);
      setProblems([staffMessage(error instanceof Error && error.message ? error.message : "No se pudo guardar el reporte.", locale)]);
    } finally {
      setBusy(false);
    }
  };

  const saveSample = async () => {
    if (!hasSource || busy) return;
    edited();
    if (tooLarge()) return;
    setBusy(true);
    try {
      const { sample, persisted } = await data.saveReportSample(client.id, {
        provider: reader.key,
        text: source,
        fileName: file?.name ?? null,
        by: staffAuthor(),
      });
      const size = formatBytes(new Blob([sample.text]).size);
      setSampleNote(
        t(
          `Muestra de ${reader.label} guardada (${size}). No se leyó nada de ella y la etapa del cliente no cambió.${
            data.demo
              ? persisted
                ? " En la demo queda guardada solo en este navegador."
                : " No cupo en el almacenamiento de este navegador: se conserva solo mientras esta pestaña siga abierta."
              : ""
          }`,
          `${reader.label} sample saved (${size}). Nothing was read from it and the client's stage didn't change.${
            data.demo
              ? persisted
                ? " In the demo it's saved only in this browser."
                : " It didn't fit in this browser's storage: it's kept only while this tab stays open."
              : ""
          }`,
        ),
      );
      setPasted("");
      setFile(null);
      await onSampleSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card px-5 py-5 sm:px-6" data-testid="report-import">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[18px] font-semibold text-slate-900">{t("Importar reporte", "Import report")}</h3>
        <button type="button" onClick={onClose} className={QUIET_BUTTON}>
          {t("Cerrar", "Close")}
        </button>
      </div>

      {reviewed ? (
        <div className="mt-3">
          {ai && <AiReviewPanel reading={ai} demo={data.demo} />}
          <Preview preview={reviewed.preview} flagged={flaggedSet} />
          {ai && needsCheck && !reviewed.preview.blocked && (
            <label className="mt-5 flex items-start gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-[14px] leading-snug text-slate-800" data-testid="ai-confirm">
              <input
                type="checkbox"
                checked={checkedAgainstDocument}
                onChange={(e) => setCheckedAgainstDocument(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 accent-blue-700"
              />
              <span>
                {t(
                  "Comparé con el documento los puntos marcados «Revisar» y los avisos de arriba. Lo que dice «No se guarda» queda fuera.",
                  "I compared the items marked “Check” and the warnings above with the document. Anything marked “Not saved” stays out.",
                )}
              </span>
            </label>
          )}
          <div className="mt-5 flex flex-col gap-2 border-t hairline pt-4 sm:flex-row sm:items-center">
            {!reviewed.preview.blocked && (
              <button type="button" onClick={save} disabled={busy || (needsCheck && !checkedAgainstDocument)} className={PRIMARY_BUTTON}>
                {t("Guardar reporte", "Save report")}
              </button>
            )}
            <button type="button" onClick={() => setReviewed(null)} className={QUIET_BUTTON}>
              {t("Volver a editar", "Back to editing")}
            </button>
          </div>
          {!reviewed.preview.blocked && (
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              {t("Hasta que presiones «Guardar reporte» no se guarda nada.", "Nothing is saved until you press “Save report”.")}
              {data.demo && t(" En la demo se guarda solo en este navegador.", " In the demo it's saved only in this browser.")}
            </p>
          )}
        </div>
      ) : (
        <div className="mt-3">
          {reader.upload !== "ai" && (
            <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-blue-50 px-4 py-3">
              <p className="min-w-0 flex-1 basis-60 text-[14px] leading-snug text-blue-900">
                {t(
                  "¿Tienes el reporte en PDF o la página guardada del monitoreo? La IA lo lee y te marca lo que no está claro.",
                  "Have the report as a PDF or the monitoring page saved? The AI reads it and flags what isn't clear.",
                )}
              </p>
              <button
                type="button"
                data-testid="ai-upload-option"
                onClick={() => {
                  setReaderKey("ai_document");
                  edited();
                }}
                className={`${ROW_BUTTON} gap-2 bg-white`}
              >
                <Icon name="arrowUp" size={15} strokeWidth={2.25} />
                {t("Subir PDF del reporte", "Upload the report PDF")}
              </button>
            </div>
          )}
          <label htmlFor={`${id}-source`} className="block text-[14px] font-medium text-slate-900">
            {t("De dónde viene", "Where it's from")}
          </label>
          <select
            id={`${id}-source`}
            value={reader.key}
            onChange={(e) => {
              setReaderKey(e.target.value);
              edited();
            }}
            className={`${FIELD} mt-1.5 h-11 max-w-sm`}
          >
            {REPORT_READERS.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
                {r.status === "needs_sample" ? t(" · sin lector todavía", " · no reader yet") : ""}
              </option>
            ))}
          </select>

          {reader.upload === "ai" ? (
            <AiReportUpload clientId={client.id} onRead={aiRead} />
          ) : (
          <>
          {reader.status === "ready" ? (
            <p className="mt-2 text-[13px] leading-snug text-slate-500">
              {t("Es el formato propio de Credalti.", "It's Credalti's own format.")}{" "}
              <button
                type="button"
                onClick={() => download(TEMPLATE_FILE_NAME, templateJson(new Date()))}
                className="font-medium text-blue-700 underline-offset-2 hover:underline"
              >
                {t("Descargar plantilla", "Download template")}
              </button>{" "}
              {t("(un ejemplo lleno, con datos inventados y fecha de hoy).", "(a filled-in example, with made-up data and today's date).")}
              {data.demo && client.report && (
                <>
                  {" "}
                  {t("Demo:", "Demo:")}{" "}
                  <button
                    type="button"
                    onClick={() =>
                      download(`reporte-${client.id}.json`, `${JSON.stringify(toRawReport(client.report!), null, 2)}\n`)
                    }
                    className="font-medium text-blue-700 underline-offset-2 hover:underline"
                  >
                    {t("descargar el reporte en archivo de este cliente", "download this client's report on file")}
                  </button>{" "}
                  {t("para editarlo y probar una re-importación.", "to edit it and try a re-import.")}
                </>
              )}
            </p>
          ) : (
            <div className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-[14px] leading-snug text-blue-900" role="note" data-testid="needs-sample">
              <p className="font-semibold">{t(`Todavía no podemos leer reportes de ${reader.label}.`, `We can't read ${reader.label} reports yet.`)}</p>
              <p className="mt-1">
                {t(
                  `Su formato no es público y no lo vamos a adivinar: un lector hecho a ojo pondría puntos equivocados en las cartas sin dar ningún error. Para construirlo hace falta un reporte real de ${reader.label} como muestra.`,
                  `Its format isn't public and we won't guess it: a reader built by eye would put wrong items in the letters without any error. Building one takes a real ${reader.label} report as a sample.`,
                )}
              </p>
              <p className="mt-1">
                {t(
                  "Puedes guardar este reporte como muestra en el expediente del cliente. No se lee nada de él y la etapa del cliente no cambia hasta que exista un lector.",
                  "You can save this report as a sample in the client's file. Nothing is read from it and the client's stage doesn't change until a reader exists.",
                )}
              </p>
            </div>
          )}

          <div className="mt-4">
            {file ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-50 px-4 py-3">
                <p className="flex min-w-0 items-center gap-2 text-[14px] text-slate-900">
                  <Icon name="doc" size={18} className="shrink-0 text-slate-500" />
                  <span className="min-w-0 break-all">{file.name}</span>
                  <span className="shrink-0 text-slate-500">· {formatBytes(file.size)}</span>
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setFile(null);
                    edited();
                  }}
                  className={QUIET_BUTTON}
                >
                  {t("Quitar", "Remove")}
                </button>
              </div>
            ) : (
              <>
                <label htmlFor={`${id}-text`} className="block text-[14px] font-medium text-slate-900">
                  {t("Pega aquí el texto del reporte", "Paste the report's text here")}
                  {reader.status === "needs_sample" ? t(" o el código fuente de su página", " or its page's source code") : ""}
                </label>
                <textarea
                  id={`${id}-text`}
                  value={pasted}
                  onChange={(e) => {
                    setPasted(e.target.value);
                    edited();
                  }}
                  rows={7}
                  spellCheck={false}
                  placeholder={reader.status === "ready" ? '{ "source": "…", "pulledAt": "…", "bureaus": { … } }' : ""}
                  className={`${FIELD} mt-1.5 resize-y py-2.5 font-mono text-[13px] leading-relaxed`}
                />
              </>
            )}
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPTED_FILE_EXTENSIONS.join(",")}
              className="sr-only"
              aria-label={t("Elegir un archivo de reporte", "Choose a report file")}
              onChange={(e) => {
                void chooseFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {!file && (
              <p className="mt-2 text-[13px] leading-snug text-slate-500">
                {t("O", "Or")}{" "}
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="font-medium text-blue-700 underline-offset-2 hover:underline"
                >
                  {t("elige un archivo", "choose a file")}
                </button>{" "}
                {t("(.json, .txt o .html, hasta 5 MB). Se lee en este navegador.", "(.json, .txt or .html, up to 5 MB). It's read in this browser.")}
              </p>
            )}
          </div>

          {otherSource && (
            <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] leading-snug text-slate-700" data-testid="source-hint">
              {otherSource.status === "ready"
                ? t(`Este texto parece estar en el formato ${otherSource.label}.`, `This text looks like it's in the ${otherSource.label} format.`)
                : t(`Este texto menciona la página de ${otherSource.label}.`, `This text mentions the ${otherSource.label} page.`)}
              <button
                type="button"
                onClick={() => {
                  setReaderKey(otherSource.key);
                  edited();
                }}
                className="font-medium text-blue-700 underline-offset-2 hover:underline"
              >
                {t(`Cambiar a ${otherSource.label}`, `Switch to ${otherSource.label}`)}
              </button>
            </p>
          )}

          {problems && (
            <div className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-[14px] leading-snug text-red-700" role="alert" data-testid="import-problems">
              <p className="font-semibold">{t("No se pudo leer el reporte. No se guardó nada.", "The report couldn't be read. Nothing was saved.")}</p>
              <ul className="mt-1 space-y-1">
                {problems.map((problem) => (
                  <li key={problem} className="break-words">
                    {problem}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {sampleNote && (
            <p className="mt-4 flex items-start gap-2.5 rounded-2xl bg-green-50 px-4 py-3 text-[14px] leading-snug text-green-700" role="status">
              <Icon name="check" size={18} className="mt-px shrink-0" />
              <span>{sampleNote}</span>
            </p>
          )}

          <div className="mt-4">
            {reader.status === "ready" ? (
              <button type="button" onClick={review} disabled={!hasSource} className={`${ROW_BUTTON} h-12 px-6 text-[16px] disabled:bg-slate-100 disabled:text-slate-400`}>
                {t("Revisar", "Review")}
              </button>
            ) : (
              <button type="button" onClick={saveSample} disabled={!hasSource || busy} className={SECONDARY_BUTTON}>
                {t("Guardar como muestra", "Save as sample")}
              </button>
            )}
          </div>
          </>
          )}
        </div>
      )}
    </div>
  );
}
