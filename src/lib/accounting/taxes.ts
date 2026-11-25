import { bpsOf } from "./money";
import type { Bilingual } from "./types";

// Taxes: an ESTIMATE to set aside, and the usual deadlines. Every screen
// that shows these says "estimate; confirm with your CPA". Nothing here is
// tax advice: the percentage is the owner's choice, the dates are the common
// federal and Texas ones, moved to the next weekday when they fall on a
// weekend (holidays are not counted).

export const TAX_DISCLAIMER: Bilingual = {
  en: "Estimate; confirm with your CPA. This is not tax advice.",
  es: "Estimado; confírmalo con tu contador (CPA). Esto no es asesoría fiscal.",
};

/** What to put aside: the owner's percentage of the profit so far this year, never below zero. */
export function taxSetAside(profitYearToDateCents: number, bps: number): number {
  return profitYearToDateCents <= 0 ? 0 : bpsOf(profitYearToDateCents, Math.max(0, Math.min(10_000, Math.round(bps))));
}

export type DeadlineScope = "everyone" | "payroll" | "partners" | "entity";

export interface TaxDeadline {
  /** "2027-01-15" (already moved off a weekend). */
  due: string;
  title: Bilingual;
  detail: Bilingual;
  scope: DeadlineScope;
}

function weekday(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const dow = d.getUTCDay();
  const shift = dow === 6 ? 2 : dow === 0 ? 1 : 0;
  return new Date(d.getTime() + shift * 86_400_000).toISOString().slice(0, 10);
}

function deadlinesOfYear(y: number): TaxDeadline[] {
  const at = (m: number, d: number) => weekday(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  return [
    { due: at(1, 15), scope: "everyone", title: { en: `Federal estimated tax, 4th payment for ${y - 1}`, es: `Impuesto federal estimado, 4.º pago de ${y - 1}` }, detail: { en: "IRS Form 1040-ES (owners of a pass-through business) or the corporation's estimate.", es: "Formulario 1040-ES del IRS (dueños de un negocio que tributa a través de ellos) o el estimado de la corporación." } },
    { due: at(1, 31), scope: "partners", title: { en: `Form 1099-NEC for ${y - 1} to partners and the IRS`, es: `Formulario 1099-NEC de ${y - 1} a socios y al IRS` }, detail: { en: "For each non-employee paid $600 or more in the year (see Commissions).", es: "Por cada persona no empleada a la que se le pagó $600 o más en el año (ver Comisiones)." } },
    { due: at(1, 31), scope: "payroll", title: { en: "W-2s, Form 940 and Q4 Form 941 (if you run payroll)", es: "W-2, Formulario 940 y 941 del 4.º trimestre (si hay nómina)" }, detail: { en: "Usually filed by the payroll service.", es: "Normalmente los presenta el servicio de nómina." } },
    { due: at(3, 15), scope: "entity", title: { en: `Federal return for ${y - 1}: S corporation or partnership`, es: `Declaración federal de ${y - 1}: corporación S o sociedad` }, detail: { en: "Forms 1120-S / 1065. Only if the company is taxed that way.", es: "Formularios 1120-S / 1065. Solo si la empresa tributa así." } },
    { due: at(4, 15), scope: "entity", title: { en: `Federal return for ${y - 1}: sole owner or C corporation`, es: `Declaración federal de ${y - 1}: dueño único o corporación C` }, detail: { en: "Schedule C with Form 1040, or Form 1120.", es: "Anexo C con el Formulario 1040, o Formulario 1120." } },
    { due: at(4, 15), scope: "everyone", title: { en: `Federal estimated tax, 1st payment for ${y}`, es: `Impuesto federal estimado, 1.er pago de ${y}` }, detail: { en: "A share of the year's expected tax.", es: "Una parte del impuesto esperado del año." } },
    { due: at(4, 30), scope: "payroll", title: { en: "Form 941, 1st quarter (if you run payroll)", es: "Formulario 941, 1.er trimestre (si hay nómina)" }, detail: { en: "Usually filed by the payroll service.", es: "Normalmente lo presenta el servicio de nómina." } },
    { due: at(5, 15), scope: "everyone", title: { en: `Texas franchise tax report ${y}`, es: `Reporte del impuesto de franquicia de Texas ${y}` }, detail: { en: "Texas Comptroller. A report (and the information report) may be due even when no tax is owed; confirm which forms apply.", es: "Contraloría de Texas. Puede tocar presentar el reporte (y el informe de información) aunque no se deba impuesto; confirma qué formularios aplican." } },
    { due: at(6, 15), scope: "everyone", title: { en: `Federal estimated tax, 2nd payment for ${y}`, es: `Impuesto federal estimado, 2.º pago de ${y}` }, detail: { en: "A share of the year's expected tax.", es: "Una parte del impuesto esperado del año." } },
    { due: at(7, 31), scope: "payroll", title: { en: "Form 941, 2nd quarter (if you run payroll)", es: "Formulario 941, 2.º trimestre (si hay nómina)" }, detail: { en: "Usually filed by the payroll service.", es: "Normalmente lo presenta el servicio de nómina." } },
    { due: at(9, 15), scope: "everyone", title: { en: `Federal estimated tax, 3rd payment for ${y}`, es: `Impuesto federal estimado, 3.er pago de ${y}` }, detail: { en: "A share of the year's expected tax.", es: "Una parte del impuesto esperado del año." } },
    { due: at(10, 31), scope: "payroll", title: { en: "Form 941, 3rd quarter (if you run payroll)", es: "Formulario 941, 3.er trimestre (si hay nómina)" }, detail: { en: "Usually filed by the payroll service.", es: "Normalmente lo presenta el servicio de nómina." } },
  ];
}

/** The deadlines from today through the next 12 months, soonest first. */
export function upcomingDeadlines(today: string): TaxDeadline[] {
  const y = Number(today.slice(0, 4));
  const until = `${y + 1}${today.slice(4)}`;
  return [...deadlinesOfYear(y), ...deadlinesOfYear(y + 1)].filter((d) => d.due >= today && d.due <= until).sort((a, b) => a.due.localeCompare(b.due));
}
