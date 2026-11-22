import { formatUsAddress, parseUsAddress, type UsAddress } from "./address";

// Address verification before a letter is mailed: is this an address the
// post office delivers to, and how does it write it?
//
// Every round is checked before it leaves (rounds/send.ts, step 5b): the
// client's return address and each recipient's. What comes back decides:
//
//   deliverable    the post office knows it as written: mailed as is.
//   corrected      the post office knows it, written its way (ZIP+4, the
//                  suite, the street suffix): mailed to the standardized form,
//                  and the correction is logged.
//   ambiguous      deliverable to the building, but a unit is missing or may
//                  not exist: a letter may not reach the person.
//   undeliverable  the post office does not deliver there.
//   unchecked      no verification service is configured (no Lob key). The
//                  mail service is simulated then too, so nothing real goes;
//                  the address keeps the checks it always had (it must parse).
//
// For the CLIENT's address, ambiguous and undeliverable stop the round and the
// client is asked to confirm their address with one tap (autopilot follow-up
// "address_unconfirmed"). For a CREDITOR's address, they mark the address
// book's entry as not verified: the company becomes a missing address, for
// every client at once (gaps.ts). A bureau's address that fails stops the
// round for a person (the registry is checked by hand).
//
// Lob's US verification API, what was checked (2026-11-22, Lob's official
// TypeScript SDK @lob/lob-typescript-sdk 1.4.2, generated from Lob's OpenAPI
// spec 1.3.0: models UsVerificationsWritable, UsVerification, UsComponents,
// DeliverabilityAnalysis, and the UsVerificationsApi request code;
// docs.lob.com could not be opened from the build environment):
//   VERIFIED  POST https://api.lob.com/v1/us_verifications, HTTP Basic auth
//             with the key as the user name, JSON body with primary_line,
//             secondary_line, urbanization, city, state, zip_code ("94107",
//             "941072282" or "94107-2282"), optional recipient; or a single
//             `address` string instead.
//   VERIFIED  response: primary_line, secondary_line, urbanization, last_line
//             ("city, state, zip_code, zip_code_plus_4"), deliverability one
//             of deliverable | deliverable_unnecessary_unit |
//             deliverable_incorrect_unit | deliverable_missing_unit |
//             undeliverable, valid_address, components.city / state /
//             zip_code / zip_code_plus_4, deliverability_analysis.dpv_confirmation.
//   UNVERIFIED  the price of one verification (VERIFICATION_COST_MILLS): read
//             from a search excerpt of Lob's help page "AV pricing"
//             (per-request rate on the Developer plan, $0.05; lower on paid
//             plans; the first 300 a month free). Open help.lob.com before
//             relying on it.
//   UNVERIFIED  how Lob writes secondary_line for an address whose unit is
//             unnecessary: we use primary_line and secondary_line as returned.

/** UNVERIFIED (see above): what one US verification costs, in mills (1/1000 $). Shown in the send screen's cost. */
export const VERIFICATION_COST_MILLS = 50;

/** A verification newer than this is reused instead of paid for again. */
export const VERIFICATION_CACHE_DAYS = 30;

export type VerificationResult = "deliverable" | "corrected" | "ambiguous" | "undeliverable" | "unchecked";

export const LOB_DELIVERABILITY = [
  "deliverable",
  "deliverable_unnecessary_unit",
  "deliverable_incorrect_unit",
  "deliverable_missing_unit",
  "undeliverable",
] as const;

export type LobDeliverability = (typeof LOB_DELIVERABILITY)[number];

export interface VerifiedAddress {
  result: VerificationResult;
  /** Lob's own word, "simulado" without a key, "demo" in the demo. */
  deliverability: string;
  /** The lines to mail to: the standardized form when there is one, else the lines as given (formatted). */
  lines: string[];
  /** What the post office suggests, when the result is not usable but it found something close. */
  suggestion: string[];
  provider: "lob" | "stub" | "cache" | "demo";
  costMills: number;
}

/** True when a letter may go to (or from) this address. */
export function verificationPasses(result: VerificationResult): boolean {
  return result === "deliverable" || result === "corrected" || result === "unchecked";
}

/** The key a verification is cached under: the address as it parses, upper case, spaces folded. */
export function addressKey(lines: readonly string[]): string {
  const parsed = parseUsAddress([...lines]);
  const text = parsed.ok ? formatUsAddress(parsed.address).join(" | ") : lines.join(" | ");
  return text.toUpperCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim().slice(0, 300);
}

