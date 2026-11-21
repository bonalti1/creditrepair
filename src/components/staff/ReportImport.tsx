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
import { ACTOR_LABEL, STAGES } from "@/lib/staff/stage";
import type { StaffClient } from "@/lib/staff/types";
import { staffAuthor } from "@/lib/staff/useStaff";
import { itemLabel } from "@/lib/ux/itemDisplay";
import { Chip, PRIMARY_BUTTON, QUIET_BUTTON, ROW_BUTTON, SECONDARY_BUTTON } from "@/components/staff/ui";
import Icon from "@/components/Icon";

// Bringing a client's report in. Staff choose where it comes from, paste the
// text or pick a file, and press "Revisar": the report is read and shown
// (what it holds, what changed against the one on file, what saving would do)
// before anything is saved. Only then is there a "Guardar reporte" button.
//
// One source can be read today: the app's own JSON format. For a monitoring
// provider there is no reader yet, and this screen says so instead of
// guessing: the page can be kept as a sample, on request, and nothing else
// happens.
//
// Nothing here writes what a client said about an item.

const CATEGORY: Record<ItemCategory, [singular: string, plural: string]> = {
  tradeline: ["cuenta", "cuentas"],
  inquiry: ["consulta", "consultas"],
  public_record: ["registro público", "registros públicos"],
  personal_info: ["dato personal", "datos personales"],
};
const CATEGORY_ORDER: ItemCategory[] = ["tradeline", "inquiry", "public_record", "personal_info"];

const FIELD =
  "w-full rounded-2xl bg-slate-50 px-3.5 text-[15px] text-slate-900 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-blue-300";

