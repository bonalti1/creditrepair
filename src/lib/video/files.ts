import { sniffAsset } from "../content/assets";
import { VIDEO_LIMITS } from "./types";

// Files in the Video Studio: clips, pictures and music the team adds, and the
// MP4s the editor exports. The content hub's pattern (content/assets.ts): the
// type is read from the file's first bytes, never its name; files live in a
// private bucket ("video-studio", migration 0038); people see them through
// short-lived signed links. Files go straight from the browser to storage
// with a one-time upload link (they are too large for a server function),
// then the server reads the first bytes before recording them and deletes
// anything that is not what it should be.
//
// In the demo (no database) nothing is uploaded: the files stay in this
// browser (IndexedDB), and the small sample clips come from public/.

export const VIDEO_BUCKET = "video-studio";

export const STUDIO_TYPES = {
  video: ["video/mp4", "video/quicktime", "video/webm"],
  image: ["image/jpeg", "image/png", "image/webp"],
  audio: ["audio/mpeg", "audio/mp4", "audio/wav", "audio/ogg", "audio/webm"],
} as const;

export type StudioKind = keyof typeof STUDIO_TYPES;

const EXTENSION: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
  "audio/webm": "weba",
};

export function extensionFor(mediaType: string): string {
  return EXTENSION[mediaType] ?? "bin";
}

/**
 * What a file is, from its first bytes, for the kind it is meant to be: a
 * WebM or an MP4 can hold sound only, so the kind asked for decides between
 * "video/…" and "audio/…" for those containers.
 */
export function sniffStudioFile(head: Uint8Array, kind: StudioKind): string | null {
  const b = head;
  const at = (i: number, ...values: number[]) => values.every((v, k) => b[i + k] === v);
  if (kind === "audio") {
    if (b.length >= 3 && at(0, 0x49, 0x44, 0x33)) return "audio/mpeg";
    if (b.length >= 2 && b[0] === 0xff && (b[1]! & 0xe0) === 0xe0) return "audio/mpeg";
    if (b.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x41, 0x56, 0x45)) return "audio/wav";
    if (b.length >= 4 && at(0, 0x4f, 0x67, 0x67, 0x53)) return "audio/ogg";
    if (b.length >= 4 && at(0, 0x1a, 0x45, 0xdf, 0xa3)) return "audio/webm";
    if (b.length >= 12 && at(4, 0x66, 0x74, 0x79, 0x70)) {
      const brand = String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!);
      return /^(M4A |M4B |mp42|isom|iso2|dash)$/.test(brand) ? "audio/mp4" : null;
    }
    return null;
  }
  const type = sniffAsset(head);
  if (!type) return null;
  return (STUDIO_TYPES[kind] as readonly string[]).includes(type) ? type : null;
}

export function maxBytesForKind(kind: StudioKind): number {
  return kind === "video" ? VIDEO_LIMITS.clipBytes : kind === "image" ? VIDEO_LIMITS.imageBytes : VIDEO_LIMITS.musicBytes;
}

export type StudioFileCheck = { ok: true; mediaType: string; extension: string } | { ok: false; code: "empty" | "too_large" | "wrong_type" };

export function checkStudioFile(head: Uint8Array, size: number, kind: StudioKind): StudioFileCheck {
  if (size <= 0 || head.length === 0) return { ok: false, code: "empty" };
  const mediaType = sniffStudioFile(head, kind);
  if (!mediaType) return { ok: false, code: "wrong_type" };
  if (size > maxBytesForKind(kind)) return { ok: false, code: "too_large" };
  return { ok: true, mediaType, extension: extensionFor(mediaType) };
}

/** An MP4 the editor exported: ISO boxes with an ftyp. */
export function looksLikeMp4(head: Uint8Array): boolean {
  return head.length >= 12 && head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70;
}

/** Where a file goes: "<project>/<file>.<ext>", or "music/<track>.<ext>"; lowercase, no user input in the path. */
export function studioPath(folder: string, fileId: string, extension: string): string {
  return `${folder}/${fileId}.${extension}`;
}

export const STUDIO_FILE_TEXT: Record<string, { en: string; es: string }> = {
  empty: { en: "The file is empty.", es: "El archivo está vacío." },
  too_large: {
    en: "Too large: clips up to 250 MB, pictures up to 20 MB, music up to 30 MB.",
    es: "Demasiado grande: clips hasta 250 MB, fotos hasta 20 MB, música hasta 30 MB.",
  },
  wrong_type: {
    en: "Clips: MP4, MOV or WebM. Pictures: JPEG, PNG or WebP (export HEIC as JPEG). Music: MP3, M4A, WAV or OGG.",
    es: "Clips: MP4, MOV o WebM. Fotos: JPEG, PNG o WebP (exporta HEIC como JPEG). Música: MP3, M4A, WAV u OGG.",
  },
  project_full: { en: "This video already uses 400 MB of files or 24 files. Remove some first.", es: "Este video ya usa 400 MB o 24 archivos. Quita algunos primero." },
  no_rights: { en: "Confirm that the team has the rights to use this music.", es: "Confirma que el equipo tiene los derechos para usar esta música." },
  upload_failed: { en: "The upload did not finish. Try again.", es: "La subida no terminó. Inténtalo otra vez." },
};
