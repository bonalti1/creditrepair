"use client";

import Link from "next/link";
import type { DepartmentTile } from "@/lib/control/departments";
import { useTx } from "@/lib/staff/i18n/StaffLocale";
import Icon from "@/components/Icon";

// The departments strip on top of the Overview (src/lib/control/departments.ts):
// one tile per department the member may open. On a phone, one row that
// slides sideways (the next tile peeks in, so it reads as more); from 768 px,
// one row, or two rows of five when there are more than seven (an
// administrator's ten). The phone row is paint-contained: without it a
// phone browser sized the whole page to the row's full width (zoomed out).
// A number on a tile's icon is what
// needs the member there; no number means the Overview has nothing to say
// about it. The number sits on the icon so the name keeps the whole width
// ("Contabilidad" at 1280 px with six tiles).

export default function DepartmentStrip({ tiles }: { tiles: DepartmentTile[] }) {
  const t = useTx();
  if (tiles.length === 0) return null;
  return (
    <nav aria-label={t("Departamentos", "Departments")} className="-mx-4 mt-3 overflow-x-auto px-4 pb-1 pt-2 [contain:paint] [scrollbar-width:none] md:mx-0 md:[contain:none] md:mt-5 md:overflow-visible md:px-0 md:pb-0 md:pt-0" data-testid="departments">
      <ul className={`flex w-max gap-2 md:grid md:w-auto ${tiles.length > 7 ? "md:grid-cols-5" : "md:auto-cols-fr md:grid-flow-col md:grid-cols-none"}`}>
        {tiles.map((tile) => {
          const count = tile.count !== null && tile.count > 0 ? tile.count : null;
          return (
            <li key={tile.key} className="w-[112px] shrink-0 md:w-auto md:min-w-0">
              <Link
                href={tile.href}
                className="pressable card flex h-full min-h-[76px] flex-col items-start justify-center gap-1.5 px-3 py-2.5 hover:shadow-[0_0_0_1px_var(--color-amber-500)] md:min-h-14 md:flex-row md:items-center md:justify-start md:gap-2.5 md:px-3 md:py-2.5"
                data-testid={`department-${tile.key}`}
              >
                <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-blue-50 text-blue-700">
                  <Icon name={tile.icon} size={17} />
                  {count !== null && (
                    <span className="absolute -right-2 -top-2 min-w-5 rounded-full bg-red-600 px-1.5 text-center text-[11.5px] font-semibold leading-5 text-white tabular-nums ring-2 ring-white" aria-hidden="true">
                      {count}
                    </span>
                  )}
                </span>
                <span className="min-w-0 max-w-full truncate text-[14px] font-semibold text-slate-900">{tile.label}</span>
                {count !== null && <span className="sr-only">{t(`: ${count} te necesitan`, `: ${count} need you`)}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