function categoryLine(byCategory: Record<ItemCategory, number>): string {
  const parts = CATEGORY_ORDER.filter((c) => byCategory[c] > 0).map((c) => count(byCategory[c], ...CATEGORY[c]));
  return parts.length > 0 ? parts.join(" · ") : "sin puntos";
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

function ItemRow({ item, children }: { item: ReportItem; children?: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 py-2">
      <div className="min-w-0 flex-1 basis-56">
        <p className="break-words text-[14px] leading-snug text-slate-900">
          <span className="text-slate-500">{BUREAU_NAME[item.bureau]} · </span>
          {itemLabel(item, "es")}
        </p>
        {children}
      </div>
      {item.negative && <Chip tone="bg-slate-100 text-slate-600">Se ve negativo</Chip>}
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

function Preview({ preview }: { preview: ImportPreview }) {
  const comparison = preview.comparison;
  return (
    <div data-testid="import-preview">
      <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">Lo que trae este reporte</p>
      <p className="mt-1 text-[17px] font-medium leading-snug text-slate-900">
        Reporte del {longDay(preview.reportDate)}
        <span className="font-normal text-slate-500">
          {" "}
          · {preview.ageDays === 0 ? "de hoy" : preview.ageDays === 1 ? "de ayer" : `de hace ${preview.ageDays} días`}
        </span>
      </p>
      <p className="mt-0.5 text-[14px] leading-snug text-slate-600">
        {count(preview.total, "punto", "puntos")}: {categoryLine(preview.byCategory)}.{" "}
        {count(preview.negative, "se ve negativo", "se ven negativos")}.
      </p>

      <ul className="mt-3 overflow-hidden rounded-2xl bg-slate-50">
        {preview.bureaus.map((b, index) => (
          <li
            key={b.bureau}
            className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-2.5 ${index > 0 ? "border-t hairline" : ""}`}
          >
            <p className="min-w-0 text-[14px] leading-snug text-slate-900">
              <span className="font-semibold">{BUREAU_NAME[b.bureau]}</span>
              <span className="text-slate-600"> · {categoryLine(b.byCategory)}</span>
              {b.negative > 0 && (
                <span className="text-slate-500"> · {count(b.negative, "se ve negativo", "se ven negativos")}</span>
              )}
            </p>
            <p className="shrink-0 text-[14px] tabular-nums text-slate-600">
              {b.score !== null ? (
                <>
                  Puntaje <span className="font-semibold text-slate-900">{b.score}</span>
                </>
              ) : (
                "Sin puntaje"
              )}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs leading-relaxed text-slate-500">
        «Se ve negativo» es una lectura automática del reporte (cobranzas, pagos tardíos, consultas duras). No decide
        nada: solo el cliente dice qué es inexacto.
      </p>

      {comparison && (
        <div className="mt-5" data-testid="import-changes">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">
            Qué cambia contra el reporte del {longDay(comparison.previousDate)}
          </p>
          <div className="mt-2">
            <Group title="Ya no aparecen" n={comparison.removed.length}>
              {comparison.removed.map(({ item, inRound }) => (
                <ItemRow key={item.fingerprint} item={item}>
                  {inRound !== null && (
                    <p className="text-[13px] leading-snug text-green-700">Se disputó en la ronda {inRound}.</p>
                  )}
                </ItemRow>
              ))}
            </Group>
            <Group title="Nuevos" n={comparison.added.length}>
              {comparison.added.map((item) => (
                <ItemRow key={item.fingerprint} item={item}>
                  <p className="text-[13px] leading-snug text-slate-500">Queda pendiente de la revisión del cliente.</p>
                </ItemRow>
              ))}
            </Group>
            <Group title="Cambiaron" n={comparison.changed.length}>
              {comparison.changed.map(({ item, differences }) => (
                <ItemRow key={item.fingerprint} item={item}>
                  {differences.map((line) => (
                    <p key={line} className="break-words text-[13px] leading-snug text-slate-600">
                      {line}
                    </p>
                  ))}
                </ItemRow>
              ))}
            </Group>
            <div className="border-t hairline pt-3 text-[14px] leading-snug text-slate-600">
              <p>Sin cambios: {count(comparison.unchanged, "punto", "puntos")}.</p>
              <p>
                De los puntos que se ven negativos,{" "}
                {comparison.removedNegative === 0
                  ? "ninguno desapareció"
                  : count(comparison.removedNegative, "ya no aparece", "ya no aparecen")}{" "}
                y {count(comparison.remainingNegative, "sigue", "siguen")} en el reporte.
              </p>
              {comparison.scores.length > 0 && (
                <p className="tabular-nums">
                  Puntajes:{" "}
                  {comparison.scores
                    .map((s) => `${BUREAU_NAME[s.bureau]} ${s.from ?? "sin puntaje"} → ${s.to ?? "sin puntaje"}`)
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
          <span className="font-semibold">Este reporte no se puede guardar.</span> {preview.blocked}
        </p>
      ) : (
        <div className="mt-5" data-testid="import-effects">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">Al guardar</p>
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
                    ? `La etapa no cambia: sigue en «${STAGES[preview.after.stageAfter].label}».`
                    : `La etapa pasa de «${STAGES[preview.after.stageBefore].label}» a «${STAGES[preview.after.stageAfter].label}».`}{" "}
                  Sigue {ACTOR_LABEL[preview.after.next.actor].toLowerCase()}:{" "}
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
  const fileInput = useRef<HTMLInputElement>(null);
  const [readerKey, setReaderKey] = useState("credalti_json");
  const [pasted, setPasted] = useState("");
  const [file, setFile] = useState<{ name: string; size: number; text: string } | null>(null);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [reviewed, setReviewed] = useState<{ raw: RawReport; preview: ImportPreview } | null>(null);
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
  };

  const chooseFile = async (chosen: File | undefined) => {
    if (!chosen) return;
    edited();
    const name = chosen.name.toLowerCase();
    if (!ACCEPTED_FILE_EXTENSIONS.some((extension) => name.endsWith(extension))) {
      setProblems([`«${chosen.name}» no es un archivo .json, .txt o .html. No se cargó.`]);
      return;
    }
    if (chosen.size > MAX_SOURCE_BYTES) {
      setProblems([`«${chosen.name}» pesa ${formatBytes(chosen.size)}. El máximo es 5 MB. No se cargó.`]);
      return;
    }
    // Read here, in the browser: nothing leaves this computer until "Guardar".
    setFile({ name: chosen.name, size: chosen.size, text: await chosen.text() });
  };

  const tooLarge = () => {
    const bytes = file ? file.size : new Blob([pasted]).size;
    if (bytes <= MAX_SOURCE_BYTES) return false;
    setProblems([`El texto pesa ${formatBytes(bytes)}. El máximo es 5 MB. No se guardó nada.`]);
    return true;
  };

  const review = () => {
    edited();
    if (tooLarge()) return;
    try {
      const raw = reader.read(source);
      setReviewed({ raw, preview: importPreview(client, raw, new Date().toISOString()) });
    } catch (error) {
      setProblems(
        error instanceof ReportReadError
          ? error.problems
          : ["No se pudo leer este texto. Revisa que sea el reporte completo y vuelve a intentar."],
      );
    }
  };

  const save = async () => {
    if (!reviewed || reviewed.preview.blocked || busy) return;
    setBusy(true);
    try {
      await data.saveReport(client.id, { readerKey: reader.key, report: reviewed.raw, by: staffAuthor(), source });
      const p = reviewed.preview;
      await onSaved(
        `Reporte del ${longDay(p.reportDate)} guardado: ${count(p.total, "punto", "puntos")}.${
          p.after && p.after.stageBefore !== p.after.stageAfter ? ` Ahora está en «${STAGES[p.after.stageAfter].label}».` : ""
        }`,
      );
    } catch (error) {
      setReviewed(null);
      setProblems([error instanceof Error && error.message ? error.message : "No se pudo guardar el reporte."]);
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
        `Muestra de ${reader.label} guardada (${size}). No se leyó nada de ella y la etapa del cliente no cambió.${
          data.demo
            ? persisted
              ? " En la demo queda guardada solo en este navegador."
              : " No cupo en el almacenamiento de este navegador: se conserva solo mientras esta pestaña siga abierta."
            : ""
        }`,
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
        <h3 className="text-[18px] font-semibold text-slate-900">Importar reporte</h3>
        <button type="button" onClick={onClose} className={QUIET_BUTTON}>
          Cerrar
        </button>
      </div>

      {reviewed ? (
        <div className="mt-3">
          <Preview preview={reviewed.preview} />
          <div className="mt-5 flex flex-col gap-2 border-t hairline pt-4 sm:flex-row sm:items-center">
            {!reviewed.preview.blocked && (
              <button type="button" onClick={save} disabled={busy} className={PRIMARY_BUTTON}>
                Guardar reporte
              </button>
            )}
            <button type="button" onClick={() => setReviewed(null)} className={QUIET_BUTTON}>
              Volver a editar
            </button>
          </div>
          {!reviewed.preview.blocked && (
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              Hasta que presiones «Guardar reporte» no se guarda nada.
              {data.demo && " En la demo se guarda solo en este navegador."}
            </p>
          )}
        </div>
      ) : (
        <div className="mt-3">
          <label htmlFor={`${id}-source`} className="block text-[14px] font-medium text-slate-900">
            De dónde viene
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
                {r.status === "needs_sample" ? " · sin lector todavía" : ""}
              </option>
            ))}
          </select>

          {reader.status === "ready" ? (
            <p className="mt-2 text-[13px] leading-snug text-slate-500">
              Es el formato propio de Credalti.{" "}
              <button
                type="button"
                onClick={() => download(TEMPLATE_FILE_NAME, templateJson(new Date()))}
                className="font-medium text-blue-700 underline-offset-2 hover:underline"
              >
                Descargar plantilla
              </button>{" "}
              (un ejemplo lleno, con datos inventados y fecha de hoy).
              {data.demo && client.report && (
                <>
                  {" "}
                  Demo:{" "}
                  <button
                    type="button"
                    onClick={() =>
                      download(`reporte-${client.id}.json`, `${JSON.stringify(toRawReport(client.report!), null, 2)}\n`)
                    }
                    className="font-medium text-blue-700 underline-offset-2 hover:underline"
                  >
                    descargar el reporte en archivo de este cliente
                  </button>{" "}
                  para editarlo y probar una re-importación.
                </>
              )}
            </p>
          ) : (
            <div className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-[14px] leading-snug text-blue-900" role="note" data-testid="needs-sample">
              <p className="font-semibold">Todavía no podemos leer reportes de {reader.label}.</p>
              <p className="mt-1">
                Su formato no es público y no lo vamos a adivinar: un lector hecho a ojo pondría puntos equivocados en
                las cartas sin dar ningún error. Para construirlo hace falta un reporte real de {reader.label} como
                muestra.
              </p>
              <p className="mt-1">
                Puedes guardar este reporte como muestra en el expediente del cliente. No se lee nada de él y la etapa
                del cliente no cambia hasta que exista un lector.
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
                  Quitar
                </button>
              </div>
            ) : (
              <>
                <label htmlFor={`${id}-text`} className="block text-[14px] font-medium text-slate-900">
                  Pega aquí el texto del reporte
                  {reader.status === "needs_sample" ? " o el código fuente de su página" : ""}
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
              aria-label="Elegir un archivo de reporte"
              onChange={(e) => {
                void chooseFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {!file && (
              <p className="mt-2 text-[13px] leading-snug text-slate-500">
                O{" "}
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="font-medium text-blue-700 underline-offset-2 hover:underline"
                >
                  elige un archivo
                </button>{" "}
                (.json, .txt o .html, hasta 5 MB). Se lee en este navegador.
              </p>
            )}
          </div>

          {otherSource && (
            <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] leading-snug text-slate-700" data-testid="source-hint">
              {otherSource.status === "ready"
                ? `Este texto parece estar en el formato ${otherSource.label}.`
                : `Este texto menciona la página de ${otherSource.label}.`}
              <button
                type="button"
                onClick={() => {
                  setReaderKey(otherSource.key);
                  edited();
                }}
                className="font-medium text-blue-700 underline-offset-2 hover:underline"
              >
                Cambiar a {otherSource.label}
              </button>
            </p>
          )}

          {problems && (
            <div className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-[14px] leading-snug text-red-700" role="alert" data-testid="import-problems">
              <p className="font-semibold">No se pudo leer el reporte. No se guardó nada.</p>
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
                Revisar
              </button>
            ) : (
              <button type="button" onClick={saveSample} disabled={!hasSource || busy} className={SECONDARY_BUTTON}>
                Guardar como muestra
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
