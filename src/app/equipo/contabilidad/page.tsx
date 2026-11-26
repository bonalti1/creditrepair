"use client";

import { Suspense, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { resetDemoBooks, useAccounting } from "@/lib/accounting/data";
import { isClosed } from "@/lib/accounting/expenses";
import { isMonthKey, monthLabel, monthOf, monthsEnding } from "@/lib/accounting/periods";
import { deniedReason } from "@/lib/staff/permissions";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { Chip, DemoNote, NoAccess, pillTab, QUIET_BUTTON } from "@/components/staff/ui";
import BankImport from "@/components/staff/accounting/BankImport";
import Collections from "@/components/staff/accounting/Collections";
import Commissions from "@/components/staff/accounting/Commissions";
import Dashboard from "@/components/staff/accounting/Dashboard";
import Economics from "@/components/staff/accounting/Economics";
import Expenses from "@/components/staff/accounting/Expenses";
import Ledger from "@/components/staff/accounting/Ledger";
import Reconcile from "@/components/staff/accounting/Reconcile";
import Reports from "@/components/staff/accounting/Reports";
import Taxes from "@/components/staff/accounting/Taxes";
import { CONTROL_INLINE } from "@/components/staff/accounting/bits";
import { AdSpendCheck } from "@/components/staff/ads/SpendBooks";

// The accounting department: the business in numbers, from the billing
// records and what the team enters. Owner and administrators only (the
// accounting capability; sales and specialists see "no access", and every
// route refuses them again). Cash basis, Texas time, real numbers only.

const TABS = ["dashboard", "income", "expenses", "import", "reconcile", "collections", "economics", "commissions", "reports", "taxes"] as const;
type Tab = (typeof TABS)[number];

const TAB_LABEL: Record<Tab, { en: string; es: string }> = {
  dashboard: { en: "Dashboard", es: "Resumen" },
  income: { en: "Income", es: "Ingresos" },
  expenses: { en: "Expenses", es: "Gastos" },
  import: { en: "Bank import", es: "Importar banco" },
  reconcile: { en: "Reconciliation", es: "Conciliación" },
  collections: { en: "Collections", es: "Cobranza" },
  economics: { en: "Unit economics", es: "Economía por cliente" },
  commissions: { en: "Commissions", es: "Comisiones" },
  reports: { en: "Reports", es: "Informes" },
  taxes: { en: "Taxes", es: "Impuestos" },
};

function Accounting() {
  const t = useTx();
  const { locale } = useStaffLocale();
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const acc = useAccounting();
  const [reveal, setReveal] = useState(false);
  const rawTab = params.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(rawTab ?? "") ? (rawTab as Tab) : "dashboard";
  const current = monthOf(new Date());
  const rawMonth = params.get("mes");
  const month = isMonthKey(rawMonth) && rawMonth <= current ? rawMonth : current;
  const go = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) next.set(k, v);
    router.replace(`${path}?${next.toString()}`, { scroll: false });
  };

  if (!acc.staff.ready) return null;
  if (!acc.allowed) return <NoAccess title={t("Contabilidad", "Accounting")} reason={deniedReason("accounting", locale)} />;
  if (!acc.ready) return null;

  return (
    <main className="animate-rise min-w-0" data-testid="accounting">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div className="min-w-0">
          <h1 className="page-title">{t("Contabilidad", "Accounting")}</h1>
          <p className="mt-0.5 text-[14px] text-slate-500">
            {t("Números reales de los cobros y de lo que registras. Base de caja, hora de Texas.", "Real numbers from billing and what you enter. Cash basis, Texas time.")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isClosed(month, acc.book.closes) && <Chip tone="bg-slate-100 text-slate-600">{t("Mes cerrado", "Month closed")}</Chip>}
          <select className={CONTROL_INLINE} value={month} onChange={(e) => go({ mes: e.target.value })} aria-label={t("Mes", "Month")} data-testid="month-picker">
            {monthsEnding(current, 18)
              .reverse()
              .map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m, locale)}
                </option>
              ))}
          </select>
        </div>
      </div>
      {acc.demo && (
        <DemoNote
          onReset={() => {
            resetDemoBooks();
            void acc.reload();
          }}
        >
          {t("Demo: clientes, gastos y montos inventados, guardados en este navegador.", "Demo: made-up clients, expenses and amounts, kept in this browser.")}
        </DemoNote>
      )}

      <nav className="-mx-4 mt-4 overflow-x-auto px-4 sm:mx-0 sm:px-0 print:hidden" aria-label={t("Secciones", "Sections")}>
        <div className="flex w-max gap-1.5" role="tablist">
          {TABS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => go({ tab: k })}
              className={pillTab(tab === k)}
              data-testid={`tab-${k}`}
            >
              {TAB_LABEL[k][locale]}
            </button>
          ))}
        </div>
      </nav>

      <div className="mt-5 min-w-0">
        {tab === "dashboard" && <Dashboard acc={acc} month={month} />}
        {tab === "income" && <Ledger acc={acc} month={month} reveal={reveal} setReveal={setReveal} />}
        {tab === "expenses" && (
          <>
            {/* Meta's ad spend beside "Advertising: Meta": a reconciliation suggestion, never an entry (docs/ADS.md). */}
            <AdSpendCheck month={month} expenses={acc.book.expenses} />
            <Expenses acc={acc} month={month} />
          </>
        )}
        {tab === "import" && <BankImport acc={acc} />}
        {tab === "reconcile" && <Reconcile acc={acc} reveal={reveal} />}
        {tab === "collections" && <Collections acc={acc} reveal={reveal} />}
        {tab === "economics" && <Economics acc={acc} />}
        {tab === "commissions" && <Commissions acc={acc} />}
        {tab === "reports" && <Reports acc={acc} month={month} reveal={reveal} />}
        {tab === "taxes" && <Taxes acc={acc} month={month} />}
      </div>
    </main>
  );
}

export default function ContabilidadPage() {
  return (
    <Suspense fallback={null}>
      <Accounting />
    </Suspense>
  );
}
