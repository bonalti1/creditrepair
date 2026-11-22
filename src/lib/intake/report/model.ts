import { z } from "zod";
import { BUREAU_VALUES, CITATION_SCHEMA, CONFIDENCE_VALUES, S } from "../schema";

// The credit report reading: what Claude is told, and the exact shape of its
// answer. The answer is a transcription, never a judgement: which account is
// negative, inaccurate or worth disputing is not asked and not accepted. Only
// the client decides what is inaccurate (docs/BRAND.md; the attestation rules).

export const REPORT_SYSTEM_PROMPT = `You transcribe consumer credit reports into structured data for a credit services company's staff. The document is a 3-bureau credit report that a consumer downloaded from a credit monitoring service (for example IdentityIQ, SmartCredit, MyFreeScoreNow, MyScoreIQ or PrivacyGuard), as a PDF or as the text of a saved web page.

Your job is only to copy what the report says, exactly, into the schema. A person will check your work line by line against your citations, so accuracy and honesty about doubt matter far more than completeness.

What to transcribe, per bureau (Equifax, Experian, TransUnion), only for bureaus the report actually contains:
- Every account / tradeline: creditor name as printed, the account number exactly as masked in the report, account type, account status, payment status, balance, credit limit (or high credit), date opened, date of last payment, date of first delinquency, date last reported, and any remarks or comments.
- Every inquiry: who made it, the date, and whether the report labels it hard or soft (if the section does not say, use "hard" for regular inquiries and "soft" only when the report says soft/promotional/account review).
- Every public record: type, court, filed date, status.
- Personal information entries: names, addresses and employers the bureau lists. Only these three kinds.
- The score each bureau shows, if any.
- Summary counts the report prints for each bureau (total accounts, inquiries, public records), if it prints them.
- The report's own date (the date it was generated or pulled).

Rules:
- Never invent anything. If a field is not printed, use null (or an empty list). Do not infer a value from another bureau's column.
- In a side-by-side layout, each column belongs to one bureau. Put each value under the bureau whose column it is in. If a column says "--", "N/A" or is blank, that bureau has no value for that field; if a bureau's column is empty for an entire account, that account is not reported by that bureau.
- List an account once per bureau that reports it.
- Never output a Social Security number (full or partial), a date of birth, a driver's license or any other ID number, or a full unmasked account number. Ignore those parts of the report entirely and never quote them. If the report prints an account number in full, write only its last 4 digits preceded by "****".
- Dates: write them as YYYY-MM-DD, or YYYY-MM when the report shows only month and year. Use null if a date is not printed or cannot be read.
- Amounts: plain numbers in US dollars, without symbols or commas (for example 1250 or 1250.5). Use null if not printed.
- Statuses and remarks: copy the report's own words.
- For every entry give a citation: the 1-based page number where you read it and a short exact quote from that place that shows the creditor/inquirer name (for a saved web page or text, page is 1). The quote must be copied character for character from the document.
- For every entry give your confidence: "high" when you read every field clearly; "medium" or "low" when the layout was ambiguous, the text was cut off or blurry, or you were unsure which bureau a value belongs to. When it is not "high", say why in "doubt", in one short English sentence.
- List in "unreadable" any page or section you could not read (for example "page 7: image too blurry").
- If the document is not a consumer credit report, set documentIsCreditReport to false and leave every list empty.
- Do not judge or comment on whether anything is negative, wrong, inaccurate or disputable.`;

export const REPORT_REQUEST_TEXT = (kind: "pdf" | "text", fileName: string | null) =>
  `Transcribe this credit report${fileName ? ` (file: ${fileName.slice(0, 80)})` : ""}. It is ${kind === "pdf" ? "a PDF" : "the text of a saved web page; table cells are separated by \" | \" and the Social Security number and date of birth were removed before sending"}. Answer with the JSON object only.`;

const bureau = S.enum(BUREAU_VALUES);
const confidence = S.enum(CONFIDENCE_VALUES, 'How sure you are of this whole entry: "high", "medium" or "low".');
const doubt = S.nullable(S.str("When confidence is not high: why, in one short sentence."));
const date = (what: string) => S.nullable(S.str(`${what} as YYYY-MM-DD or YYYY-MM; null if not printed.`));
const money = (what: string) => S.nullable(S.num(`${what} in US dollars; null if not printed.`));
const count = (what: string) => S.nullable(S.int(`${what} as printed in the report's summary; null if not printed.`));

