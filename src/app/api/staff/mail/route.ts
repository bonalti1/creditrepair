import { NextResponse } from "next/server";
import { isLobConfigured } from "@/lib/integrations/lob";
import type { FurnisherEntry } from "@/lib/mail/furnishers";
import { furnisherChangeFromRow, furnisherFromRow } from "@/lib/mail/server";
import { gapFromRow } from "@/lib/mail/gapsServer";
import { reportError } from "@/lib/observability/errors";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";
import { getServerSupabase } from "@/lib/supabase/server";

// The furnisher address book and how the console mails, for any active member
// (the send rules of every screen read the book). Read through the member's
// own connection ("staff read furnishers", migration 0013). The mode says only
// whether a Lob key is configured: the key never leaves the server.

type Row = Record<string, unknown>;

export async function GET(req: Request) {
  const limited = rateLimit(req, "staff-mail-read", { limit: 120, windowMs: 60_000 });
  if (limited) return limited;
  const allowed = await requireCapability("clients.followup");
  if (!allowed.ok) return allowed.response;
  const reader = await getServerSupabase();
  if (!reader) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  try {
    const [book, changes] = await Promise.all([
      reader.from("furnishers").select("*").order("name"),
      reader.from("furnisher_changes").select("furnisher_id, changed_at, changed_by_name, changes").order("changed_at"),
    ]);
    if (book.error) throw new Error(book.error.message);
    const history = new Map<string, FurnisherEntry["history"]>();
    for (const row of (changes.data as Row[] | null) ?? []) {
      const list = history.get(String(row.furnisher_id)) ?? [];
      list.push(furnisherChangeFromRow(row));
      history.set(String(row.furnisher_id), list);
    }
    const furnishers = ((book.data as Row[] | null) ?? []).map((row) => ({ ...furnisherFromRow(row), history: history.get(String(row.id)) ?? [] }));
    // The companies whose address is missing, as first seen for every client (migration 0022; none without it).
    const gapRows = await reader.from("furnisher_gaps").select("*");
    const gaps = gapRows.error ? [] : ((gapRows.data as Row[] | null) ?? []).map(gapFromRow);
    return NextResponse.json({ mode: isLobConfigured() ? "lob" : "simulated", furnishers, gaps });
  } catch (error) {
    await reportError(error, { where: "api/staff/mail", userId: allowed.member.userId });
    return NextResponse.json({ error: "Could not read the address book." }, { status: 500 });
  }
}
