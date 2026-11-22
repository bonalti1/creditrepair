import { sha256Hex } from "../agreement/sha256";
import type { StaffClient, StaffLetter } from "../staff/types";
import { ACH_AUTHORIZATION_VERSION } from "./achAuthorization";
import { PAYMENT_AUTHORIZATION_VERSION } from "./authorization";
import { collectedCents, invoiceNumber, invoiceStatus, INVOICE_STATUS_LABEL } from "./invoices";
import { formatCents } from "./money";
import { paymentTermsLines, PLAN_TYPE_LABEL } from "./plans";
import { unitWork } from "./schedule";
import type { BillingCharge, ProvenResult } from "./types";

// The chargeback defense pack: everything that shows a charge was authorized
// and paid for work already performed, on one printable page. What a card
// network asks a merchant to show is, broadly: the customer agreed (the
// signed contract and the payment authorization, with when, from where and
// what exactly was accepted), the charge followed those terms, and the
// service was provided (the letters, their mailing and delivery records) and
// the customer was told (receipt, messages). The exact documents each
// processor's dispute form asks for are UNVERIFIED (docs/BILLING.md).
//
// Built from the records only: nothing here is typed by staff. The pack
// carries its own SHA-256 so a copy sent to the processor can be matched to
// the one kept.

export interface EvidenceSection {
  heading: string;
  rows: Array<[string, string]>;
  items?: string[];
  note?: string;
}

export interface EvidencePack {
  title: string;
  chargeId: string;
  invoice: string;
  generatedAt: string;
  sections: EvidenceSection[];
  /** SHA-256 of the plain text of every section. */
  hash: string;
}

export interface EvidenceCompany {
  legalName: string;
  email: string | null;
}

const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "long", timeStyle: "short", timeZone: "America/Chicago" }) + " (Texas time)" : "—";
const short = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "America/Chicago" }) : "—");

/** The letters that are the work a charge paid for. */
function workLetters(client: StaffClient, charge: BillingCharge): Array<{ round: number; letter: StaffLetter }> {
  if ((charge.unit ?? "round") === "results") return [];
  const numbers =
    charge.unit === "period" && charge.periodStart && charge.periodEnd
      ? client.rounds
          .filter((r) => r.mailedAt && r.mailedAt >= charge.periodStart! && r.mailedAt < charge.periodEnd!)
          .map((r) => r.number)
      : [charge.roundNumber];
  return client.rounds
    .filter((r) => numbers.includes(r.number))
    .flatMap((r) => r.letters.filter((l) => l.mailStatus !== "not_sent").map((letter) => ({ round: r.number, letter })));
}

