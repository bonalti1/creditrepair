import { MAX_HTML_BYTES, MAX_LETTER_FILE_BYTES, MAX_PHOTO_FILE_BYTES, MAX_REPORT_FILE_BYTES } from "./config";

// What an upload is, decided from its first bytes, never from its name or
// the type the browser claims. Each intake takes only the kinds it can read:
//
//   credit report   PDF, or a saved page (HTML) / its text
//   ID, address     JPEG, PNG or PDF
//   bureau letter   JPEG, PNG or PDF
//
// HEIC (an iPhone's default photo format) is recognised and refused with a
// way out: the API reads JPEG, PNG, GIF and WebP images, and converting HEIC
// on the server would need a new library. On an iPhone, sharing the photo or
// taking a screenshot gives a JPEG/PNG, and Settings > Camera > Formats >
// "Most Compatible" makes the camera save JPEG.

export type FileKind = "pdf" | "jpeg" | "png" | "heic" | "html" | "text" | "unknown";

export function sniffFile(bytes: Uint8Array): FileKind {
  const b = bytes;
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return "pdf"; // %PDF-
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!);
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(brand)) return "heic";
  }
  // Text: no NUL bytes in the first 4 KB and it decodes as UTF-8.
  const head = b.subarray(0, Math.min(b.length, 4096));
  if (head.length === 0 || head.includes(0)) return "unknown";
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(head.length < b.length ? trimToCharBoundary(head) : head);
  } catch {
    return "unknown";
  }
  return /<(!doctype html|html|head|body|table|div)\b/i.test(text.replace(/^﻿/, "").slice(0, 4096)) ? "html" : "text";
}

/** Cut a UTF-8 prefix so it does not end in the middle of a character. */
function trimToCharBoundary(bytes: Uint8Array): Uint8Array {
  let end = bytes.length;
  // Step back over continuation bytes (10xxxxxx) and the lead byte they belong to.
  let back = 0;
  while (end > 0 && back < 4 && (bytes[end - 1]! & 0xc0) === 0x80) {
    end--;
    back++;
  }
  if (end > 0 && bytes[end - 1]! >= 0xc0) end--;
  return bytes.subarray(0, end);
}

export type IntakePurpose = "credit_report" | "identity" | "bureau_letter";

const ACCEPTS: Record<IntakePurpose, readonly FileKind[]> = {
  credit_report: ["pdf", "html", "text"],
  identity: ["jpeg", "png", "pdf"],
  bureau_letter: ["jpeg", "png", "pdf"],
};

function maxBytes(purpose: IntakePurpose, kind: FileKind): number {
  if (kind === "html" || kind === "text") return MAX_HTML_BYTES;
  if (purpose === "credit_report") return MAX_REPORT_FILE_BYTES;
  if (purpose === "bureau_letter") return MAX_LETTER_FILE_BYTES;
  return MAX_PHOTO_FILE_BYTES;
}

const MB = (bytes: number) => `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;

export type FileCheck =
  | { ok: true; kind: Exclude<FileKind, "heic" | "unknown">; mediaType: string; extension: string }
  | { ok: false; status: 413 | 415 | 400; message: string };

const MEDIA: Record<string, [mediaType: string, extension: string]> = {
  pdf: ["application/pdf", "pdf"],
  jpeg: ["image/jpeg", "jpg"],
  png: ["image/png", "png"],
  html: ["text/html", "html"],
  text: ["text/plain", "txt"],
};

/** Whether this upload may go to this intake, and if not, why in plain Spanish. */
export function checkUpload(purpose: IntakePurpose, bytes: Uint8Array): FileCheck {
  if (bytes.length === 0) return { ok: false, status: 400, message: "El archivo está vacío." };
  const kind = sniffFile(bytes);
  if (kind === "heic") {
    return {
      ok: false,
      status: 415,
      message:
        "Esta foto está en formato HEIC (el de iPhone) y no la podemos leer. Envíala como JPG: compártela desde Fotos o toma una captura de pantalla, o en Ajustes › Cámara › Formatos elige «Más compatible».",
    };
  }
  if (kind === "unknown" || !ACCEPTS[purpose].includes(kind)) {
    const accepted = purpose === "credit_report" ? "un PDF o la página del reporte guardada (.html)" : "una foto JPG o PNG, o un PDF";
    return { ok: false, status: 415, message: `Este archivo no es ${accepted}.` };
  }
  const limit = maxBytes(purpose, kind);
  if (bytes.length > limit) return { ok: false, status: 413, message: `El archivo pesa ${MB(bytes.length)}. El máximo es ${MB(limit)}.` };
  const [mediaType, extension] = MEDIA[kind]!;
  return { ok: true, kind, mediaType, extension };
}

/** The largest upload any intake route reads, to refuse a bigger body before reading it. */
export const MAX_ANY_UPLOAD_BYTES = Math.max(MAX_REPORT_FILE_BYTES, MAX_LETTER_FILE_BYTES, MAX_PHOTO_FILE_BYTES, MAX_HTML_BYTES);
