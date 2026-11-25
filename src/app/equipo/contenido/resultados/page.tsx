"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CHANNEL_LABEL, METRIC_LABEL, NO_DATA, THEME_LABEL } from "@/lib/content/labels";
import { attributeLeads, formatCount, pieceResults, themeResults } from "@/lib/content/results";
import { useContent } from "@/lib/content/store";
import type { ResultMetric } from "@/lib/content/types";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { SectionTitle } from "@/components/staff/ui";
import { ContentGate, ContentHeader, DemoNote, StatusChip } from "@/components/staff/content/ui";

// Results, per piece and per theme. Real numbers only: what nobody measured
// reads "No data yet", never 0. Leads are linked to a piece through its
// campaign code (the utm_content its links carry) where the leads' first
// touch kept it.

const COLUMNS: ResultMetric[] = ["views", "reach", "likes", "clicks", "leads", "signed"];

export default function ResultsPage() {
  const t = useTx();
  return (
    <ContentGate needs="content.view" title={t("Resultados", "Results")}>
      <Results />
    </ContentGate>
  );
}

function Value({ n }: { n: number | null }) {
  const { locale } = useStaffLocale();
  return n === null ? <span className="text-[12.5px] text-slate-400">{NO_DATA[locale]}</span> : <span className="font-semibold text-slate-900">{formatCount(n, locale)}</span>;
}

