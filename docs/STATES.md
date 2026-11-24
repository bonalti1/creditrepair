# States: where Credalti can sell

**Every state needs an attorney's review before it is opened. Texas included.**
This page and `src/lib/compliance/stateRules.ts` are research, not legal
advice: leads for counsel, with the source of each one.

Code: `src/lib/compliance/stateRules.ts` (the checklist, one entry per state
and DC), `src/lib/compliance/states.ts` (open / waitlist / blocked, and what
opening needs), `src/lib/compliance/stateOpenings.ts` (the switches on the
database), `src/lib/agreement/stateDocuments.ts` (which states the agreement
has documents for). Screen: `/equipo/estados`. Database:
`supabase/migrations/0030_state_openings.sql`. Tests:
`src/lib/__tests__/stateRules.test.ts`, `src/lib/__tests__/db/bestPractices.test.ts`.

## How it was researched

On 2026-11-24, by web search of the statutes and the regulators' own pages.
The build environment could not open most government sites directly
(ecfr.gov, govinfo.gov, law.cornell.edu were blocked), so pages were read
through search results. Each entry has:

- `verified: true`: the main facts (that the law exists, who registers it,
  the bond) were seen in the statute's text or the regulator's page. Its
  `unconfirmed` list says what was not (often a fee or the cancellation
  period).
- `verified: false`: only secondary sources (vendor blogs, surety sellers,
  older compilations), or the statute's citation from memory, back it. Every
  field is a lead. Nothing was invented: an unknown amount or agency is empty.

The federal floor applies everywhere and is already built: the Credit Repair
Organizations Act (15 U.S.C. § 1679 et seq.): the disclosure before the
contract, a written contract, 3 business days to cancel, no payment before
the service is performed. The table lists only what a state adds.

## Summary

| | States |
| --- | --- |
| No state registration found (federal rules) | 6: AL, AK, MI, NJ, NY, SD (only NY is verified; the others need the absence of a law confirmed) |
| Registration, license or bond needed | 33 |
| Restricted | 1: Georgia (O.C.G.A. § 16-9-59 makes operating a credit repair services organization a misdemeanor; a 2025–2026 exemption bill was not confirmed as enacted) |
| Not reviewed | 11: HI, KY, MA, MS, MT, NM, ND, OR, RI, VT, WY |
| Verified against the official source | 15: AZ, CA, FL, GA, IL, LA, MD, NV, NY, NC, OH, PA, TX, VA, WA |

Big markets: TX, CA, FL, NY, IL, AZ, GA, NC, NV, PA, OH, VA, WA are verified;
NJ (no specific statute found, only a practitioner says so), CO (the 2024
yearly notification to the Attorney General; bond unconfirmed) and MI (the
Act exists; whether it asks for a registration or bond was not confirmed)
are not.

Cancellation longer than 3 business days (the contract must say so):
**California and Washington, 5 working days** (verified). Illinois and
Florida are reported as 5 days by secondary sources only.

## What the app enforces

- **Opened states.** `state_openings` (migration 0030): Texas starts opened
  (the launch state); every other state starts closed. An administrator
  (`states.manage`) opens a state in `/equipo/estados` only with the
  attorney's name and review date, the registration or license number where
  the law asks for one, and the bond confirmed where it asks for one
  (`openingProblems`). A restricted state cannot be opened from the screen,
  the server or the database (a check constraint for Georgia). Every change
  is in the team's audit. A read that fails counts only Texas: a failure can
  close a state, never open one.
- **Leads, invitations, signups.** From a state not opened:
  - the onboarding state step shows "We are not in <state> yet", with the
    waitlist form (a restricted state: an explanation, no form);
  - `/api/profile/onboarding` refuses the state (409 `state_not_open`);
  - the invite page and "Add a client" say the link leads to the waitlist;
  - a HighLevel lead goes to the waitlist (`source: highlevel`, phone or
    email), not to sales; HighLevel's receipt says `waitlisted`;
  - the agreement routes refuse to acknowledge or sign (409 `state_not_open`).
