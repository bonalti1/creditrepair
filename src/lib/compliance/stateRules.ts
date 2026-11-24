// What each state's law asks of a credit repair company before it can sell
// there: the expansion checklist (docs/STATES.md, /equipo/estados).
//
// HOW TO READ IT. This is research, not legal advice. It was compiled on
// 2026-11-24 by web search from the statutes and regulator pages listed in
// `source` (the build environment could not open most government sites
// directly, so pages were read through search results). `verified: true`
// means the main facts written here (that the law exists, who registers it,
// the bond) were seen in the statute's text or the regulator's own page;
// `unconfirmed` lists what was not. `verified: false` means only secondary
// sources, or memory of the statute, back the entry: treat every field as a
// lead. Nothing was invented: an amount or agency nobody could find is null.
//
// EVERY state, the verified ones too, needs an attorney's review before it
// is opened (state_openings, migration 0030, records the attorney and the
// date). Laws change: re-check the source before relying on any line.
//
// The federal floor applies everywhere: the Credit Repair Organizations Act
// (15 U.S.C. § 1679 et seq.): the written disclosure before the contract, a
// written contract, 3 business days to cancel, and no payment before the
// service is fully performed. Fields here are only what a state ADDS.

export type StateLawStatus =
  /** No state credit repair registration or bond was found: the federal rules (CROA) and general consumer law. */
  | "open"
  /** A state credit services / credit repair law asks for a registration, a license or a bond first. */
  | "registration"
  /** The law effectively bars a for-profit company like Credalti, or makes it a crime. */
  | "restricted"
  /** Not researched enough to say. */
  | "not_reviewed";

export interface StateRule {
  code: string;
  name: string;
  status: StateLawStatus;
  /** The statute, as cited. Null when none was found. */
  statute: string | null;
  registration: {
    required: boolean | null;
    /** Who registers or licenses it. */
    agency: string | null;
    /** The form, when it has a name. */
    form?: string | null;
    fee?: string | null;
    renewal?: string | null;
  };
  /** The bond (or trust account / security) the law asks for, as written; null when none or unknown. */
  bond: string | null;
  /** Days to cancel when the state gives MORE than the federal 3 business days; null otherwise or unknown. */
  cancellationDays: number | null;
  cancellationNote?: string;
  /** Contract and disclosure requirements beyond the federal ones. */
  contract: string[];
  /** Outright restrictions (bans, fee limits, criminal penalties). */
  restrictions: string[];
  source: string;
  /** See the file header. */
  verified: boolean;
  /** The date the entry was researched (ISO date). */
  verifiedOn: string;
  /** What was looked for and not confirmed. */
  unconfirmed?: string[];
  notes?: string;
}

const ON = "2026-11-24";

const R = (r: Omit<StateRule, "verifiedOn" | "contract" | "restrictions"> & Partial<Pick<StateRule, "contract" | "restrictions">>): StateRule => ({
  contract: [],
  restrictions: [],
  ...r,
  verifiedOn: ON,
});

const none = { required: false, agency: null } as const;
const unknown = { required: null, agency: null } as const;

