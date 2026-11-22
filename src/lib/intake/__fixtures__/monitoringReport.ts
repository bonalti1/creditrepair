import type { RawReport } from "../../domain/parser";

// FICTIONAL SAMPLE. Nobody in it exists, and no monitoring company made it.
//
// The app's demo report (src/lib/demo.ts) laid out the way 3-bureau
// monitoring reports usually are: a summary per bureau, then one table per
// account with a column per bureau, then the inquiries. It carries a fake,
// masked SSN and a fake birth date on purpose, so the tests can check that a
// saved page is redacted before anything is sent. It is NOT the layout of any
// real provider: a real sample is still needed to tune the instructions
// (docs/INTAKE.md).
//
// `npm run intake:fixtures` writes it as demo-monitoring-report.html and,
// with Playwright, demo-monitoring-report.pdf, next to this file.

const ORDER = ["transunion", "experian", "equifax"] as const;
const TITLE = { transunion: "TransUnion", experian: "Experian", equifax: "Equifax" } as const;

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const money = (n: number | undefined) => (n === undefined ? "--" : `$${n.toLocaleString("en-US")}`);
const day = (iso: string | undefined) => (iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : "--");

export function renderMonitoringReportHtml(raw: RawReport, options: { clientName?: string } = {}): string {
  const name = options.clientName ?? "ROBERTO MARTINEZ";
  const reportDay = day(raw.pulledAt.slice(0, 10));
  const sections = ORDER.map((b) => [b, raw.bureaus[b]] as const);

  const accounts = new Map<string, Partial<Record<(typeof ORDER)[number], NonNullable<RawReport["bureaus"]["equifax"]>["tradelines"][number]>>>();
  for (const [b, section] of sections) {
    for (const t of section?.tradelines ?? []) {
      const key = `${t.creditor}|${t.accountNumberMasked}`;
      accounts.set(key, { ...(accounts.get(key) ?? {}), [b]: t });
    }
  }

  const row = (label: string, cell: (b: (typeof ORDER)[number]) => string) =>
    `<tr><th>${label}</th>${ORDER.map((b) => `<td>${esc(cell(b))}</td>`).join("")}</tr>`;

  const accountTables = [...accounts.entries()]
    .map(([key, byBureau]) => {
      const creditor = key.split("|")[0]!;
      const v = (b: (typeof ORDER)[number], f: (t: NonNullable<(typeof byBureau)["equifax"]>) => string) => (byBureau[b] ? f(byBureau[b]!) : "--");
      return `
<section class="account">
  <h3>${esc(creditor.toUpperCase())}</h3>
  <table>
    <thead><tr><th></th>${ORDER.map((b) => `<th>${TITLE[b]}</th>`).join("")}</tr></thead>
    <tbody>
      ${row("Account #:", (b) => v(b, (t) => t.accountNumberMasked))}
      ${row("Account Type:", (b) => v(b, (t) => t.accountType.replace(/_/g, " ")))}
      ${row("Account Status:", (b) => v(b, (t) => t.status))}
      ${row("Payment Status:", (b) => v(b, (t) => t.paymentStatus))}
      ${row("Balance:", (b) => v(b, (t) => money(t.balance)))}
      ${row("Credit Limit:", (b) => v(b, (t) => money(t.creditLimit)))}
      ${row("Date Opened:", (b) => v(b, (t) => day(t.openedAt)))}
      ${row("Last Payment:", (b) => v(b, (t) => day(t.lastPaymentAt)))}
      ${row("Date of First Delinquency:", (b) => v(b, (t) => day(t.firstDelinquencyAt)))}
      ${row("Comments:", (b) => v(b, (t) => (t.remarks.length > 0 ? t.remarks.join("; ") : "--")))}
    </tbody>
  </table>
</section>`;
    })
    .join("\n");

  const inquiries = sections.flatMap(([b, s]) => (s?.inquiries ?? []).map((q) => ({ b, q })));
  const personal = sections.flatMap(([b, s]) => (s?.personalInfo ?? []).map((p) => ({ b, p })));

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>3-Bureau Credit Report — FICTIONAL SAMPLE</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #1f2937; margin: 32px; font-size: 12px; }
  .banner { background: #fde68a; border: 2px dashed #92400e; padding: 8px 12px; font-weight: bold; text-align: center; margin-bottom: 16px; }
  header { display: flex; justify-content: space-between; border-bottom: 3px solid #1e3a8a; padding-bottom: 8px; }
  h1 { color: #1e3a8a; font-size: 20px; margin: 0; } h2 { color: #1e3a8a; font-size: 15px; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; margin-top: 24px; }
  h3 { background: #1e3a8a; color: white; font-size: 12px; padding: 5px 8px; margin: 16px 0 0; }
  table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #cbd5e1; padding: 4px 6px; text-align: left; }
  thead th { background: #e2e8f0; } tbody th { width: 28%; background: #f8fafc; font-weight: 600; }
  .page { page-break-before: always; } .account { page-break-inside: avoid; }
  .muted { color: #64748b; }
</style></head>
<body>
<div class="banner">FICTIONAL SAMPLE — not a real person, not a real report, not any company's layout. For software tests only.</div>
<header>
  <div><h1>SampleCredit Monitor</h1><div class="muted">3-Bureau Credit Report (fictional)</div></div>
  <div><strong>Report Date:</strong> ${reportDay}</div>
</header>

<h2>Personal Information</h2>
<table>
  <tbody>
    <tr><th>Name</th><td>${esc(name)}</td></tr>
    <tr><th>Social Security Number</th><td>XXX-XX-1234</td></tr>
    <tr><th>Date of Birth</th><td>01/15/1985</td></tr>
  </tbody>
</table>
<table style="margin-top:8px">
  <thead><tr><th>Bureau</th><th>Item</th><th>Value</th></tr></thead>
  <tbody>
    ${personal.map(({ b, p }) => `<tr><td>${TITLE[b]}</td><td>${esc(p.field === "address" ? "Previous Address" : p.field === "name" ? "Also Known As" : "Employer")}</td><td>${esc(p.value)}</td></tr>`).join("\n    ")}
  </tbody>
</table>

<h2>Credit Score</h2>
<table>
  <thead><tr><th></th>${ORDER.map((b) => `<th>${TITLE[b]}</th>`).join("")}</tr></thead>
  <tbody>${row("VantageScore 3.0:", (b) => (raw.bureaus[b]?.score !== undefined ? String(raw.bureaus[b]!.score) : "--"))}</tbody>
</table>

<h2>Summary</h2>
<table>
  <thead><tr><th></th>${ORDER.map((b) => `<th>${TITLE[b]}</th>`).join("")}</tr></thead>
  <tbody>
    ${row("Total Accounts:", (b) => String(raw.bureaus[b]?.tradelines.length ?? 0))}
    ${row("Inquiries:", (b) => String(raw.bureaus[b]?.inquiries.length ?? 0))}
    ${row("Public Records:", (b) => String(raw.bureaus[b]?.publicRecords.length ?? 0))}
  </tbody>
</table>

<div class="page"></div>
<h2>Account History</h2>
${accountTables}

<div class="page"></div>
<h2>Inquiries</h2>
<table>
  <thead><tr><th>Creditor Name</th><th>Date of Inquiry</th><th>Credit Bureau</th></tr></thead>
  <tbody>
    ${inquiries.map(({ b, q }) => `<tr><td>${esc(q.inquirer)}</td><td>${day(q.date)}</td><td>${TITLE[b]}</td></tr>`).join("\n    ")}
  </tbody>
</table>
<h2>Public Information</h2>
<p class="muted">None reported.</p>
</body></html>
`;
}