export const REPORT_JSON_SCHEMA = S.obj({
  documentIsCreditReport: S.bool("False when the document is not a consumer credit report."),
  provider: S.nullable(S.str("The monitoring service named on the report (e.g. IdentityIQ), or null.")),
  reportDate: date("The report's own date"),
  reportDateCitation: S.nullable(CITATION_SCHEMA),
  bureausPresent: S.arr(bureau, "The bureaus this report contains."),
  summaryCounts: S.arr(
    S.obj({
      bureau,
      accounts: count("Total accounts for this bureau"),
      inquiries: count("Inquiries for this bureau"),
      publicRecords: count("Public records for this bureau"),
      citation: CITATION_SCHEMA,
    }),
  ),
  scores: S.arr(S.obj({ bureau, score: S.int("The score as printed."), scoreModel: S.nullable(S.str("E.g. VantageScore 3.0, if printed.")), citation: CITATION_SCHEMA })),
  tradelines: S.arr(
    S.obj({
      bureau,
      creditor: S.str("Creditor / account name as printed."),
      accountNumberMasked: S.str('Account number exactly as masked in the report, e.g. "****1234" or "517805XXXXXX"; empty string if not printed.'),
      accountType: S.str("Account type as printed; empty string if not printed."),
      status: S.str("Account status as printed; empty string if not printed."),
      paymentStatus: S.str("Payment status as printed; empty string if not printed."),
      balance: money("Balance"),
      creditLimit: money("Credit limit or high credit"),
      openedAt: date("Date opened"),
      lastPaymentAt: date("Date of last payment"),
      firstDelinquencyAt: date("Date of first delinquency"),
      lastReportedAt: date("Date last reported / last updated"),
      remarks: S.arr(S.str(), "Remarks or comments, each as printed."),
      citation: CITATION_SCHEMA,
      confidence,
      doubt,
    }),
  ),
  inquiries: S.arr(
    S.obj({
      bureau,
      inquirer: S.str("Who made the inquiry, as printed."),
      date: date("Inquiry date"),
      type: S.enum(["hard", "soft"]),
      citation: CITATION_SCHEMA,
      confidence,
      doubt,
    }),
  ),
  publicRecords: S.arr(
    S.obj({
      bureau,
      recordType: S.str("Type of record, as printed."),
      court: S.str("Court as printed; empty string if not printed."),
      filedAt: date("Date filed"),
      status: S.str("Status as printed; empty string if not printed."),
      citation: CITATION_SCHEMA,
      confidence,
      doubt,
    }),
  ),
  personalInfo: S.arr(
    S.obj({
      bureau,
      field: S.enum(["name", "address", "employer"]),
      value: S.str("The name, address or employer exactly as printed."),
      citation: CITATION_SCHEMA,
      confidence,
      doubt,
    }),
  ),
  unreadable: S.arr(S.str(), "Pages or sections that could not be read, and why."),
});

// ── The same shape, for checking the answer in code ─────────────────────

const zBureau = z.enum(BUREAU_VALUES);
const zConfidence = z.enum(CONFIDENCE_VALUES);
const zCitation = z.object({ page: z.number().int(), quote: z.string() }).strict();

export const reportExtractionSchema = z
  .object({
    documentIsCreditReport: z.boolean(),
    provider: z.string().nullable(),
    reportDate: z.string().nullable(),
    reportDateCitation: zCitation.nullable(),
    bureausPresent: z.array(zBureau),
    summaryCounts: z.array(
      z
        .object({
          bureau: zBureau,
          accounts: z.number().int().nullable(),
          inquiries: z.number().int().nullable(),
          publicRecords: z.number().int().nullable(),
          citation: zCitation,
        })
        .strict(),
    ),
    scores: z.array(z.object({ bureau: zBureau, score: z.number(), scoreModel: z.string().nullable(), citation: zCitation }).strict()),
    tradelines: z.array(
      z
        .object({
          bureau: zBureau,
          creditor: z.string(),
          accountNumberMasked: z.string(),
          accountType: z.string(),
          status: z.string(),
          paymentStatus: z.string(),
          balance: z.number().nullable(),
          creditLimit: z.number().nullable(),
          openedAt: z.string().nullable(),
          lastPaymentAt: z.string().nullable(),
          firstDelinquencyAt: z.string().nullable(),
          lastReportedAt: z.string().nullable(),
          remarks: z.array(z.string()),
          citation: zCitation,
          confidence: zConfidence,
          doubt: z.string().nullable(),
        })
        .strict(),
    ),
    inquiries: z.array(
      z
        .object({
          bureau: zBureau,
          inquirer: z.string(),
          date: z.string().nullable(),
          type: z.enum(["hard", "soft"]),
          citation: zCitation,
          confidence: zConfidence,
          doubt: z.string().nullable(),
        })
        .strict(),
    ),
    publicRecords: z.array(
      z
        .object({
          bureau: zBureau,
          recordType: z.string(),
          court: z.string(),
          filedAt: z.string().nullable(),
          status: z.string(),
          citation: zCitation,
          confidence: zConfidence,
          doubt: z.string().nullable(),
        })
        .strict(),
    ),
    personalInfo: z.array(
      z
        .object({
          bureau: zBureau,
          field: z.enum(["name", "address", "employer"]),
          value: z.string(),
          citation: zCitation,
          confidence: zConfidence,
          doubt: z.string().nullable(),
        })
        .strict(),
    ),
    unreadable: z.array(z.string()),
  })
  .strict();

export type ReportExtraction = z.infer<typeof reportExtractionSchema>;