export const STATE_LAW: Record<string, StateRule> = {
  AL: R({ code: "AL", name: "Alabama", status: "open", statute: null, registration: none, bond: null, cancellationDays: null, source: "https://www.lexingtonlaw.com/blog/credit-repair/credit-repair-laws.html", verified: false, unconfirmed: ["That Alabama has no credit services statute (a secondary table says so; other secondary sources disagree)"] }),
  AK: R({ code: "AK", name: "Alaska", status: "open", statute: null, registration: none, bond: null, cancellationDays: null, source: "https://www.lexingtonlaw.com/blog/credit-repair/credit-repair-laws.html", verified: false, unconfirmed: ["That Alaska has no credit services statute"] }),
  AZ: R({
    code: "AZ",
    name: "Arizona",
    status: "registration",
    statute: "A.R.S. §§ 44-1701 to 44-1713 (credit services organizations)",
    registration: { required: true, agency: "Arizona Corporation Commission (bond copy filed with the Corporations Division records section)" },
    bond: "Surety bond under § 44-1708, adjusted yearly; reported as 5% of the prior 12 months' fees, $5,000 minimum, $25,000 maximum (unconfirmed)",
    cancellationDays: null,
    contract: ["Written contract and information statement (§§ 44-1704, 44-1705)"],
    restrictions: ["No fee before full performance unless the bond is in place (§ 44-1703)"],
    source: "https://azleg.gov/ars/44/01708.htm",
    verified: true,
    unconfirmed: ["The bond amount formula", "Whether a separate registration statement is filed"],
  }),
  AR: R({ code: "AR", name: "Arkansas", status: "registration", statute: "Ark. Code Ann. § 4-91-101 et seq. (Credit Services Organizations Act)", registration: { required: true, agency: "Arkansas Secretary of State" }, bond: "$10,000 (unconfirmed)", cancellationDays: null, source: "https://law.justia.com/codes/arkansas/title-4/subtitle-7/chapter-91/", verified: false, unconfirmed: ["Agency, bond and fee"] }),
  CA: R({
    code: "CA",
    name: "California",
    status: "registration",
    statute: "Cal. Civ. Code §§ 1789.10–1789.26 (Credit Services Act of 1984)",
    registration: { required: true, agency: "California Department of Justice (Attorney General), before doing business (§ 1789.25)", form: "Credit Services Organization Registration Application (oag.ca.gov/consumers/general/csoform)", renewal: "Yearly (unconfirmed)" },
    bond: "$100,000 surety bond from an admitted surety; copy filed with the Secretary of State; kept 2 years after ceasing business (§ 1789.18)",
    cancellationDays: 5,
    cancellationNote: "Until midnight of the fifth working day after signing (§ 1789.16). The contract and its notice must say 5 working days, not 3.",
    contract: ["Written contract with the § 1789.16 terms and notice of cancellation", "Information statement before the contract (§ 1789.14)"],
    restrictions: ["No fee before full performance (CROA; also § 1789.13)"],
    source: "https://www.oag.ca.gov/consumers/general/csoform",
    verified: true,
    unconfirmed: ["The registration fee"],
  }),
  CO: R({
    code: "CO",
    name: "Colorado",
    status: "registration",
    statute: "C.R.S. § 5-19-101 et seq. (Colorado Credit Services Organization Act, Part 1)",
    registration: { required: true, agency: "Colorado Attorney General (yearly notification, § 5-19-110 as amended in 2024)" },
    bond: null,
    cancellationDays: null,
    contract: ["Written statement before the contract (§ 5-19-105)"],
    source: "https://coag.gov/file-a-complaint/credit-services-organizations/",
    verified: false,
    unconfirmed: ["Whether Part 1 itself requires a bond", "The 2024 notification's form and fee"],
  }),
  CT: R({ code: "CT", name: "Connecticut", status: "registration", statute: "Conn. Gen. Stat. § 36a-695 et seq. (credit clinics)", registration: { required: true, agency: "Connecticut Department of Banking (credit clinic license)" }, bond: null, cancellationDays: null, source: "https://portal.ct.gov/dob", verified: false, unconfirmed: ["License requirements, bond and fees"] }),
  DE: R({ code: "DE", name: "Delaware", status: "registration", statute: "6 Del. C. § 2401 et seq. (Credit Services Organization Act)", registration: unknown, bond: null, cancellationDays: null, source: "https://delcode.delaware.gov/title6/c024/index.html", verified: false, unconfirmed: ["Registration, bond and fees"] }),
  DC: R({ code: "DC", name: "District of Columbia", status: "registration", statute: "D.C. Code § 28-4601 et seq. (credit services organizations)", registration: unknown, bond: null, cancellationDays: null, source: "https://code.dccouncil.gov/us/dc/council/code/titles/28/chapters/46", verified: false, unconfirmed: ["Registration, bond and cancellation period"] }),
  FL: R({
    code: "FL",
    name: "Florida",
    status: "registration",
    statute: "Fla. Stat. §§ 817.7001–817.706 (Credit Service Organizations)",
    registration: { required: false, agency: null },
    bond: "$10,000 surety bond (or trust account) required before taking any money ahead of full performance (§ 817.7005)",
    cancellationDays: null,
    cancellationNote: "The contract terms are in § 817.704; whether it gives more than 3 business days was not confirmed.",
    contract: ["Information statement and written contract (§§ 817.703, 817.704)"],
    restrictions: ["Charging before full performance only with the bond or trust account (§ 817.7005)"],
    source: "https://flsenate.gov/Laws/Statutes/2019/817.7005",
    verified: true,
    unconfirmed: ["Cancellation period in § 817.704", "Whether any state filing is required"],
    notes: "Credalti charges only after a round is mailed (docs/BILLING.md); counsel to confirm whether that is 'full performance' here, which decides whether the bond is needed.",
  }),
  GA: R({
    code: "GA",
    name: "Georgia",
    status: "restricted",
    statute: "O.C.G.A. § 16-9-59 (operating a credit repair services organization)",
    registration: { required: null, agency: null },
    bond: null,
    cancellationDays: null,
    restrictions: [
      "Owning, operating or being affiliated with a credit repair services organization is a misdemeanor; 501(c)(3) nonprofits and attorneys practicing law are outside the definition",
      "A 2025–2026 bill would exempt certain for-profit organizations that follow consumer protections; enactment not confirmed",
    ],
    source: "https://law.justia.com/codes/georgia/2022/title-16/chapter-9/article-4/section-16-9-59/",
    verified: true,
    unconfirmed: ["The status of the 2025–2026 exemption bill"],
    notes: "Do not market here at all without specific counsel sign-off.",
  }),
  HI: R({ code: "HI", name: "Hawaii", status: "not_reviewed", statute: "Haw. Rev. Stat. ch. 481B (unconfirmed)", registration: unknown, bond: null, cancellationDays: null, source: "https://www.capitol.hawaii.gov/hrscurrent/", verified: false, unconfirmed: ["Whether and how Hawaii regulates credit repair"] }),
  ID: R({ code: "ID", name: "Idaho", status: "registration", statute: "Idaho Code § 26-2222 et seq. (Idaho Collection Agency Act, which reaches credit repair) (unconfirmed)", registration: { required: true, agency: "Idaho Department of Finance (license) (unconfirmed)" }, bond: null, cancellationDays: null, source: "https://www.finance.idaho.gov/", verified: false, unconfirmed: ["Whether a license is required for credit repair alone", "Bond"] }),
  IL: R({
    code: "IL",
    name: "Illinois",
    status: "registration",
    statute: "815 ILCS 605 (Credit Services Organizations Act)",
    registration: { required: true, agency: "Illinois Secretary of State, before conducting business", fee: "Reasonable fee, at most $100 (§ 605/9)" },
    bond: "$100,000 surety bond on the state's form, copy filed with the Secretary of State's Index Department (§§ 605/5, 605/10)",
    cancellationDays: null,
    cancellationNote: "A 5-day cancellation period is reported by secondary sources; not confirmed in the statute's text.",
    contract: ["Information statement and written contract with a notice of cancellation"],
    source: "https://ilga.gov/legislation/ilcs/documents/081506050K10.htm",
    verified: true,
    unconfirmed: ["The cancellation period", "Whether the bond is required when no fee is taken before full performance"],
  }),
  IN: R({ code: "IN", name: "Indiana", status: "registration", statute: "Ind. Code § 24-5-15 (credit services organizations)", registration: { required: true, agency: "Indiana Secretary of State (unconfirmed)" }, bond: null, cancellationDays: null, source: "https://iga.in.gov/laws/2024/ic/titles/24", verified: false, unconfirmed: ["Agency, bond and fee"] }),
  IA: R({ code: "IA", name: "Iowa", status: "registration", statute: "Iowa Code ch. 538A (credit services organizations)", registration: unknown, bond: null, cancellationDays: null, source: "https://www.legis.iowa.gov/law/iowaCode", verified: false, unconfirmed: ["Registration, bond and fee"] }),
  KS: R({ code: "KS", name: "Kansas", status: "registration", statute: "K.S.A. § 50-1116 et seq. (Kansas Credit Services Organization Act)", registration: { required: true, agency: "Office of the State Bank Commissioner (unconfirmed)" }, bond: null, cancellationDays: null, source: "https://www.osbckansas.org/", verified: false, unconfirmed: ["Agency, bond and fee", "A secondary source claims Kansas bars credit repair; not supported"] }),
  KY: R({ code: "KY", name: "Kentucky", status: "not_reviewed", statute: null, registration: unknown, bond: null, cancellationDays: null, source: "https://www.lexingtonlaw.com/blog/credit-repair/credit-repair-laws.html", verified: false, unconfirmed: ["Sources disagree on whether Kentucky has a credit services statute"] }),
  LA: R({
    code: "LA",
    name: "Louisiana",
    status: "registration",
    statute: "La. R.S. 9:3573.1 et seq. (Credit Repair Services Organization Act)",
    registration: { required: true, agency: "Louisiana Attorney General", renewal: "Yearly" },
    bond: "$100,000 surety bond from a company licensed in Louisiana, filed with the Attorney General, before doing business (La. R.S. 9:3573.4)",
    cancellationDays: null,
    source: "https://ag.louisiana.gov/Page/CreditRepairServices",
    verified: true,
    unconfirmed: ["The registration fee", "The cancellation period"],
  }),
  ME: R({ code: "ME", name: "Maine", status: "registration", statute: "9-A M.R.S. § 10-101 et seq. (credit services organizations)", registration: { required: true, agency: "Maine Bureau of Consumer Credit Protection (unconfirmed)" }, bond: null, cancellationDays: null, source: "https://www.maine.gov/pfr/consumercredit/", verified: false, unconfirmed: ["Agency, bond and fee"] }),
  MD: R({
    code: "MD",
    name: "Maryland",
    status: "registration",
    statute: "Md. Code, Com. Law § 14-1901 et seq. (Maryland Credit Services Businesses Act)",
    registration: { required: true, agency: "Commissioner of Financial Regulation (license for the principal executive office; branches disclosed)" },
    bond: "Surety bond on the Commissioner's form; reported as $50,000 base plus $50,000 per branch (vendor source, unconfirmed)",
    cancellationDays: null,
    source: "https://labor.maryland.gov/FINANCE/industry/creditserv.shtml",
    verified: true,
    unconfirmed: ["The bond amount", "License fee"],
  }),
  MA: R({ code: "MA", name: "Massachusetts", status: "not_reviewed", statute: "M.G.L. c. 93, §§ 68A–68E (credit services organizations) (unconfirmed)", registration: unknown, bond: null, cancellationDays: null, source: "https://malegislature.gov/Laws/GeneralLaws/PartI/TitleXV/Chapter93", verified: false, unconfirmed: ["Registration and bond"] }),
  MI: R({
    code: "MI",
    name: "Michigan",
    status: "open",
    statute: "MCL 445.1821–445.1826 (Credit Services Protection Act, 1994 PA 160)",
    registration: { required: null, agency: null },
    bond: null,
    cancellationDays: null,
    restrictions: ["False or misleading representations barred (§ 445.1823); a violating organization cannot recover any fee (§ 445.1825); violations are misdemeanors"],
    source: "https://www.legislature.mi.gov/documents/mcl/pdf/MCL-445-1821.pdf",
    verified: false,
    unconfirmed: ["Whether the Act requires a registration or bond (the text of § 445.1823 was not fully read)", "Whether it bars fees before full performance"],
  }),
  MN: R({ code: "MN", name: "Minnesota", status: "registration", statute: "Minn. Stat. § 332.52 et seq. (credit services organizations)", registration: { required: true, agency: "Minnesota Department of Commerce (unconfirmed)" }, bond: null, cancellationDays: null, source: "https://www.revisor.mn.gov/statutes/cite/332.52", verified: false, unconfirmed: ["Agency, bond and fee"] }),
  MS: R({ code: "MS", name: "Mississippi", status: "not_reviewed", statute: null, registration: unknown, bond: null, cancellationDays: null, source: "https://law.justia.com/codes/mississippi/", verified: false, unconfirmed: ["Whether Mississippi regulates credit repair"] }),
  MO: R({ code: "MO", name: "Missouri", status: "registration", statute: "Mo. Rev. Stat. § 407.635 et seq. (credit services organizations)", registration: { required: true, agency: "Missouri Division of Finance (credit service organization registration)" }, bond: null, cancellationDays: null, source: "https://finance.mo.gov/consumer-credit-licensing/credit-service-organizations", verified: false, unconfirmed: ["Bond and fee (the Division's page was found, not read in full)"] }),
  MT: R({ code: "MT", name: "Montana", status: "not_reviewed", statute: null, registration: unknown, bond: null, cancellationDays: null, source: "https://leg.mt.gov/bills/mca/", verified: false, unconfirmed: ["Whether Montana regulates credit repair"] }),
  NE: R({ code: "NE", name: "Nebraska", status: "registration", statute: "Neb. Rev. Stat. § 45-801 et seq. (Credit Services Organization Act)", registration: unknown, bond: null, cancellationDays: null, source: "https://nebraskalegislature.gov/laws/browse-chapters.php?chapter=45", verified: false, unconfirmed: ["Registration, bond and fee"] }),
  NV: R({
    code: "NV",
    name: "Nevada",
    status: "registration",
    statute: "NRS 598.741–598.787 (credit service organizations)",
    registration: { required: true, agency: "Nevada Division of Mortgage Lending (certificate of registration)", renewal: "Every year" },
    bond: "Security on file with the Commissioner (NRS 598.726), released six months after ceasing business; amount not confirmed",
    cancellationDays: null,
    restrictions: ["No fee before full performance (NRS 598.746)"],
    source: "https://mld.nv.gov/Industry/Credit_Service_Organizations/Credit_Service_Organizations_-_NRS_598",
    verified: true,
    unconfirmed: ["The security amount", "The administrative fee"],
  }),
  NH: R({ code: "NH", name: "New Hampshire", status: "registration", statute: "RSA ch. 359-D (credit services organizations)", registration: unknown, bond: null, cancellationDays: null, source: "https://www.gencourt.state.nh.us/rsa/html/NHTOC/NHTOC-XXXI-359-D.htm", verified: false, unconfirmed: ["Registration, bond and fee"] }),
  NJ: R({
    code: "NJ",
    name: "New Jersey",
    status: "open",
    statute: null,
    registration: { required: false, agency: null },
    bond: null,
    cancellationDays: null,
    restrictions: ["Consumer Fraud Act (N.J.S.A. 56:8-1 et seq.) applies", "Negotiating with creditors is debt adjustment, which needs a license (N.J.S.A. 17:16G-1 et seq.); Credalti does not do that"],
    source: "https://law.justia.com/codes/new-jersey/title-17/section-17-16g-5/",
    verified: false,
    unconfirmed: ["That no New Jersey statute specific to credit repair exists (only a practitioner's page says so)"],
  }),
  NM: R({ code: "NM", name: "New Mexico", status: "not_reviewed", statute: null, registration: unknown, bond: null, cancellationDays: null, source: "https://nmonesource.com/", verified: false, unconfirmed: ["Whether New Mexico regulates credit repair (a low-quality source claims it bars it)"] }),
  NY: R({
    code: "NY",
    name: "New York",
    status: "open",
    statute: "N.Y. Gen. Bus. Law art. 28-BB, §§ 458-a–458-k (credit services businesses)",
    registration: { required: false, agency: null },
    bond: null,
    cancellationDays: null,
    cancellationNote: "Three days, with a ten-point Notice of Cancellation (§ 458-f). A 2013 bill to make it five business days was not confirmed as enacted.",
    contract: ["Written, dated contract with the § 458-f terms and Notice of Cancellation in at least 10-point type", "Consumer's statement of rights before the contract (§ 458-d)"],
    restrictions: ["No fee before the services are fully performed (§ 458-e)", "Treble damages, at least the amount paid (§ 458-i)"],
    source: "https://www.nysenate.gov/legislation/laws/GBS/458-F",
    verified: true,
    unconfirmed: ["The enacted wording of § 458-e"],
  }),
  NC: R({
    code: "NC",
    name: "North Carolina",
    status: "registration",
    statute: "N.C. Gen. Stat. §§ 66-220 to 66-226 (Credit Repair Services Act)",
    registration: { required: false, agency: null },
    bond: "Every credit repair business must obtain a surety bond (or trust account with a licensed bank) (§ 66-222); amount not confirmed",
    cancellationDays: null,
    contract: ["Contract requirements in § 66-224"],
    restrictions: ["No payment before the services are fully performed (§ 66-223)", "No payment solely for a referral (§ 66-223)"],
    source: "https://ncleg.gov/EnactedLegislation/Statutes/HTML/ByArticle/Chapter_66/Article_30.html",
    verified: true,
    unconfirmed: ["The bond amount", "The contract's cancellation period"],
  }),
  ND: R({ code: "ND", name: "North Dakota", status: "not_reviewed", statute: null, registration: unknown, bond: null, cancellationDays: null, source: "https://www.ndlegis.gov/general-information/north-dakota-century-code", verified: false, unconfirmed: ["Whether North Dakota regulates credit repair"] }),
  OH: R({
    code: "OH",
    name: "Ohio",
    status: "registration",
    statute: "Ohio Rev. Code ch. 4712 (Ohio Credit Services Organization Act)",
    registration: { required: true, agency: "Ohio Division of Financial Institutions", fee: "$100; renewal $100 (§ 4712.02)", renewal: "Yearly" },
    bond: "$50,000, filed with the Division, kept 2 years after ceasing business (§ 4712.06, 2017 text)",
    cancellationDays: null,
    contract: ["The customer contract is filed with the registration (§ 4712.02)", "Written contract terms (§ 4712.05)"],
    source: "https://codes.ohio.gov/ohio-revised-code/chapter-4712",
    verified: true,
    unconfirmed: ["That the current § 4712.06 still says $50,000"],
  }),
  OK: R({ code: "OK", name: "Oklahoma", status: "registration", statute: "Okla. Stat. tit. 24, § 131 et seq. (Credit Services Organization Act)", registration: unknown, bond: null, cancellationDays: null, source: "https://www.oscn.net/applications/oscn/index.asp?ftdb=STOKST24", verified: false, unconfirmed: ["Registration, bond and fee"] }),
  OR: R({ code: "OR", name: "Oregon", status: "not_reviewed", statute: null, registration: unknown, bond: null, cancellationDays: null, source: "https://www.oregonlegislature.gov/bills_laws/", verified: false, unconfirmed: ["How Oregon regulates credit repair"] }),
  PA: R({
    code: "PA",
    name: "Pennsylvania",
    status: "registration",
    statute: "73 P.S. §§ 2181–2192 (Credit Services Act)",
    registration: { required: true, agency: "Pennsylvania Department of Banking and Securities (through the DoBS Portal)" },
    bond: "Surety bond or trust account under § 2187; the state's bond form says not less than $5,000 nor more than $25,000",
    cancellationDays: null,
    source: "https://www.dobs.pa.gov/Documents/Statutes/Credit%20Services%20Act.pdf",
    verified: true,
    unconfirmed: ["The registration fee", "Whether credit repair alone (not a loan broker) registers the same way"],
  }),
  RI: R({ code: "RI", name: "Rhode Island", status: "not_reviewed", statute: null, registration: unknown, bond: null, cancellationDays: null, source: "https://webserver.rilegislature.gov/Statutes/", verified: false, unconfirmed: ["How Rhode Island regulates credit repair"] }),
  SC: R({ code: "SC", name: "South Carolina", status: "registration", statute: "S.C. Code § 37-7-101 et seq. (Credit Services Organization Act)", registration: { required: true, agency: "South Carolina Department of Consumer Affairs (unconfirmed)" }, bond: null, cancellationDays: null, source: "https://consumer.sc.gov/", verified: false, unconfirmed: ["Agency, bond and fee (a secondary table says none beyond federal)"] }),
  SD: R({ code: "SD", name: "South Dakota", status: "open", statute: null, registration: none, bond: null, cancellationDays: null, source: "https://sdlegislature.gov/Statutes", verified: false, unconfirmed: ["That South Dakota has no credit services statute"] }),
  TN: R({ code: "TN", name: "Tennessee", status: "registration", statute: "Tenn. Code § 47-18-1001 et seq. (Credit Services Businesses Act)", registration: unknown, bond: null, cancellationDays: null, source: "https://www.tn.gov/attorneygeneral.html", verified: false, unconfirmed: ["Registration, bond and fee"] }),
  TX: R({
    code: "TX",
    name: "Texas",
    status: "registration",
    statute: "Tex. Fin. Code ch. 393 (credit services organizations)",
    registration: { required: true, agency: "Texas Secretary of State, before conducting business (§ 393.101)", form: "Form 2801 / 2802 (sos.texas.gov)", fee: "Up to $100 (§ 393.104); the form lists $100", renewal: "Yearly" },
    bond: "$10,000 surety bond or surety account, copy filed with the Secretary of State (§§ 393.401–393.403)",
    cancellationDays: null,
    contract: ["Disclosure statement before the contract (§ 393.105)", "Contract terms and cancellation notice (§ 393.201)", "Agent for service of process in Texas"],
    source: "https://statutes.capitol.texas.gov/Docs/FI/htm/FI.393.htm",
    verified: true,
    notes: "The launch state. The agreement's Texas documents are built (src/lib/agreement/documents.ts); attorney review pending.",
  }),
  UT: R({ code: "UT", name: "Utah", status: "registration", statute: "Utah Code § 13-21-101 et seq. (Credit Services Organizations Act)", registration: unknown, bond: null, cancellationDays: null, source: "https://le.utah.gov/xcode/Title13/Chapter21/13-21.html", verified: false, unconfirmed: ["Registration, bond and fee"] }),
  VT: R({ code: "VT", name: "Vermont", status: "not_reviewed", statute: null, registration: unknown, bond: null, cancellationDays: null, source: "https://legislature.vermont.gov/statutes/", verified: false, unconfirmed: ["How Vermont regulates credit repair"] }),
  VA: R({
    code: "VA",
    name: "Virginia",
    status: "registration",
    statute: "Va. Code §§ 59.1-335.1 to 59.1-335.12 (Virginia Credit Services Businesses Act)",
    registration: { required: true, agency: "Virginia Department of Agriculture and Consumer Services (registration statement; changes within 90 days, § 59.1-335.3)" },
    bond: "Bond or FDIC-insured bank letter of credit with the Commissioner: 100× the standard fee, at least $5,000, at most $50,000, kept 2 years after closing (§ 59.1-335.4)",
    cancellationDays: null,
    source: "https://law.lis.virginia.gov/vacode/title59.1/chapter25.1/",
    verified: true,
    unconfirmed: ["Registration fee", "Cancellation period"],
  }),
  WA: R({
    code: "WA",
    name: "Washington",
    status: "registration",
    statute: "RCW 19.134 (Credit Services Organizations Act), amended by ESHB 1311 (2023)",
    registration: { required: null, agency: null },
    bond: "$10,000 surety bond (or trust account) (RCW 19.134.020–.030)",
    cancellationDays: 5,
    cancellationNote: "Until midnight of the fifth working day after signing (RCW 19.134.060, 2023 text); notice may be delivered electronically.",
    contract: ["Information statement before the contract (RCW 19.134.040)", "Contract terms (RCW 19.134.050–.060)"],
    source: "https://lawfilesext.leg.wa.gov/law/RCWArchive/2023/RCW%20%2019%20.134%20%20CHAPTER.htm",
    verified: true,
    unconfirmed: ["Whether a state registration is filed, and where"],
  }),
  WV: R({ code: "WV", name: "West Virginia", status: "registration", statute: "W. Va. Code § 46A-6C-1 et seq. (credit services organizations)", registration: unknown, bond: null, cancellationDays: null, source: "https://code.wvlegislature.gov/46A-6C/", verified: false, unconfirmed: ["Registration, bond and fee"] }),
  WI: R({ code: "WI", name: "Wisconsin", status: "registration", statute: "Wis. Stat. § 422.501 (credit services organizations)", registration: { required: true, agency: "Wisconsin Department of Financial Institutions (unconfirmed)" }, bond: null, cancellationDays: null, source: "https://dfi.wi.gov/Documents/FinancialServices/LicensedFinancial/Forms/CreditServiceOrganization/CSOSampleRTC.pdf", verified: false, unconfirmed: ["Registration, bond and fee; the DFI publishes a sample right-to-cancel form"] }),
  WY: R({ code: "WY", name: "Wyoming", status: "not_reviewed", statute: null, registration: unknown, bond: null, cancellationDays: null, source: "https://wyoleg.gov/StateStatutes/StatutesConstitution", verified: false, unconfirmed: ["How Wyoming regulates credit repair (a low-quality source claims it bars it)"] }),
};

