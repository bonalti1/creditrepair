import { parseUsAddress, type UsAddress } from "../mail/address";
import type { MailClass } from "../mail/types";

// Lob client (spec §4.2): prints and mails letters. Under full service the team
// sends them (staff may also print a batch locally, staff/printBatch.ts); in
// self-serve mode they go out when the client presses the approve button. Thin fetch wrapper — no SDK
// dependency. Returns a queued placeholder when no API key is configured so the
// rest of the pipeline is testable end-to-end without a Lob account; the
// console calls that "simulado".
//
// What was checked, and against what (2026-11-21). Lob's documentation sites
// could not be opened from the build environment; the request shape was read
// from Lob's official TypeScript SDK (@lob/lob-typescript-sdk 1.4.2, generated
// from Lob's OpenAPI spec 1.3.0: models LetterEditable, AddressEditable,
// MailType, LtrUseType, and the letters API's request code):
//   VERIFIED  POST https://api.lob.com/v1/letters, HTTP Basic auth with the key
//             as the user name, JSON body, "Idempotency-Key" header (≤ 256 chars).
//   VERIFIED  to / from as inline objects: name, company, address_line1,
//             address_line2 (each ≤ 64 characters for US addresses),
//             address_city, address_state, address_zip ("5 or 9 digits"),
//             address_country ("US").
//   VERIFIED  color (boolean, required), double_sided (boolean, default true),
//             mail_type "usps_first_class", use_type "operational" (required
//             unless the account sets a default), address_placement
//             "insert_blank_page", extra_service "certified" |
//             "certified_return_receipt" ("an electronic copy of the
//             recipient's signature"), only for domestic First Class.
//   VERIFIED  the response's tracking_number ("Dummy tracking numbers are not
//             created in test mode") and expected_delivery_date.
//   UNVERIFIED  `file` as an inline HTML string: the SDK's text names only "PDF
//             file"; Lob's guides describe HTML strings and an HTML size limit
//             we take as 10,000 characters (LOB_HTML_MAX_CHARS).
//   UNVERIFIED  the 40-character limit on `name` (LOB_NAME_MAX).

const LOB_LETTERS_URL = "https://api.lob.com/v1/letters";

/**
 * Where the recipient's address is printed. "insert_blank_page" adds a blank
 * first page that carries the address for the envelope window (charged as one
 * page), so our letter's own first page is printed as written. The default
 * ("top_first_page") would print Lob's address block over the top of it.
 */
export const ADDRESS_PLACEMENT = "insert_blank_page";

/** Letters print black and white unless asked otherwise: an ID photo reads fine, and it costs less. */
export const DEFAULT_COLOR = false;
/** One side per sheet: an enclosure (an ID photo) never shares a sheet with the letter. */
export const DEFAULT_DOUBLE_SIDED = false;

/** UNVERIFIED: the longest inline HTML Lob accepts in `file`. Longer documents would need a hosted PDF. */
export const LOB_HTML_MAX_CHARS = 10_000;
/** UNVERIFIED: the longest `name` / `company` Lob accepts on an address. */
export const LOB_NAME_MAX = 40;

/** Our mail class → Lob's extra_service (VERIFIED values). First class has none. */
export const LOB_EXTRA_SERVICE: Record<MailClass, string | null> = {
  first_class: null,
  certified: "certified",
  certified_return_receipt: "certified_return_receipt",
};

export interface MailAddress {
  name: string;
  addressLines: string[];
}

export interface MailResult {
  provider: "lob" | "stub";
  externalId: string;
  status: "queued" | "submitted";
  mailClass: MailClass;
  /** Certified letters only, and only once Lob has one (never in test mode). */
  trackingNumber: string | null;
  /** Lob's estimate (YYYY-MM-DD); null when it gave none. */
  expectedDeliveryDate: string | null;
}

/** An address that cannot be read: refused before anything is sent. */
export class MailAddressError extends Error {
  constructor(
    public readonly which: "to" | "from",
    message: string,
  ) {
    super(message);
    this.name = "MailAddressError";
  }
}

/**
 * A name that fits Lob's limit: a parenthetical note is dropped first, then
 * whole words from the end. The letter itself prints the full name; this is
 * only the address block.
 */
