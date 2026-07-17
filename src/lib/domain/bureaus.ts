import type { Bureau, LetterTarget } from "./types";

// ⚠️ OPEN ITEM (spec §8): verify ALL mailing addresses at build time against each
// bureau's current published dispute address. Do not trust this static list.
// Addresses below are placeholders to be confirmed before any letter is mailed.
export const PRIMARY_BUREAUS: Record<Bureau, LetterTarget> = {
  equifax: {
    type: "bureau",
    key: "equifax",
    name: "Equifax Information Services LLC",
    addressLines: ["P.O. Box 740256", "Atlanta, GA 30374"], // VERIFY_AT_BUILD
  },
  experian: {
    type: "bureau",
    key: "experian",
    name: "Experian",
    addressLines: ["P.O. Box 4500", "Allen, TX 75013"], // VERIFY_AT_BUILD
  },
  transunion: {
    type: "bureau",
    key: "transunion",
    name: "TransUnion Consumer Solutions",
    addressLines: ["P.O. Box 2000", "Chester, PA 19016"], // VERIFY_AT_BUILD
  },
};

// Secondary bureaus (spec §4.2): scoping beyond the big three is the Dispute Beast
// differentiation we duplicate. Same warning: verify every address at build time.
export const SECONDARY_BUREAUS: LetterTarget[] = [
  {
    type: "secondary_bureau",
    key: "lexisnexis",
    name: "LexisNexis Risk Solutions — Consumer Center",
    addressLines: ["P.O. Box 105108", "Atlanta, GA 30348"], // VERIFY_AT_BUILD
  },
  {
    type: "secondary_bureau",
    key: "sagestream",
    name: "SageStream LLC (LexisNexis Risk Solutions)",
    addressLines: ["P.O. Box 105108", "Atlanta, GA 30348"], // VERIFY_AT_BUILD
  },
  {
    type: "secondary_bureau",
    key: "innovis",
    name: "Innovis Consumer Assistance",
    addressLines: ["P.O. Box 1689", "Pittsburgh, PA 15230"], // VERIFY_AT_BUILD
  },
  {
    type: "secondary_bureau",
    key: "corelogic",
    name: "CoreLogic Credco Consumer Assistance",
    addressLines: ["P.O. Box 509124", "San Diego, CA 92150"], // VERIFY_AT_BUILD
  },
  {
    type: "secondary_bureau",
    key: "ars",
    name: "Advanced Resolution Services (ARS)",
    addressLines: ["5005 Rockside Road, Suite 600", "Independence, OH 44131"], // VERIFY_AT_BUILD
  },
  {
    type: "secondary_bureau",
    key: "clarity",
    name: "Clarity Services, Inc. (Experian)",
    addressLines: ["P.O. Box 5717", "Clearwater, FL 33758"], // VERIFY_AT_BUILD
  },
];

export const ALL_BUREAU_KEYS = Object.keys(PRIMARY_BUREAUS) as Bureau[];