function letterLine(round: number, letter: StaffLetter, mailedAt: string | null): string {
  const m = letter.mail;
  const parts = [
    `Round ${round} · ${letter.recipient.name}`,
    `mailed ${short(m?.mailedAt ?? mailedAt)}`,
    m?.mailClass ? m.mailClass.replace(/_/g, " ") : null,
    m?.trackingNumber ? `USPS tracking ${m.trackingNumber}` : null,
    m?.deliveredAt ? `delivered ${short(m.deliveredAt)}` : null,
    m?.returnedAt ? `returned ${short(m.returnedAt)}${m.returnReason ? ` (${m.returnReason})` : ""}` : null,
    letter.remailOf ? "re-mailed after a return (same round, not charged again)" : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

export function evidencePack(
  client: StaffClient,
  chargeId: string,
  company: EvidenceCompany,
  options: { results?: ProvenResult[]; now?: Date } = {},
): EvidencePack | null {
  const charge = client.billing.charges.find((c) => c.id === chargeId);
  if (!charge) return null;
  const now = options.now ?? new Date();
  const name = `${client.firstName} ${client.lastName}`.trim();
  const plan = client.agreementPlan ?? null;
  const method = client.billing.paymentMethod;
  const auth = client.methodAuthorization ?? null;
  const record = client.agreementRecord ?? null;
  const status = invoiceStatus(charge);
  const sections: EvidenceSection[] = [];

  sections.push({
    heading: "1. The charge",
    rows: [
      ["Invoice", invoiceNumber(charge)],
      ["Merchant", company.legalName],
      ["Customer", `${name} (account ${client.id})`],
      ["Amount charged", formatCents(collectedCents(charge))],
      ...((charge.creditCents ?? 0) > 0 ? ([["Referral credit applied", formatCents(charge.creditCents!)]] as Array<[string, string]>) : []),
      ["Charged on", day(charge.chargedAt)],
      ["Paid for", unitWork(charge, "en")],
      ["Work date", day(charge.workDate)],
      ["Status", INVOICE_STATUS_LABEL[status].en],
      ["Payment method", method ? `${method.kind === "ach" ? "Bank account (ACH)" : "Card"}: ${method.brand.charAt(0).toUpperCase()}${method.brand.slice(1)} ···· ${method.last4}` : "—"],
    ],
  });

  sections.push({
    heading: "2. The signed agreement",
    rows: [
      ["Signed by", record?.signerName ?? name],
      ["Signed on", day(client.agreementSignedAt)],
      ["Agreement version", client.agreementVersion ?? "—"],
      ["Document SHA-256", record?.documentHash ?? "—"],
      ["Signed from IP", record?.signerIp ?? "—"],
      ["Browser", record?.signerUserAgent ?? "—"],
      ["Language", record?.locale === "es" ? "Spanish" : "English"],
      ["Disclosure acknowledged", day(client.disclosureAcknowledgedAt)],
      ["Cancellation period ended", day(client.cancellationDeadline)],
      ["Cancelled", client.agreementCancelledAt ? day(client.agreementCancelledAt) : "No"],
    ],
    note: "The agreement states that no fee is charged before the work it pays for is fully performed (15 U.S.C. §1679b(b)), and the client could cancel at no cost for 3 business days. No work and no charge happened inside that period.",
  });

  sections.push({
    heading: "3. The plan the client signed",
    rows: plan
      ? [
          ["Plan", `${plan.name.en} (${PLAN_TYPE_LABEL[plan.terms.type].en}), version ${plan.version}`],
          ["Plan terms SHA-256", plan.termsHash],
          ["Most the client can be charged", formatCents(plan.effective.maxTotalCents)],
          ...(plan.householdDiscountPercent > 0 ? ([["Household discount", `${plan.householdDiscountPercent}%`]] as Array<[string, string]>) : []),
        ]
      : [["Fee", client.agreementMonthlyFee ? `$${client.agreementMonthlyFee} per round of letters mailed` : "—"]],
    items: plan ? paymentTermsLines(plan.terms, plan.effective, "en") : undefined,
  });

  sections.push({
    heading: "4. The payment authorization",
    rows: method
      ? [
          ["Accepted on", day(method.authorizedAt)],
          ["Authorization", `${method.kind === "ach" ? "ACH debit authorization" : "Recurring payment authorization"}, version ${method.authorizationVersion}`],
          ["Text SHA-256", auth?.hash ?? "—"],
          ["Accepted from IP", auth?.ip ?? "—"],
          ["Browser", auth?.userAgent ?? "—"],
          ["Language", auth?.locale === "es" ? "Spanish" : "English"],
          ["Processor", auth?.gateway ?? "—"],
        ]
      : [["Payment method", "None on file now (removed after the charge)"]],
    note: `Current versions: card ${PAYMENT_AUTHORIZATION_VERSION}, ACH ${ACH_AUTHORIZATION_VERSION}. The text accepted is reproduced from its version and language; its hash above matches it.`,
  });

  const letters = workLetters(client, charge);
  const roundOf = new Map(client.rounds.map((r) => [r.number, r]));
  const results = (options.results ?? []).filter((r) => charge.resultItemIds?.includes(r.itemId));
  sections.push({
    heading: "5. The work this charge paid for",
    rows: [["Unit of work", unitWork(charge, "en")]],
    items:
      (charge.unit ?? "round") === "results"
        ? results.map((r) => `${r.label}: disputed in round ${r.disputedRound} (mailed ${short(r.disputedAt)}); a later report pulled ${short(r.provedAt)} no longer lists it`)
        : letters.map(({ round, letter }) => letterLine(round, letter, roundOf.get(round)?.mailedAt ?? null)),
    note: "Mailing, tracking and delivery come from the mail service's records (Lob or the print log) as received; nothing is typed by staff.",
  });

  const messages = (client.conversation ?? []).filter((m) => {
    const t = m.at;
    const from = new Date(new Date(charge.workDate).getTime() - 3 * 86_400_000).toISOString();
    const to = new Date(new Date(charge.chargedAt ?? charge.createdAt).getTime() + 45 * 86_400_000).toISOString();
    return t >= from && t <= to && /receipt|recibo|charge|cobro|payment|pago|mailed|envi/i.test(m.text);
  });
  sections.push({
    heading: "6. What the client was told",
    rows: [["Receipt", charge.chargedAt ? `Receipt ${invoiceNumber(charge)} shown in the app under "My payments" and sent by message after the charge` : "No receipt: no money was taken"]],
    items: messages.map((m) => `${day(m.at)} · ${m.source === "human" ? `team (${m.authorName ?? "staff"})` : "app"}: ${m.text}`),
  });

  if (charge.refund || charge.chargeback) {
    sections.push({
      heading: "7. Refund and dispute",
      rows: [
        ...(charge.refund ? ([["Refund", `${formatCents(charge.refund.amountCents)} on ${day(charge.refund.completedAt ?? charge.refund.at)}: ${charge.refund.reason}`]] as Array<[string, string]>) : []),
        ...(charge.chargeback
          ? ([
              ["Chargeback", `${charge.chargeback.status}, received ${day(charge.chargeback.receivedAt)}${charge.chargeback.reasonCode ? `, reason ${charge.chargeback.reasonCode}` : ""}`],
            ] as Array<[string, string]>)
          : []),
      ],
    });
  }

  const text = sections.map((s) => [s.heading, ...s.rows.map(([k, v]) => `${k}: ${v}`), ...(s.items ?? []), s.note ?? ""].join("\n")).join("\n\n");
  return {
    title: `Charge evidence: ${invoiceNumber(charge)}`,
    chargeId,
    invoice: invoiceNumber(charge),
    generatedAt: now.toISOString(),
    sections,
    hash: sha256Hex(text),
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The pack as one self-contained HTML page, for "Save as PDF" or attaching to the processor's dispute form. */
export function evidenceHtml(pack: EvidencePack): string {
  const body = pack.sections
    .map(
      (s) => `<section><h2>${esc(s.heading)}</h2><table>${s.rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>${
        s.items && s.items.length > 0 ? `<ul>${s.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : ""
      }${s.note ? `<p class="note">${esc(s.note)}</p>` : ""}</section>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(pack.title)}</title><style>
body{font:14px/1.5 -apple-system,system-ui,Segoe UI,Roboto,sans-serif;color:#0f172a;max-width:820px;margin:32px auto;padding:0 16px;background:#fff}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:24px 0 8px;border-bottom:1px solid #e2e8f0;padding-bottom:4px}
table{border-collapse:collapse;width:100%}th{text-align:left;font-weight:600;color:#475569;width:34%;padding:3px 8px 3px 0;vertical-align:top}
td{padding:3px 0;word-break:break-word}ul{margin:6px 0 0 18px;padding:0}li{margin:2px 0}.note{color:#475569;font-size:12.5px}
.meta{color:#475569;font-size:12.5px}@media print{body{margin:0}}</style></head><body>
<h1>${esc(pack.title)}</h1><p class="meta">Generated ${esc(day(pack.generatedAt))} · SHA-256 ${esc(pack.hash)}</p>${body}</body></html>`;
}
