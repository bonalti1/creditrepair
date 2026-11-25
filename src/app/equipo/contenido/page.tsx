"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { STATUS_HINT, STATUS_LABEL } from "@/lib/content/labels";
import { boardColumns, filterPieces, type ContentFilters } from "@/lib/content/rules";
import { useContent } from "@/lib/content/store";
import { BOARD_COLUMNS, type ContentStatus } from "@/lib/content/types";
import { can } from "@/lib/staff/permissions";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import Icon from "@/components/Icon";
import { PRIMARY_BUTTON_COMPACT } from "@/components/staff/ui";
import { Filters } from "@/components/staff/content/Filters";
import { ContentHeader, DemoNote, PieceCard } from "@/components/staff/content/ui";

// The content board (docs/CONTENT.md): one column per status, from Idea to
// Measured, with "Changes requested" beside review. On a phone the columns
// become a row of status chips and one list. Sales, who may see only the
// approved partner material, is taken to it.

export default function ContentBoardPage() {
  const t = useTx();
  const { locale } = useStaffLocale();
  const router = useRouter();
  const content = useContent();
  const [filters, setFilters] = useState<ContentFilters>({});
  const [phoneColumn, setPhoneColumn] = useState<ContentStatus>("review");
  const [showFolded, setShowFolded] = useState(false);

  useEffect(() => {
    if (content.ready && content.viewer && !can(content.role, "content.view")) router.replace("/equipo/contenido/socios");
  }, [content.ready, content.viewer, content.role, router]);

  // Keep the chosen column's chip in view in the row of chips (phones).
  useEffect(() => {
    const chip = document.getElementById(`chip-${phoneColumn}`);
    const row = chip?.parentElement?.parentElement;
    if (!chip || !row) return;
    const a = chip.getBoundingClientRect();
    const b = row.getBoundingClientRect();
    row.scrollLeft += a.left - b.left - (b.width - a.width) / 2;
  }, [phoneColumn, content.ready]);

  const shown = useMemo(() => filterPieces(content.pieces, filters), [content.pieces, filters]);
  const columns = useMemo(() => boardColumns(shown), [shown]);
  const folded = [...(columns.failed ?? []), ...(columns.archived ?? [])];
  const mayCreate = can(content.role, "content.edit");

  if (!content.ready || !can(content.role, "content.view")) return <div className="h-40" aria-busy="true" />;

  return (
    <main className="animate-rise">
      <ContentHeader
        title={t("Contenido", "Content")}
        lead={t(
          "Del primer borrador a los resultados. Todo se crea en CapCut, Canva o el proceso de anuncios; aquí se planea, se revisa, se aprueba y se mide.",
          "From the first idea to the results. Pieces are made in CapCut, Canva or the ad pipeline; here they are planned, checked, approved and measured.",
        )}
        aside={
          mayCreate ? (
            <Link href="/equipo/contenido/nueva" className={`${PRIMARY_BUTTON_COMPACT} gap-1.5 px-5`} data-testid="new-piece">
              <Icon name="plus" size={18} />
              {t("Nueva pieza", "New piece")}
            </Link>
          ) : null
        }
      />
      <DemoNote live={content.live} />
      <Filters value={filters} onChange={setFilters} pieces={content.pieces} />

      {/* Phone: one column at a time, picked from a row of chips. */}
      <div className="mt-4 md:hidden">
        <div className="-mx-4 overflow-x-auto px-4" role="tablist" aria-label={t("Columnas", "Columns")}>
          <div className="flex min-w-max gap-1.5">
            {BOARD_COLUMNS.map((status) => (
              <button
                key={status}
                id={`chip-${status}`}
                type="button"
                role="tab"
                aria-selected={phoneColumn === status}
                onClick={() => setPhoneColumn(status)}
                className={`inline-flex h-11 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-medium ${phoneColumn === status ? "bg-blue-700 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}
              >
                {STATUS_LABEL[locale][status]}
                <span className="tabular-nums opacity-80">{columns[status]?.length ?? 0}</span>
              </button>
            ))}
          </div>
        </div>
        <p className="mt-3 px-1 text-[13px] text-slate-500">{STATUS_HINT[locale][phoneColumn]}</p>
        <ul className="mt-2 space-y-2" role="tabpanel">
          {(columns[phoneColumn] ?? []).map((piece) => (
            <li key={piece.id}>
              <PieceCard piece={piece} />
            </li>
          ))}
          {(columns[phoneColumn] ?? []).length === 0 ? <li className="card px-4 py-5 text-[14px] text-slate-500">{t("Nada aquí.", "Nothing here.")}</li> : null}
        </ul>
      </div>

      {/* Wider screens: the columns side by side, scrolling sideways inside the board only. */}
      <div className="mt-5 hidden overflow-x-auto pb-3 md:block" data-testid="board">
        <div className="flex min-w-max gap-3">
          {BOARD_COLUMNS.map((status) => {
            const list = columns[status] ?? [];
            return (
              <section key={status} aria-labelledby={`col-${status}`} className="w-[248px] shrink-0 rounded-3xl bg-slate-100/70 p-2.5">
                <div className="flex items-baseline justify-between px-1.5 pb-1">
                  <h2 id={`col-${status}`} className="text-[13px] font-semibold uppercase tracking-wide text-slate-600">
                    {STATUS_LABEL[locale][status]}
                  </h2>
                  <span className="text-[13px] tabular-nums text-slate-500">{list.length}</span>
                </div>
                <p className="px-1.5 pb-2 text-[12px] leading-snug text-slate-500">{STATUS_HINT[locale][status]}</p>
                <ul className="space-y-2">
                  {list.map((piece) => (
                    <li key={piece.id}>
                      <PieceCard piece={piece} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </div>

      {folded.length > 0 ? (
        <section className="mt-6" aria-labelledby="folded">
          <button type="button" id="folded" aria-expanded={showFolded} onClick={() => setShowFolded((v) => !v)} className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-[14px] font-medium text-slate-600 hover:bg-slate-100">
            <Icon name="chevron" size={16} className={showFolded ? "rotate-90" : ""} />
            {t(`Fallidas y archivadas (${folded.length})`, `Failed and archived (${folded.length})`)}
          </button>
          {showFolded ? (
            <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {folded.map((piece) => (
                <li key={piece.id}>
                  <PieceCard piece={piece} />
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