export function fitLobName(name: string, max = LOB_NAME_MAX): string {
  const plain = name.replace(/\s+/g, " ").trim();
  if (plain.length <= max) return plain;
  const noNote = plain.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
  if (noNote.length <= max) return noNote;
  const words = noNote.split(" ");
  let out = "";
  for (const word of words) {
    const next = out ? `${out} ${word}` : word;
    if (next.length > max) break;
    out = next;
  }
  return out || noNote.slice(0, max);
}

/** One address as Lob's fields. Throws MailAddressError when the lines cannot be read. */
export function lobAddress(address: MailAddress, which: "to" | "from"): Record<string, string> {
  const parsed = parseUsAddress(address.addressLines);
  if (!parsed.ok) throw new MailAddressError(which, `${which === "to" ? "Recipient" : "Return"} address: ${parsed.message}`);
  const a: UsAddress = parsed.address;
  return {
    name: fitLobName(address.name),
    // An "Attn:" line rides in the company line, above the street.
    ...(a.attention ? { company: fitLobName(a.attention) } : {}),
    address_line1: a.line1,
    ...(a.line2 ? { address_line2: a.line2 } : {}),
    address_city: a.city,
    address_state: a.state,
    address_zip: a.zip,
    address_country: "US",
  };
}

export interface MailLetterParams {
  to: MailAddress;
  /**
   * The return address: printed on the envelope, and where the post office
   * sends the letter if it cannot be delivered. It is the client's own
   * address, because the letter is the client's: a dispute that comes from a
   * company's address may be treated as sent by a credit repair organization
   * (12 C.F.R. §1022.43(b)(2)). A returned letter then reaches the client,
   * and Lob's "returned to sender" event reaches us.
   */
  from: MailAddress;
  bodyHtml: string;
  /** Our letter id: the same key on a retry, so a letter is never mailed twice. */
  idempotencyKey: string;
  mailClass?: MailClass;
  color?: boolean;
  doubleSided?: boolean;
  description?: string;
  /** Up to 20 short tags Lob keeps with the letter (keys ≤ 40, values ≤ 500 characters). */
  metadata?: Record<string, string>;
}

/** The JSON body Lob receives for one letter. Pure, so it can be checked without a network. */
export function lobLetterRequest(params: MailLetterParams): Record<string, unknown> {
  if (params.bodyHtml.length > LOB_HTML_MAX_CHARS) {
    throw new Error(`Letter HTML is ${params.bodyHtml.length} characters; Lob accepts at most ${LOB_HTML_MAX_CHARS} inline.`);
  }
  const mailClass = params.mailClass ?? "first_class";
  const extra = LOB_EXTRA_SERVICE[mailClass];
  return {
    description: (params.description ?? `Letter ${params.idempotencyKey}`).slice(0, 255),
    to: lobAddress(params.to, "to"),
    from: lobAddress(params.from, "from"),
    file: params.bodyHtml,
    color: params.color ?? DEFAULT_COLOR,
    double_sided: params.doubleSided ?? DEFAULT_DOUBLE_SIDED,
    address_placement: ADDRESS_PLACEMENT,
    mail_type: "usps_first_class",
    use_type: "operational",
    ...(extra ? { extra_service: extra } : {}),
    ...(params.metadata ? { metadata: params.metadata } : {}),
  };
}

export function isLobConfigured(): boolean {
  return Boolean(process.env.LOB_API_KEY);
}

export async function mailLetter(params: MailLetterParams): Promise<MailResult> {
  const mailClass = params.mailClass ?? "first_class";
  // Built (and the addresses checked) before anything else, key or no key:
  // the simulated path refuses what the real one would.
  const body = lobLetterRequest(params);

  const apiKey = process.env.LOB_API_KEY;
  if (!apiKey) {
    return {
      provider: "stub",
      externalId: `stub_${params.idempotencyKey}`,
      status: "queued",
      mailClass,
      trackingNumber: null,
      expectedDeliveryDate: null,
    };
  }

  const res = await fetch(LOB_LETTERS_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
      "Content-Type": "application/json",
      "Idempotency-Key": params.idempotencyKey.slice(0, 256),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Lob error ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  const json = (await res.json()) as { id: string; tracking_number?: string | null; expected_delivery_date?: string | null };
  return {
    provider: "lob",
    externalId: json.id,
    status: "submitted",
    mailClass,
    trackingNumber: json.tracking_number ?? null,
    expectedDeliveryDate: json.expected_delivery_date ?? null,
  };
}
