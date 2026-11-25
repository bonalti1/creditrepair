// Files for content pieces: what may be uploaded, how big, and where it goes.
// The pattern is intake's (src/lib/intake/files.ts): the type is decided from
// the file's first bytes, never from its name or what the browser claims, and
// the file lives in a private bucket ("content-assets", migration 0035) that
// only the server reads; people see it through short-lived signed links.
//
// Pictures and PDFs (up to 20 MB) come through the server, which reads their
// first bytes before keeping them. Videos (up to 500 MB) are too large to pass
// through a server function, so the server hands the browser a one-time
// signed upload link for one path, then reads the file's first bytes from
// storage before recording it; a file that is not what it claims is deleted.
// On Supabase the bucket itself enforces the size and the types too.

export const CONTENT_BUCKET = "content-assets";

export const ASSET_LIMITS = {
  imageBytes: 20 * 1024 * 1024,
  pdfBytes: 20 * 1024 * 1024,
  videoBytes: 500 * 1024 * 1024,
  perPiece: 20,
} as const;

export const ASSET_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf", "video/mp4", "video/quicktime", "video/webm"] as const;
export type AssetMediaType = (typeof ASSET_TYPES)[number];

const EXTENSION: Record<AssetMediaType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

export function isAssetType(value: string): value is AssetMediaType {
  return (ASSET_TYPES as readonly string[]).includes(value);
}

export function maxBytesFor(type: AssetMediaType): number {
  if (type.startsWith("video/")) return ASSET_LIMITS.videoBytes;
  if (type === "application/pdf") return ASSET_LIMITS.pdfBytes;
  return ASSET_LIMITS.imageBytes;
}

/** What a file is, from its first bytes. Null: not one of the types we keep. */
export function sniffAsset(bytes: Uint8Array): AssetMediaType | null {
  const b = bytes;
  const at = (i: number, ...values: number[]) => values.every((v, k) => b[i + k] === v);
  if (b.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (b.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (b.length >= 6 && (at(0, 0x47, 0x49, 0x46, 0x38, 0x37, 0x61) || at(0, 0x47, 0x49, 0x46, 0x38, 0x39, 0x61))) return "image/gif";
  if (b.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  if (b.length >= 5 && at(0, 0x25, 0x50, 0x44, 0x46, 0x2d)) return "application/pdf";
  if (b.length >= 4 && at(0, 0x1a, 0x45, 0xdf, 0xa3)) return "video/webm";
  if (b.length >= 12 && at(4, 0x66, 0x74, 0x79, 0x70)) {
    const brand = String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!);
    if (brand === "qt  ") return "video/quicktime";
    // HEIC photos are ISO boxes too: not a video, and not kept (export as JPEG).
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|avif)$/.test(brand)) return null;
    return "video/mp4";
  }
  return null;
}

export type AssetCheck = { ok: true; mediaType: AssetMediaType; extension: string } | { ok: false; status: 400 | 413 | 415; code: "empty" | "too_large" | "wrong_type" | "type_mismatch" };

/** Check a file's first bytes and size against what was declared. */
export function checkAsset(head: Uint8Array, size: number, declared?: string | null): AssetCheck {
  if (size <= 0 || head.length === 0) return { ok: false, status: 400, code: "empty" };
  const kind = sniffAsset(head);
  if (!kind) return { ok: false, status: 415, code: "wrong_type" };
  // A declared video that is a picture (or the other way) is refused: the declaration chose the size limit.
  if (declared && isAssetType(declared) && declared.split("/")[0] !== kind.split("/")[0]) return { ok: false, status: 415, code: "type_mismatch" };
  if (size > maxBytesFor(kind)) return { ok: false, status: 413, code: "too_large" };
  return { ok: true, mediaType: kind, extension: EXTENSION[kind] };
}

/** Where an upload goes: "<piece>/<asset>.<ext>", lowercase, no user input in the path. */
export function assetPath(pieceId: string, assetId: string, extension: string): string {
  return `${pieceId}/${assetId}.${extension}`;
}

/** A link a person adds instead of a file (Canva, Drive, CapCut): https only, at most 500 characters. */
export function assetLinkProblem(url: string): string | null {
  const text = url.trim();
  if (!/^https:\/\/[^\s"'<>]{4,490}$/.test(text)) return "not_https";
  try {
    new URL(text);
    return null;
  } catch {
    return "not_https";
  }
}

export const ASSET_PROBLEM_TEXT: Record<string, { en: string; es: string }> = {
  empty: { en: "The file is empty.", es: "El archivo está vacío." },
  too_large: { en: "Too large: pictures and PDFs up to 20 MB, videos up to 500 MB.", es: "Demasiado grande: imágenes y PDF hasta 20 MB, videos hasta 500 MB." },
  wrong_type: { en: "Only JPEG, PNG, WebP, GIF, PDF, MP4, MOV or WebM. Export HEIC photos as JPEG.", es: "Solo JPEG, PNG, WebP, GIF, PDF, MP4, MOV o WebM. Exporta las fotos HEIC como JPEG." },
  type_mismatch: { en: "The file is not what it says it is.", es: "El archivo no es lo que dice ser." },
  not_https: { en: "Links must start with https://.", es: "Los enlaces deben empezar con https://." },
  too_many: { en: "A piece can have at most 20 files.", es: "Una pieza puede tener como máximo 20 archivos." },
};
