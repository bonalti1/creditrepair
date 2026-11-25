"use client";

import { Suspense, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { DECISION_LINE } from "@/lib/letters/packet";
import { pendingCoverNote, pendingPacketEntries, PENDING_COVER_TITLE } from "@/lib/letters/versions/packet";
import { useLetterVersions } from "@/lib/letters/versions/useLetterVersions";
import { deniedReason } from "@/lib/staff/permissions";
import { useStaff } from "@/lib/staff/useStaff";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import Icon from "@/components/Icon";
import { DiffView, LetterPaper } from "@/components/staff/letters/LetterParts";
import { NoAccess, PRIMARY_BUTTON } from "@/components/staff/ui";

// The attorney's packet: the letter versions waiting on the attorney, each
// with its details, its changes against the text in use, and the full letter
// for a fictional consumer. In English, for the attorney. Printed from the
// browser ("Imprimir o guardar PDF"), so it is a PDF without a PDF library.
// Only the toolbar above it speaks the member's language.
//
//   /equipo/cartas/paquete              every version with the attorney
//   /equipo/cartas/paquete?ids=a,b      only those versions

function Packet() {
  const params = useSearchParams();
  const { ready, can } = useStaff();
  const t = useTx();
  const { locale } = useStaffLocale();
  const { demo, ready: loaded, versions } = useLetterVersions();
  const idsParam = params.get("ids");
  const ids = useMemo(() => (idsParam ? idsParam.split(",").filter(Boolean) : undefined), [idsParam]);
  const entries = useMemo(() => pendingPacketEntries(versions, ids), [versions, ids]);

  if (!ready) return null;
  if (!can("letters.edit")) return <NoAccess title={t("Paquete para el abogado", "Attorney's packet")} reason={deniedReason("letters.edit", locale)} />;
  if (!loaded) return null;

  return (
    <main className="animate-rise print:animate-none">
      <div className="print:hidden">
        <Link href="/equipo/cartas" className="inline-flex items-center gap-1 text-[14px] font-medium text-blue-700">
          <Icon name="chevron" size={14} className="rotate-180" /> {t("Cartas", "Letters")}
        </Link>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="page-title">{t("Paquete para el abogado", "Attorney's packet")}</h1>
            <p className="mt-1 max-w-2xl text-[15px] leading-relaxed text-slate-500">
              {entries.length === 0
                ? t("No hay versiones esperando al abogado.", "No versions are waiting on the attorney.")
                : t(
                    `${entries.length} ${entries.length === 1 ? "versión" : "versiones"} con el abogado. El paquete va en inglés. Imprímelo o guárdalo como PDF y envíaselo; cuando responda, registra su decisión en cada carta.`,
                    `${entries.length} ${entries.length === 1 ? "version" : "versions"} with the attorney. The packet is in English. Print it or save it as a PDF and send it; when they answer, record their decision on each letter.`,
                  )}
            </p>
          </div>
          {entries.length > 0 && (
            <button type="button" className={PRIMARY_BUTTON} onClick={() => window.print()} data-testid="print-packet">
              {t("Imprimir o guardar PDF", "Print or save as PDF")}
            </button>
          )}
        </div>
        {demo && (
          <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[14px] leading-snug text-blue-900">
            <strong>Demo:</strong>{" "}
            {t(
              "este paquete se arma con lo guardado en este navegador. No se envió nada a ningún abogado.",
              "this packet is built from what's saved in this browser. Nothing was sent to any attorney.",
            )}
          </p>
        )}
      </div>

      {entries.length > 0 && (
        <article className="mt-6 rounded-2xl border border-slate-200 bg-white px-5 py-6 sm:px-10 sm:py-10 print:mt-0 print:rounded-none print:border-0 print:p-0" lang="en" data-testid="attorney-packet">
          <header>
            <h2 className="text-[24px] font-semibold leading-tight tracking-tight text-slate-900">{PENDING_COVER_TITLE}</h2>
            <p className="mt-1 text-[14px] text-slate-500">Prepared {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Chicago" })} · {entries.length} letter text{entries.length === 1 ? "" : "s"}</p>
            <div className="mt-4 space-y-3 text-[15px] leading-relaxed text-slate-700">
              {pendingCoverNote(entries).map((paragraph) => (
                <p key={paragraph.slice(0, 40)}>{paragraph}</p>
              ))}
            </div>
            <ol className="mt-4 list-decimal space-y-0.5 pl-6 text-[15px] text-slate-800">
              {entries.map((entry) => (
                <li key={entry.version.id}>
                  {entry.meta.title.en} — version {entry.version.version}
                  {entry.version.origin === "builtin" ? " (as in the software today)" : ` (changes version ${entry.previous.version})`}
                </li>
              ))}
            </ol>
          </header>

          {entries.map((entry) => (
            <section key={entry.version.id} className="mt-10 border-t border-slate-200 pt-8 print:break-before-page print:border-0 print:pt-0" data-testid="packet-entry">
              <h3 className="text-[20px] font-semibold leading-snug text-slate-900">
                {entry.number}. {entry.meta.title.en} — version {entry.version.version}
              </h3>
              <dl className="mt-3 grid gap-x-4 gap-y-1 text-[14px] leading-snug text-slate-700 sm:grid-cols-[11rem_1fr]">
                <dt className="font-semibold text-slate-900">Key</dt>
                <dd className="font-mono text-[13px]">{entry.meta.key}</dd>
                <dt className="font-semibold text-slate-900">Replaces</dt>
                <dd>
                  Version {entry.previous.version},{" "}
                  {entry.previous.approved ? `approved by ${entry.previous.approvedBy} on ${entry.previous.approvedAt}` : "not yet approved"}
                </dd>
                <dt className="font-semibold text-slate-900">Fingerprint</dt>
                <dd className="break-all font-mono text-[12px]">{entry.version.contentHash}</dd>
                <dt className="font-semibold text-slate-900">Sent to</dt>
                <dd>{entry.recipientLabel}</dd>
                <dt className="font-semibold text-slate-900">When it is used</dt>
                <dd>{entry.meta.useWhen.en}</dd>
                <dt className="font-semibold text-slate-900">Statutes</dt>
                <dd>{entry.meta.statutes.length > 0 ? entry.meta.statutes.join("; ") : "None cited (a request, not a statutory dispute)"}</dd>
              </dl>
              <p className="mt-3 text-[14px] font-semibold text-slate-900">Facts the client must have provided</p>
              <ul className="mt-1 list-disc pl-6 text-[14px] leading-snug text-slate-700">
                {entry.meta.requiresFacts.map((fact) => (
                  <li key={fact}>{fact}</li>
                ))}
              </ul>
              {entry.meta.attorneyAttention && (
                <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[14px] leading-snug text-blue-900">
                  <strong>Attorney attention:</strong> {entry.meta.attorneyAttention}
                </p>
              )}

              {entry.changes ? (
                <div className="mt-5" data-testid="packet-diff">
                  <p className="text-[14px] font-semibold text-slate-900">
                    Changes from version {entry.previous.version}{" "}
                    <span className="font-normal text-slate-500">
                      (<ins className="bg-green-100 text-green-900">added</ins>, <del className="bg-red-50 text-red-700">removed</del>)
                    </span>
                  </p>
                  <div className="mt-2 rounded-xl border border-slate-200 px-4 py-3">
                    <p className="font-serif text-[15px]">
                      Re: <DiffView parts={entry.changes.subject} chips={false} inline />
                    </p>
                    <div className="mt-3">
                      <DiffView parts={entry.changes.body} chips={false} />
                    </div>
                  </div>
                </div>
              ) : (
                <p className="mt-5 text-[14px] text-slate-600">This is the letter as the software has it today (version 1), sent for your approval unchanged.</p>
              )}

              <p className="mt-5 text-[14px] font-semibold text-slate-900">The letter as it would be mailed (sample data)</p>
              <div className="mt-2">
                <LetterPaper text={entry.letter} />
              </div>
              <p className="mt-4 rounded-xl border border-slate-300 px-4 py-3 text-[15px] font-semibold text-slate-900">{DECISION_LINE}</p>
            </section>
          ))}
        </article>
      )}
    </main>
  );
}

export default function PaquetePage() {
  return (
    <Suspense fallback={null}>
      <Packet />
    </Suspense>
  );
}
