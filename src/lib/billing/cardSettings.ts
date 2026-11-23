import type { SupabaseClient } from "@supabase/supabase-js";
import { acceptedCardsProblem, CARD_BRANDS, readAcceptedCards, type AcceptedCards } from "./cardBrands";

// The accepted card brands as stored (billing_card_settings, migration 0027):
// read by the server for the client's payment screens and the payment-method
// route, written for an administrator from /equipo/planes. A database without
// the table reads as the defaults (Visa and Mastercard).

export async function loadAcceptedCards(db: SupabaseClient): Promise<AcceptedCards> {
  const { data, error } = await db.from("billing_card_settings").select("visa, mastercard, amex, discover").eq("id", true).maybeSingle();
  return readAcceptedCards(error ? null : (data as Record<string, unknown> | null));
}

export async function saveAcceptedCards(
  db: SupabaseClient,
  input: AcceptedCards,
  actor: { userId: string | null; name: string },
): Promise<{ ok: true; cards: AcceptedCards } | { ok: false; message: { en: string; es: string } }> {
  const problem = acceptedCardsProblem(input);
  if (problem) return { ok: false, message: problem };
  const values = Object.fromEntries(CARD_BRANDS.map((b) => [b, input[b] === true]));
  const { error } = await db
    .from("billing_card_settings")
    .upsert({ id: true, ...values, updated_by: actor.userId, updated_by_name: actor.name.slice(0, 80) });
  if (error) return { ok: false, message: { en: error.message, es: error.message } };
  await db.from("team_audit").insert({ actor: actor.userId, kind: "card_brands_changed", detail: values });
  return { ok: true, cards: readAcceptedCards(values) };
}