- **The agreement per state.** The agreement's documents exist for Texas
  only (`stateDocuments.ts`). A client in any other state sees "Your
  agreement for <state> is being prepared" and cannot sign, in the demo too
  (`agreementReadiness`, `stateDocuments`), until that state's documents are
  written by the attorney, built and approved. Opening a state does not
  change that.
- Partner referrals still accept any state; the person they refer meets the
  same state step.

## For the attorney

1. For each state we want next (CA, FL, IL, NY, AZ first: the largest
   Spanish-speaking markets), confirm the entry, the registration, the bond
   and whether Credalti's model (no fee before a round is mailed) changes
   what is required (Florida and Illinois tie the bond to charging before
   full performance).
2. Write that state's disclosure, contract section and cancellation notice
   (California and Washington: 5 working days).
3. Georgia: is there any lawful path for a for-profit company today?
4. New Jersey, Michigan, Alabama, Alaska, South Dakota: confirm that no
   state registration applies.

## The table

| State | Status | Law | Registration | Bond | Cancellation | Verified | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Alabama (AL) | No state registration found | None found | None found | — | 3 business days (federal) | No | [source](https://www.lexingtonlaw.com/blog/credit-repair/credit-repair-laws.html) |
| Alaska (AK) | No state registration found | None found | None found | — | 3 business days (federal) | No | [source](https://www.lexingtonlaw.com/blog/credit-repair/credit-repair-laws.html) |
| Arizona (AZ) | Registration / bond needed | A.R.S. §§ 44-1701 to 44-1713 (credit services organizations) | Arizona Corporation Commission (bond copy filed with the Corporations Division records section) | Surety bond under § 44-1708, adjusted yearly; reported as 5% of the prior 12 months' fees, $5,000 minimum, $25,000 maximum (unconfirmed) | 3 business days (federal) | Yes | [source](https://azleg.gov/ars/44/01708.htm) |
| Arkansas (AR) | Registration / bond needed | Ark. Code Ann. § 4-91-101 et seq. (Credit Services Organizations Act) | Arkansas Secretary of State | $10,000 (unconfirmed) | 3 business days (federal) | No | [source](https://law.justia.com/codes/arkansas/title-4/subtitle-7/chapter-91/) |
| California (CA) | Registration / bond needed | Cal. Civ. Code §§ 1789.10–1789.26 (Credit Services Act of 1984) | California Department of Justice (Attorney General), before doing business (§ 1789.25) | $100,000 surety bond from an admitted surety; copy filed with the Secretary of State; kept 2 years after ceasing business (§ 1789.18) | 5 working days | Yes | [source](https://www.oag.ca.gov/consumers/general/csoform) |
| Colorado (CO) | Registration / bond needed | C.R.S. § 5-19-101 et seq. (Colorado Credit Services Organization Act, Part 1) | Colorado Attorney General (yearly notification, § 5-19-110 as amended in 2024) | — | 3 business days (federal) | No | [source](https://coag.gov/file-a-complaint/credit-services-organizations/) |
| Connecticut (CT) | Registration / bond needed | Conn. Gen. Stat. § 36a-695 et seq. (credit clinics) | Connecticut Department of Banking (credit clinic license) | — | 3 business days (federal) | No | [source](https://portal.ct.gov/dob) |
| District of Columbia (DC) | Registration / bond needed | D.C. Code § 28-4601 et seq. (credit services organizations) | To confirm | — | 3 business days (federal) | No | [source](https://code.dccouncil.gov/us/dc/council/code/titles/28/chapters/46) |
| Delaware (DE) | Registration / bond needed | 6 Del. C. § 2401 et seq. (Credit Services Organization Act) | To confirm | — | 3 business days (federal) | No | [source](https://delcode.delaware.gov/title6/c024/index.html) |
| Florida (FL) | Registration / bond needed | Fla. Stat. §§ 817.7001–817.706 (Credit Service Organizations) | None found | $10,000 surety bond (or trust account) required before taking any money ahead of full performance (§ 817.7005) | 3 business days (federal) | Yes | [source](https://flsenate.gov/Laws/Statutes/2019/817.7005) |
| Georgia (GA) | Restricted | O.C.G.A. § 16-9-59 (operating a credit repair services organization) | To confirm | — | 3 business days (federal) | Yes | [source](https://law.justia.com/codes/georgia/2022/title-16/chapter-9/article-4/section-16-9-59/) |
| Hawaii (HI) | Not reviewed | Haw. Rev. Stat. ch. 481B (unconfirmed) | To confirm | — | 3 business days (federal) | No | [source](https://www.capitol.hawaii.gov/hrscurrent/) |
| Idaho (ID) | Registration / bond needed | Idaho Code § 26-2222 et seq. (Idaho Collection Agency Act, which reaches credit repair) (unconfirmed) | Idaho Department of Finance (license) (unconfirmed) | — | 3 business days (federal) | No | [source](https://www.finance.idaho.gov/) |
| Illinois (IL) | Registration / bond needed | 815 ILCS 605 (Credit Services Organizations Act) | Illinois Secretary of State, before conducting business | $100,000 surety bond on the state's form, copy filed with the Secretary of State's Index Department (§§ 605/5, 605/10) | 3 business days (federal) | Yes | [source](https://ilga.gov/legislation/ilcs/documents/081506050K10.htm) |
| Indiana (IN) | Registration / bond needed | Ind. Code § 24-5-15 (credit services organizations) | Indiana Secretary of State (unconfirmed) | — | 3 business days (federal) | No | [source](https://iga.in.gov/laws/2024/ic/titles/24) |
| Iowa (IA) | Registration / bond needed | Iowa Code ch. 538A (credit services organizations) | To confirm | — | 3 business days (federal) | No | [source](https://www.legis.iowa.gov/law/iowaCode) |
| Kansas (KS) | Registration / bond needed | K.S.A. § 50-1116 et seq. (Kansas Credit Services Organization Act) | Office of the State Bank Commissioner (unconfirmed) | — | 3 business days (federal) | No | [source](https://www.osbckansas.org/) |
| Kentucky (KY) | Not reviewed | None found | To confirm | — | 3 business days (federal) | No | [source](https://www.lexingtonlaw.com/blog/credit-repair/credit-repair-laws.html) |
| Louisiana (LA) | Registration / bond needed | La. R.S. 9:3573.1 et seq. (Credit Repair Services Organization Act) | Louisiana Attorney General | $100,000 surety bond from a company licensed in Louisiana, filed with the Attorney General, before doing business (La. R.S. 9:3573.4) | 3 business days (federal) | Yes | [source](https://ag.louisiana.gov/Page/CreditRepairServices) |
| Maine (ME) | Registration / bond needed | 9-A M.R.S. § 10-101 et seq. (credit services organizations) | Maine Bureau of Consumer Credit Protection (unconfirmed) | — | 3 business days (federal) | No | [source](https://www.maine.gov/pfr/consumercredit/) |
| Maryland (MD) | Registration / bond needed | Md. Code, Com. Law § 14-1901 et seq. (Maryland Credit Services Businesses Act) | Commissioner of Financial Regulation (license for the principal executive office; branches disclosed) | Surety bond on the Commissioner's form; reported as $50,000 base plus $50,000 per branch (vendor source, unconfirmed) | 3 business days (federal) | Yes | [source](https://labor.maryland.gov/FINANCE/industry/creditserv.shtml) |
| Massachusetts (MA) | Not reviewed | M.G.L. c. 93, §§ 68A–68E (credit services organizations) (unconfirmed) | To confirm | — | 3 business days (federal) | No | [source](https://malegislature.gov/Laws/GeneralLaws/PartI/TitleXV/Chapter93) |
| Michigan (MI) | No state registration found | MCL 445.1821–445.1826 (Credit Services Protection Act, 1994 PA 160) | To confirm | — | 3 business days (federal) | No | [source](https://www.legislature.mi.gov/documents/mcl/pdf/MCL-445-1821.pdf) |
| Minnesota (MN) | Registration / bond needed | Minn. Stat. § 332.52 et seq. (credit services organizations) | Minnesota Department of Commerce (unconfirmed) | — | 3 business days (federal) | No | [source](https://www.revisor.mn.gov/statutes/cite/332.52) |
| Mississippi (MS) | Not reviewed | None found | To confirm | — | 3 business days (federal) | No | [source](https://law.justia.com/codes/mississippi/) |
| Missouri (MO) | Registration / bond needed | Mo. Rev. Stat. § 407.635 et seq. (credit services organizations) | Missouri Division of Finance (credit service organization registration) | — | 3 business days (federal) | No | [source](https://finance.mo.gov/consumer-credit-licensing/credit-service-organizations) |
| Montana (MT) | Not reviewed | None found | To confirm | — | 3 business days (federal) | No | [source](https://leg.mt.gov/bills/mca/) |
| Nebraska (NE) | Registration / bond needed | Neb. Rev. Stat. § 45-801 et seq. (Credit Services Organization Act) | To confirm | — | 3 business days (federal) | No | [source](https://nebraskalegislature.gov/laws/browse-chapters.php?chapter=45) |
| Nevada (NV) | Registration / bond needed | NRS 598.741–598.787 (credit service organizations) | Nevada Division of Mortgage Lending (certificate of registration) | Security on file with the Commissioner (NRS 598.726), released six months after ceasing business; amount not confirmed | 3 business days (federal) | Yes | [source](https://mld.nv.gov/Industry/Credit_Service_Organizations/Credit_Service_Organizations_-_NRS_598) |
| New Hampshire (NH) | Registration / bond needed | RSA ch. 359-D (credit services organizations) | To confirm | — | 3 business days (federal) | No | [source](https://www.gencourt.state.nh.us/rsa/html/NHTOC/NHTOC-XXXI-359-D.htm) |
| New Jersey (NJ) | No state registration found | None found | None found | — | 3 business days (federal) | No | [source](https://law.justia.com/codes/new-jersey/title-17/section-17-16g-5/) |
| New Mexico (NM) | Not reviewed | None found | To confirm | — | 3 business days (federal) | No | [source](https://nmonesource.com/) |
| New York (NY) | No state registration found | N.Y. Gen. Bus. Law art. 28-BB, §§ 458-a–458-k (credit services businesses) | None found | — | 3 business days (federal) | Yes | [source](https://www.nysenate.gov/legislation/laws/GBS/458-F) |
| North Carolina (NC) | Registration / bond needed | N.C. Gen. Stat. §§ 66-220 to 66-226 (Credit Repair Services Act) | None found | Every credit repair business must obtain a surety bond (or trust account with a licensed bank) (§ 66-222); amount not confirmed | 3 business days (federal) | Yes | [source](https://ncleg.gov/EnactedLegislation/Statutes/HTML/ByArticle/Chapter_66/Article_30.html) |
| North Dakota (ND) | Not reviewed | None found | To confirm | — | 3 business days (federal) | No | [source](https://www.ndlegis.gov/general-information/north-dakota-century-code) |
| Ohio (OH) | Registration / bond needed | Ohio Rev. Code ch. 4712 (Ohio Credit Services Organization Act) | Ohio Division of Financial Institutions | $50,000, filed with the Division, kept 2 years after ceasing business (§ 4712.06, 2017 text) | 3 business days (federal) | Yes | [source](https://codes.ohio.gov/ohio-revised-code/chapter-4712) |
| Oklahoma (OK) | Registration / bond needed | Okla. Stat. tit. 24, § 131 et seq. (Credit Services Organization Act) | To confirm | — | 3 business days (federal) | No | [source](https://www.oscn.net/applications/oscn/index.asp?ftdb=STOKST24) |
| Oregon (OR) | Not reviewed | None found | To confirm | — | 3 business days (federal) | No | [source](https://www.oregonlegislature.gov/bills_laws/) |
| Pennsylvania (PA) | Registration / bond needed | 73 P.S. §§ 2181–2192 (Credit Services Act) | Pennsylvania Department of Banking and Securities (through the DoBS Portal) | Surety bond or trust account under § 2187; the state's bond form says not less than $5,000 nor more than $25,000 | 3 business days (federal) | Yes | [source](https://www.dobs.pa.gov/Documents/Statutes/Credit%20Services%20Act.pdf) |
| Rhode Island (RI) | Not reviewed | None found | To confirm | — | 3 business days (federal) | No | [source](https://webserver.rilegislature.gov/Statutes/) |
| South Carolina (SC) | Registration / bond needed | S.C. Code § 37-7-101 et seq. (Credit Services Organization Act) | South Carolina Department of Consumer Affairs (unconfirmed) | — | 3 business days (federal) | No | [source](https://consumer.sc.gov/) |
| South Dakota (SD) | No state registration found | None found | None found | — | 3 business days (federal) | No | [source](https://sdlegislature.gov/Statutes) |
| Tennessee (TN) | Registration / bond needed | Tenn. Code § 47-18-1001 et seq. (Credit Services Businesses Act) | To confirm | — | 3 business days (federal) | No | [source](https://www.tn.gov/attorneygeneral.html) |
| Texas (TX) | Registration / bond needed | Tex. Fin. Code ch. 393 (credit services organizations) | Texas Secretary of State, before conducting business (§ 393.101) | $10,000 surety bond or surety account, copy filed with the Secretary of State (§§ 393.401–393.403) | 3 business days (federal) | Yes | [source](https://statutes.capitol.texas.gov/Docs/FI/htm/FI.393.htm) |
| Utah (UT) | Registration / bond needed | Utah Code § 13-21-101 et seq. (Credit Services Organizations Act) | To confirm | — | 3 business days (federal) | No | [source](https://le.utah.gov/xcode/Title13/Chapter21/13-21.html) |
| Vermont (VT) | Not reviewed | None found | To confirm | — | 3 business days (federal) | No | [source](https://legislature.vermont.gov/statutes/) |
| Virginia (VA) | Registration / bond needed | Va. Code §§ 59.1-335.1 to 59.1-335.12 (Virginia Credit Services Businesses Act) | Virginia Department of Agriculture and Consumer Services (registration statement; changes within 90 days, § 59.1-335.3) | Bond or FDIC-insured bank letter of credit with the Commissioner: 100× the standard fee, at least $5,000, at most $50,000, kept 2 years after closing (§ 59.1-335.4) | 3 business days (federal) | Yes | [source](https://law.lis.virginia.gov/vacode/title59.1/chapter25.1/) |
| Washington (WA) | Registration / bond needed | RCW 19.134 (Credit Services Organizations Act), amended by ESHB 1311 (2023) | To confirm | $10,000 surety bond (or trust account) (RCW 19.134.020–.030) | 5 working days | Yes | [source](https://lawfilesext.leg.wa.gov/law/RCWArchive/2023/RCW%20%2019%20.134%20%20CHAPTER.htm) |
| West Virginia (WV) | Registration / bond needed | W. Va. Code § 46A-6C-1 et seq. (credit services organizations) | To confirm | — | 3 business days (federal) | No | [source](https://code.wvlegislature.gov/46A-6C/) |
| Wisconsin (WI) | Registration / bond needed | Wis. Stat. § 422.501 (credit services organizations) | Wisconsin Department of Financial Institutions (unconfirmed) | — | 3 business days (federal) | No | [source](https://dfi.wi.gov/Documents/FinancialServices/LicensedFinancial/Forms/CreditServiceOrganization/CSOSampleRTC.pdf) |
| Wyoming (WY) | Not reviewed | None found | To confirm | — | 3 business days (federal) | No | [source](https://wyoleg.gov/StateStatutes/StatutesConstitution) |

