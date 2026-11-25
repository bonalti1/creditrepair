"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAccounting } from "@/lib/accounting/data";
import { isMonthKey, monthOf } from "@/lib/accounting/periods";
import { deniedReason } from "@/lib/staff/permissions";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { NoAccess, PRIMARY_BUTTON, QUIET_BUTTON } from "@/components/staff/ui";
import MonthlyReport from "@/components/staff/accounting/MonthlyReport";

// The monthly report on its own page, for printing or saving as a PDF.

function Report() {
  const t = useTx();
  const { locale } = useStaffLocale();
  const params = useSearchParams();
  const acc = useAccounting();
  const raw = params.get("mes");
  const month = isMonthKey(raw) ? raw : monthOf(new Date());
  if (!acc.staff.ready) return null;
  if (!acc.allowed) return <NoAccess title={t("Informe mensual", "Monthly report")} reason={deniedReason("accounting", locale)} />;
  if (!acc.ready) return null;
  return (
    <main className="mx-auto max-w-4xl" data-testid="printable-report">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href={`/equipo/contabilidad?tab=reports&mes=${month}`} className={QUIET_BUTTON}>
          ← {t("Volver a Contabilidad", "Back to Accounting")}
        </Link>
        <button type="button" className={PRIMARY_BUTTON} onClick={() => window.print()}>
          {t("Imprimir o guardar PDF", "Print or save as PDF")}
        </button>
      </div>
      <MonthlyReport acc={acc} month={month} />
    </main>
  );
}

export default function InformePage() {
  return (
    <Suspense fallback={null}>
      <Report />
    </Suspense>
  );
}