/** Lob's request body for one address (VERIFIED field names). The attention line is not sent: it is not part of the delivery point. */
export function lobVerificationRequest(address: UsAddress): Record<string, string> {
  const [zip] = address.zip.split("-");
  return {
    primary_line: address.line1,
    ...(address.line2 ? { secondary_line: address.line2 } : {}),
    city: address.city,
    state: address.state,
    zip_code: address.zip.includes("-") ? address.zip : zip!,
  };
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** The standardized lines Lob returned, with the attention line kept from the input. Empty when Lob gave too little. */
export function standardizedLines(response: unknown, attention: string | null): string[] {
  const r = obj(response);
  const c = obj(r.components);
  const primary = str(r.primary_line);
  const secondary = str(r.secondary_line);
  const city = str(c.city);
  const state = str(c.state);
  const zip = str(c.zip_code);
  const plus4 = str(c.zip_code_plus_4);
  if (!primary || !city || !state || !/^\d{5}$/.test(zip)) return [];
  const last = `${city}, ${state} ${zip}${/^\d{4}$/.test(plus4) ? `-${plus4}` : ""}`;
  return [...(attention ? [attention] : []), primary, ...(secondary ? [secondary] : []), last];
}

const fold = (lines: readonly string[]) => lines.join(" | ").toUpperCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim();

/**
 * What Lob's answer means for this address. Pure. `inputLines` are the lines
 * as given; "corrected" when the standardized form differs from them.
 */
export function interpretLobVerification(response: unknown, inputLines: readonly string[]): Omit<VerifiedAddress, "provider" | "costMills"> {
  const parsed = parseUsAddress([...inputLines]);
  const given = parsed.ok ? formatUsAddress(parsed.address) : [...inputLines];
  const attention = parsed.ok ? parsed.address.attention : null;
  const deliverability = str(obj(response).deliverability);
  const standard = standardizedLines(response, attention);
  const usable = standard.length > 0 && parseUsAddress(standard).ok;
  switch (deliverability as LobDeliverability) {
    case "deliverable":
    case "deliverable_unnecessary_unit": {
      if (!usable) return { result: "ambiguous", deliverability, lines: given, suggestion: [] };
      const same = fold(standard) === fold(given);
      return { result: same ? "deliverable" : "corrected", deliverability, lines: same ? given : standard, suggestion: [] };
    }
    case "deliverable_incorrect_unit":
    case "deliverable_missing_unit":
      return { result: "ambiguous", deliverability, lines: given, suggestion: usable ? standard : [] };
    case "undeliverable":
      return { result: "undeliverable", deliverability, lines: given, suggestion: usable && fold(standard) !== fold(given) ? standard : [] };
    default:
      // An answer we do not know: never treated as a pass.
      return { result: "ambiguous", deliverability: deliverability || "desconocido", lines: given, suggestion: [] };
  }
}

/** No verification service: the lines as they parse, labelled. The mail service is simulated in the same case. */
export function uncheckedAddress(lines: readonly string[]): VerifiedAddress {
  const parsed = parseUsAddress([...lines]);
  return { result: "unchecked", deliverability: "simulado", lines: parsed.ok ? formatUsAddress(parsed.address) : [...lines], suggestion: [], provider: "stub", costMills: 0 };
}

/**
 * DEMO: a stand-in that answers like the real service, from the address
 * itself, so the demo shows each case. Nobody's address is checked.
 *   - an address without a ZIP+4 comes back "corrected" with an invented +4;
 *   - an address that mentions "Interior" without a number is ambiguous
 *     (a unit is missing), with a suggestion;
 *   - "Old Street" (the old addresses on the demo reports) is undeliverable.
 */
export function demoVerify(lines: readonly string[]): VerifiedAddress {
  const parsed = parseUsAddress([...lines]);
  if (!parsed.ok) return { result: "undeliverable", deliverability: "undeliverable", lines: [...lines], suggestion: [], provider: "demo", costMills: VERIFICATION_COST_MILLS };
  const a = parsed.address;
  const given = formatUsAddress(a);
  const base = { provider: "demo" as const, costMills: VERIFICATION_COST_MILLS };
  if (/old street/i.test(a.line1)) return { ...base, result: "undeliverable", deliverability: "undeliverable", lines: given, suggestion: [] };
  if (/\binterior\b/i.test(a.line1) && !a.line2) {
    const suggestion = formatUsAddress({ ...a, line1: a.line1.replace(/\s*\binterior\b\s*/i, " ").trim(), line2: "Apt 1" });
    return { ...base, result: "ambiguous", deliverability: "deliverable_missing_unit", lines: given, suggestion };
  }
  if (!a.zip.includes("-")) {
    const plus4 = String(1000 + (a.line1.length * 97 + a.city.length * 31) % 9000);
    const lines2 = formatUsAddress({ ...a, line1: a.line1.toUpperCase(), line2: a.line2?.toUpperCase() ?? null, city: a.city.toUpperCase(), zip: `${a.zip}-${plus4}` });
    return { ...base, result: "corrected", deliverability: "deliverable", lines: lines2, suggestion: [] };
  }
  return { ...base, result: "deliverable", deliverability: "deliverable", lines: given, suggestion: [] };
}

/** "Corregida por el correo: 123 MAIN ST, HOUSTON, TX 77002-1234" — for logs and the client page. */
export function verificationLabel(v: Pick<VerifiedAddress, "result" | "lines">): string {
  switch (v.result) {
    case "deliverable":
      return "Verificada con los datos del correo (USPS)";
    case "corrected":
      return `Corregida con los datos del correo: ${v.lines.join(", ")}`;
    case "ambiguous":
      return "El correo no la pudo confirmar: falta o sobra el número de departamento";
    case "undeliverable":
      return "El correo no entrega en esa dirección";
    case "unchecked":
      return "Sin verificar (simulado: no hay clave de Lob)";
  }
}
