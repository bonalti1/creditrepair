// Bounded JSON body reader for public endpoints. Validation libraries walk the
// whole payload before rejecting it, so an oversized body is refused here,
// before anything parses it.

export type BodyResult = { ok: true; data: unknown } | { ok: false; status: 400 | 413 };

export async function readJsonBody(req: Request, maxBytes: number): Promise<BodyResult> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, status: 413 };

  let text: string;
  try {
    text = await req.text();
  } catch {
    return { ok: false, status: 400 };
  }
  if (Buffer.byteLength(text, "utf8") > maxBytes) return { ok: false, status: 413 };

  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400 };
  }
}
