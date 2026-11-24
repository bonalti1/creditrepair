import type { LessonSource } from "../learn/lessons";

// Where every fact in after-care comes from (docs/AFTERCARE.md).
//
// The same rule as "Aprende" (src/lib/learn/lessons.ts):
//   "verified"      confirmed on the day below against the page's own text,
//                   through a web search restricted to that page's site. The
//                   build environment cannot open these sites, so a person
//                   opens each link once before launch.
//   "needs_review"  found only through a general web search, a secondary
//                   source, or not at all. The screen says "Pending review"
//                   beside it, and the doc lists it for the owner.
//
// No source here is a promise. Lender rules are stated as general
// information: "requirements vary by lender".

export type { LessonSource as AftercareSource } from "../learn/lessons";

const CHECKED = "2026-11-24";

export const AFTERCARE_SOURCES = {
  cfpbBuildCredit: {
    publisher: "CFPB",
    title: "What are some ways to start or rebuild a good credit history?",
    url: "https://www.consumerfinance.gov/ask-cfpb/what-are-some-ways-to-start-or-rebuild-a-good-credit-history-en-2155/",
    checkedOn: CHECKED,
    status: "verified",
    covers:
      "Secured cards (a deposit sets the limit; ask the issuer whether it reports to the credit reporting companies), credit builder loans and becoming an authorized user as ways to start or rebuild a history.",
  },
  cfpbCreditBuilderLoans: {
    publisher: "CFPB",
    title: "Targeting credit builder loans",
    url: "https://www.consumerfinance.gov/data-research/research-reports/targeting-credit-builder-loans/",
    checkedOn: CHECKED,
    status: "verified",
    covers:
      "Credit builder loans hold the loan amount (often $300 to $1,000) in a locked account while you pay over 6 to 24 months; the CFPB's study found they helped people with no existing debt more than people already carrying debt.",
  },
  cfpbGoodScore: {
    publisher: "CFPB",
    title: "How do I get and keep a good credit score?",
    url: "https://www.consumerfinance.gov/ask-cfpb/how-do-i-get-and-keep-a-good-credit-score-en-318/",
    checkedOn: "2026-11-22",
    status: "verified",
    covers: "Pay on time; utilization is balances on open cards divided by their limits, and many experts recommend using less than 30 percent.",
  },
  lowerUtilization: {
    publisher: "CFPB",
    title: "How do I get and keep a good credit score?",
    url: "https://www.consumerfinance.gov/ask-cfpb/how-do-i-get-and-keep-a-good-credit-score-en-318/",
    checkedOn: CHECKED,
    status: "needs_review",
    covers: "That keeping utilization well under 30 percent (some suggest about 10 percent) is often better. The CFPB page names 30 percent; the lower figure is common advice we could not confirm on an official page.",
  },
  cfpbMortgageInquiries: {
    publisher: "CFPB",
    title: "What happens when a mortgage lender checks my credit?",
    url: "https://www.consumerfinance.gov/ask-cfpb/what-exactly-happens-when-a-mortgage-lender-checks-my-credit-en-2005/",
    checkedOn: CHECKED,
    status: "verified",
    covers: "Credit checks from mortgage lenders within a 45-day window are recorded as a single inquiry; shopping for different kinds of loans counts as separate inquiries.",
  },
  cfpbInquiry: {
    publisher: "CFPB",
    title: "What is a credit inquiry?",
    url: "https://www.consumerfinance.gov/ask-cfpb/what-is-a-credit-inquiry-en-1317/",
    checkedOn: "2026-11-22",
    status: "needs_review",
    covers: "Hard inquiries happen when you apply for credit and other lenders can see them; they usually show for about two years (a bureau practice). Address and wording to confirm.",
  },
  cfpbCreditVisible: {
    publisher: "CFPB",
    title: "Becoming Credit Visible (Data Point, June 2017)",
    url: "https://files.consumerfinance.gov/f/documents/BecomingCreditVisible_Data_Point_Final.pdf",
    checkedOn: CHECKED,
    status: "verified",
    covers: "An authorized user's credit record can reflect the entire history of the account they are added to.",
  },
  cfpbYmygCredit: {
    publisher: "CFPB",
    title: "Your Money, Your Goals: Want credit to work for you? Start with these steps",
    url: "https://files.consumerfinance.gov/f/documents/cfpb_ymyg_want-credit-to-work-for-you_booklet_print.pdf",
    checkedOn: CHECKED,
    status: "verified",
    covers: "Ask your landlord whether they take part in a rent reporting program and weigh its fees; a cosigner or a joint account holder is legally responsible for the payments.",
  },
  cfpbUtilityReporting: {
    publisher: "CFPB",
    title: "Does my history of paying utility bills go in my credit report?",
    url: "https://www.consumerfinance.gov/ask-cfpb/does-my-history-of-paying-utility-bills-like-telephone-cable-electricity-or-water-go-in-my-credit-report-en-1817/",
    checkedOn: CHECKED,
    status: "needs_review",
    covers: "Utility and phone payments are usually not in a traditional credit report unless a service reports them. Found by search; the page's wording was not read.",
  },
  ftcWeekly: {
    publisher: "FTC",
    title: "You now have permanent access to free weekly credit reports",
    url: "https://consumer.ftc.gov/consumer-alerts/2023/10/you-now-have-permanent-access-free-weekly-credit-reports",
    checkedOn: "2026-11-22",
    status: "verified",
    covers: "Free weekly reports from the three bureaus at AnnualCreditReport.com, the only site authorized by law for them.",
  },
  cfpbDti: {
    publisher: "CFPB",
    title: "What is a debt-to-income ratio?",
    url: "https://www.consumerfinance.gov/ask-cfpb/what-is-a-debt-to-income-ratio-en-1791/",
    checkedOn: CHECKED,
    status: "needs_review",
    covers: "DTI is all your monthly debt payments divided by your gross monthly income. The page address is from memory and a search listing; confirm it.",
  },
  cfpbQmDti: {
    publisher: "CFPB",
    title: "Qualified Mortgage definition: General QM loan definition (2020 final rule)",
    url: "https://www.consumerfinance.gov/rules-policy/final-rules/qualified-mortgage-definition-under-truth-lending-act-regulation-z-general-qm-loan-definition/",
    checkedOn: CHECKED,
    status: "verified",
    covers: "The General QM rule's 43 percent DTI limit was replaced by price-based thresholds; lenders still consider DTI. Financial planners recommend keeping debt payments much lower than 43 percent of income (CFPB blog on qualified mortgages).",
  },
  cfpbCheckCreditFirst: {
    publisher: "CFPB",
    title: "Buying a home? The first step is to check your credit",
    url: "https://www.consumerfinance.gov/archive/blog/buying-home-first-step-check-your-credit/",
    checkedOn: CHECKED,
    status: "needs_review",
    covers: "Checking your credit reports before you shop for a mortgage. Found by search on consumerfinance.gov; an archived post, wording not read.",
  },
  hudFha: {
    publisher: "HUD",
    title: "FHA Single Family Housing Policy Handbook 4000.1",
    url: "https://www.hud.gov/program_offices/housing/sfh/handbook_4000-1",
    checkedOn: CHECKED,
    status: "needs_review",
    covers: "FHA minimums: a score of 580 or more for the 3.5% down payment; 500 to 579 needs at least 10% down; lenders may require more. Confirmed only through lender and consumer sites, not the handbook's own text.",
  },
  fannieMaeScores: {
    publisher: "Fannie Mae",
    title: "Selling Guide B3-5.1-01, General Requirements for Credit Scores",
    url: "https://selling-guide.fanniemae.com/sel/b3-5.1-01/general-requirements-credit-scores",
    checkedOn: CHECKED,
    status: "needs_review",
    covers: "Manually underwritten conventional loans keep a 620 minimum score; Fannie Mae removed the minimum for loans underwritten through Desktop Underwriter for files created on or after November 16, 2025 (Selling Guide update, reported by Orrick on 2025-11-14). Lenders can set higher minimums.",
  },
  itinLoans: {
    publisher: "NerdWallet",
    title: "ITIN loans: how to get a mortgage without a Social Security number",
    url: "https://www.nerdwallet.com/mortgages/learn/itin-loan-how-to-get-a-mortgage-without-a-social-security-number",
    checkedOn: CHECKED,
    status: "needs_review",
    covers: "ITIN mortgages are lender-specific programs, usually non-QM, not FHA or conventional; down payments are often larger (sources say 10% to 30%), rates are often higher, and some lenders accept alternative credit such as rent and utilities. A consumer site, not a government source.",
  },
  irsItin: {
    publisher: "IRS",
    title: "Individual Taxpayer Identification Number (ITIN)",
    url: "https://www.irs.gov/individuals/individual-taxpayer-identification-number",
    checkedOn: CHECKED,
    status: "needs_review",
    covers: "The IRS issues ITINs, nine-digit numbers that begin with 9, to people who need a U.S. taxpayer number and cannot get a Social Security number. Confirmed only through secondary pages.",
  },
  experianAnnualNoSsn: {
    publisher: "Experian",
    title: "How to get your free annual credit reports",
    url: "https://www.experian.com/help/annual-credit-report/",
    checkedOn: CHECKED,
    status: "verified",
    covers: "A Social Security number is required to request the annual report online; without one, you can send the request in writing with a copy of a government ID and of a current utility bill, bank or insurance statement.",
  },
  experianItin: {
    publisher: "Experian",
    title: "Can you check your credit score without a Social Security number?",
    url: "https://www.experian.com/blogs/ask-experian/can-you-check-your-credit-score-without-a-social-security-number/",
    checkedOn: CHECKED,
    status: "verified",
    covers: "Credit files can be built on identifiers such as your name and ITIN; with an ITIN you can mail a request to each bureau using the form from AnnualCreditReport.com, with your full name, date of birth and addresses for the past two years.",
  },
  annualCreditReportForm: {
    publisher: "AnnualCreditReport.com",
    title: "Annual Credit Report Request Form",
    url: "https://www.annualcreditreport.com/manualRequestForm.action",
    checkedOn: CHECKED,
    status: "needs_review",
    covers: "The official mail-in request form. The site's FAQ reportedly accepts only a Social Security number online; the site could not be opened from the build environment.",
  },
} as const satisfies Record<string, LessonSource>;

export type AftercareSourceKey = keyof typeof AFTERCARE_SOURCES;
