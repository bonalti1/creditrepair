// A partner's logo for co-branding (migration 0023, partners.logo_data): a
// small PNG, JPEG or WebP, kept as a data URL so it never loads from anyone
// else's server (no tracking pixel on a client's welcome). Checked by its
// first bytes, not by what the browser says it is. SVG is refused: it can
// carry script. Shown to clients only after an administrator approves it.

export const LOGO_MAX_BYTES = 120_000;

export type LogoCheck = { ok: true; dataUrl: string; mime: string } | { ok: false; message: string };

const SIGNATURES: Array<{ mime: string; test: (b: Uint8Array) => boolean }> = [
  { mime: "image/png", test: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: "image/jpeg", test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/webp", test: (b) => b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP" },
];

export function checkLogo(dataUrl: string): LogoCheck {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+=*)$/.exec(dataUrl.trim());
  if (!match) return { ok: false, message: "Sube una imagen PNG, JPG o WebP." };
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(Buffer.from(match[2]!, "base64"));
  } catch {
    return { ok: false, message: "No pudimos leer la imagen." };
  }
  if (bytes.length === 0) return { ok: false, message: "No pudimos leer la imagen." };
  if (bytes.length > LOGO_MAX_BYTES) return { ok: false, message: "La imagen es muy grande. Usa una de menos de 120 KB." };
  const real = SIGNATURES.find((s) => s.test(bytes));
  if (!real) return { ok: false, message: "Sube una imagen PNG, JPG o WebP." };
  return { ok: true, dataUrl: `data:${real.mime};base64,${match[2]}`, mime: real.mime };
}
