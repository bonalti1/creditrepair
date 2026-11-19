import { escapeHtml } from "./html";

// Enclosures: bureaus routinely refuse a mailed dispute that arrives without a
// copy of the sender's ID and proof of address. The customer uploads photos of
// both; each becomes its own page behind the letter.
//
// A letter only lists an enclosure that is physically attached. Photos can be
// attached (the print provider renders an image on a page). An uploaded PDF
// cannot be placed inside the HTML letter, so it is left out and not listed;
// the upload screen asks for photos for that reason.

export const ENCLOSURE_LABELS: Record<string, string> = {
  government_id: "Copy of government-issued photo ID",
  proof_of_address: "Proof of address (utility bill / bank statement)",
  ssn_card: "Copy of Social Security card",
  identity_theft_report: "Identity theft report (FTC)",
};

const IMAGE_EXTENSION = /\.(jpe?g|png|webp|heic|heif)$/i;

export function isAttachableImage(storagePath: string): boolean {
  return IMAGE_EXTENSION.test(storagePath);
}

export interface EnclosurePage {
  label: string;
  /** A URL the print provider can fetch when it renders the letter. */
  url: string;
}

export function enclosurePagesHtml(pages: EnclosurePage[]): string {
  return pages
    .map(
      (page) =>
        `<div style="page-break-before:always;font-family:Helvetica,Arial,sans-serif;font-size:10pt;">` +
        `<p style="margin:0 0 0.2in 0;">Enclosure: ${escapeHtml(page.label)}</p>` +
        `<img src="${escapeHtml(page.url)}" alt="" style="max-width:6.5in;max-height:8.5in;" />` +
        `</div>`,
    )
    .join("");
}

/** The complete document sent to the print provider: the letter, then one page per enclosure. */
export function letterHtml(input: { body: string; fontFamily: string; sizePt: number; enclosures?: EnclosurePage[] }): string {
  const family = input.fontFamily.replace(/[^\w\s,-]/g, "");
  return (
    `<html><body>` +
    `<div style="font-family:'${family}';font-size:${input.sizePt}pt;white-space:pre-wrap;">${escapeHtml(input.body)}</div>` +
    enclosurePagesHtml(input.enclosures ?? []) +
    `</body></html>`
  );
}
