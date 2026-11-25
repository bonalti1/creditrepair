import { NextResponse } from "next/server";
import { RECEIPT_MAX_BYTES } from "@/lib/accounting/expenses";
import { attachReceipt, receiptLink } from "@/lib/accounting/store";
import { readUpload } from "@/lib/intake/server";
import { reportError } from "@/lib/observability/errors";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";

// An expense's receipt (accounting capability only).
//
//   POST  multipart: expenseId, file. A JPG or PNG photo or a PDF, up to
//         10 MB, decided from the file's first bytes (checkReceipt), kept in
//         the private bucket accounting-receipts.
//   GET   ?expenseId=  a link to the receipt that works for two minutes.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-accounting-receipt", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const allowed = await requireCapability("accounting");
  if (!allowed.ok) return allowed.response;
  const upload = await readUpload(req, RECEIPT_MAX_BYTES);
  if (!upload.ok) return NextResponse.json({ ok: false, message: { en: "The receipt is missing or over 10 MB.", es: "Falta el recibo o pesa más de 10 MB." } }, { status: upload.status });
  const expenseId = upload.fields.expenseId ?? "";
  if (!UUID.test(expenseId)) return NextResponse.json({ ok: false, message: { en: "Which expense?", es: "¿De qué gasto?" } }, { status: 400 });
  try {
    const result = await attachReceipt(allowed.db, expenseId, upload.bytes, upload.fileName, { userId: allowed.member.userId, name: allowed.member.name });
    return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false, message: result.message }, { status: result.status });
  } catch (error) {
    await reportError(error, { where: "api/staff/accounting/receipt", userId: allowed.member.userId });
    return NextResponse.json({ ok: false, message: { en: "The receipt could not be saved.", es: "No se pudo guardar el recibo." } }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const limited = rateLimit(req, "staff-accounting-receipt-read", { limit: 120, windowMs: 60_000 });
  if (limited) return limited;
  const allowed = await requireCapability("accounting");
  if (!allowed.ok) return allowed.response;
  const expenseId = new URL(req.url).searchParams.get("expenseId") ?? "";
  if (!UUID.test(expenseId)) return NextResponse.json({ error: "Invalid expense" }, { status: 400 });
  const url = await receiptLink(allowed.db, expenseId);
  return url ? NextResponse.json({ url }) : NextResponse.json({ error: "No receipt" }, { status: 404 });
}