function Results() {
  const t = useTx();
  const { locale } = useStaffLocale();
  const content = useContent();
  const [onlyPosted, setOnlyPosted] = useState(true);
  const attribution = useMemo(() => attributeLeads(content.pieces, content.leads), [content.pieces, content.leads]);
  const rows = useMemo(() => content.pieces.filter((p) => p.status !== "archived").map((p) => pieceResults(p, content.results, attribution)), [content.pieces, content.results, attribution]);
  const shown = rows.filter((r) => !onlyPosted || r.piece.posts.length > 0 || ["posted", "measured"].includes(r.piece.status));
  const themes = themeResults(rows).filter((th) => th.posted > 0 || th.withData > 0);

  if (!content.ready) return <div className="h-40" aria-busy="true" />;
  return (
    <main className="animate-rise">
      <ContentHeader
        title={t("Resultados", "Results")}
        lead={t("Solo números reales: lo que nadie midió dice «Sin datos todavía», nunca cero. Los prospectos se ligan a una pieza por el código de sus enlaces.", "Real numbers only: what nobody measured reads \"No data yet\", never zero. Leads are linked to a piece through the code its links carry.")}
      />
      <DemoNote live={content.live} />

      <section className="mt-6" aria-labelledby="by-theme">
        <SectionTitle>
          <span id="by-theme">{t("Por tema", "By theme")}</span>
        </SectionTitle>
        {themes.length === 0 ? (
          <p className="card px-5 py-4 text-[14px] text-slate-500">{NO_DATA[locale]}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="theme-results">
            {themes.map((th) => (
              <li key={th.theme} className="card px-4 py-4">
                <h3 className="text-[15px] font-semibold text-slate-900">{THEME_LABEL[locale][th.theme]}</h3>
                <p className="text-[12.5px] text-slate-500">{t(`${th.posted} publicadas · ${th.withData} con datos`, `${th.posted} posted · ${th.withData} with data`)}</p>
                <dl className="mt-2 space-y-1 text-[13.5px] tabular-nums">
                  {(["views", "clicks", "leads", "signed"] as const).map((m) => (
                    <div key={m} className="flex items-baseline justify-between gap-2">
                      <dt className="text-slate-500">{METRIC_LABEL[locale][m]}</dt>
                      <dd>
                        <Value n={th.totals[m]} />
                      </dd>
                    </div>
                  ))}
                </dl>
                {th.attributedLeads !== null ? (
                  <p className="mt-2 text-[12.5px] text-blue-700">{t(`Por enlaces: ${th.attributedLeads} prospectos, ${th.attributedClients} clientes`, `Through links: ${th.attributedLeads} leads, ${th.attributedClients} clients`)}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8" aria-labelledby="by-piece">
        <SectionTitle
          aside={
            <label className="inline-flex min-h-11 items-center gap-2 text-[13.5px] text-slate-600">
              <input type="checkbox" checked={onlyPosted} onChange={(e) => setOnlyPosted(e.target.checked)} className="h-4 w-4 accent-blue-700" />
              {t("Solo publicadas", "Posted only")}
            </label>
          }
        >
          <span id="by-piece">{t("Por pieza", "By piece")}</span>
        </SectionTitle>
        {shown.length === 0 ? (
          <p className="card px-5 py-4 text-[14px] text-slate-500">{t("Todavía no hay piezas publicadas.", "No posted pieces yet.")}</p>
        ) : (
          <>
            {/* Phones: one card per piece. */}
            <ul className="space-y-3 md:hidden">
              {shown.map((row) => (
                <li key={row.piece.id} className="card px-4 py-3">
                  <Link href={`/equipo/contenido/pieza/${row.piece.id}`} className="text-[15px] font-semibold text-blue-700">
                    {row.piece.title}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px] text-slate-500">
                    <StatusChip status={row.piece.status} />
                    {row.piece.posts.map((p) => CHANNEL_LABEL[locale][p.channel]).join(", ")}
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[13.5px] tabular-nums">
                    {COLUMNS.map((m) => (
                      <div key={m} className="flex items-baseline justify-between gap-2">
                        <dt className="text-slate-500">{METRIC_LABEL[locale][m]}</dt>
                        <dd>
                          <Value n={row.totals[m]} />
                        </dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>
            {/* Wider screens: a table. */}
            <div className="card hidden overflow-x-auto md:block">
              <table className="w-full text-left text-[13.5px] tabular-nums" data-testid="piece-results-table">
                <caption className="sr-only">{t("Resultados por pieza", "Results by piece")}</caption>
                <thead className="border-b hairline text-[12px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      {t("Pieza", "Piece")}
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">
                      {t("Tema", "Theme")}
                    </th>
                    {COLUMNS.map((m) => (
                      <th key={m} scope="col" className="px-3 py-2.5 text-right font-semibold">
                        {METRIC_LABEL[locale][m]}
                      </th>
                    ))}
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                      {t("Por enlaces", "Via links")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shown.map((row) => (
                    <tr key={row.piece.id}>
                      <th scope="row" className="max-w-[280px] px-4 py-2.5 font-medium">
                        <Link href={`/equipo/contenido/pieza/${row.piece.id}`} className="text-blue-700 hover:underline">
                          {row.piece.title}
                        </Link>
                        <span className="block text-[12px] font-normal text-slate-500">{row.piece.posts.map((p) => CHANNEL_LABEL[locale][p.channel]).join(", ") || "—"}</span>
                      </th>
                      <td className="px-3 py-2.5 text-slate-600">{THEME_LABEL[locale][row.piece.theme]}</td>
                      {COLUMNS.map((m) => (
                        <td key={m} className="px-3 py-2.5 text-right">
                          <Value n={row.totals[m]} />
                        </td>
                      ))}
                      <td className="px-3 py-2.5 text-right">{row.attribution ? <span className="font-semibold text-blue-900">{`${row.attribution.leads} / ${row.attribution.clients}`}</span> : <Value n={null} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <p className="mt-3 px-1 text-[12.5px] leading-relaxed text-slate-500">
          {t(
            "Las redes se pueden leer solas cuando el dueño conecte las cuentas (Publicar); hasta entonces, los números se escriben a mano en cada pieza. «Por enlaces»: prospectos / se hicieron clientes.",
            "The networks can be read automatically once the owner connects the accounts (Publishing); until then, numbers are typed in on each piece. \"Via links\": leads / became clients.",
          )}
        </p>
      </section>
    </main>
  );
}