/** What it takes to open a state, in plain words, for the checklist. */
export function openingSteps(rule: StateRule, locale: "es" | "en" = "en"): string[] {
  const es = locale === "es";
  const steps: string[] = [];
  if (rule.status === "restricted") steps.push(es ? "La ley lo restringe: no abrir sin una opinión específica del abogado y un cambio de código." : "The law restricts it: do not open without a specific attorney opinion and a code change.");
  if (rule.status === "not_reviewed") steps.push(es ? "Investigar la ley del estado (no revisado)." : "Research the state's law (not reviewed).");
  if (rule.registration.required) steps.push(es ? `Registro o licencia: ${rule.registration.agency ?? "agencia por confirmar"}.` : `Registration or license: ${rule.registration.agency ?? "agency to confirm"}.`);
  if (rule.bond) steps.push(es ? `Fianza: ${rule.bond}.` : `Bond: ${rule.bond}.`);
  if (rule.cancellationDays) steps.push(es ? `Plazo para cancelar de ${rule.cancellationDays} días hábiles en el contrato.` : `${rule.cancellationDays}-working-day cancellation period in the contract.`);
  if (rule.contract.length > 0) steps.push(es ? "Documentos del contrato y declaraciones del estado (texto del abogado)." : "The state's contract and disclosure documents (attorney text).");
  steps.push(es ? "Revisión del abogado del estado, con su nombre y la fecha." : "Attorney review for the state, with their name and the date.");
  if (!rule.verified) steps.push(es ? "Confirmar cada dato con la fuente oficial (sin verificar)." : "Confirm every fact with the official source (unverified).");
  return steps;
}
