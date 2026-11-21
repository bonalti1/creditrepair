import { NextResponse } from "next/server";
import { agreementReadiness } from "@/lib/agreement/readiness";
import { billingReadiness } from "@/lib/billing/readiness";
import { MONITORING_OFFER } from "@/lib/monitoring/offer";
import { hasSharedSecret } from "@/lib/security/signatures";
import { getAdminClient } from "@/lib/supabase/admin";

// Go-live check. Publicly it only says the app is up. With the shared secret
// (header x-webhook-secret) it reports which integrations are configured and
// whether the database has every table the app needs. It never returns a key,
// only "set" or "missing".

const set = (name: string) => Boolean(process.env[name]);

const TABLES = [
  "profiles", "monitoring_subscriptions", "report_pulls", "report_items", "item_flags",
  "attack_rounds", "letters", "letter_items", "aba_acknowledgments", "events", "waitlist", "identity_documents", "chat_messages",
  "service_agreements",
  "payment_methods", "payment_method_vault", "charges", "refunds", "billing_pauses",
];

export async function GET(req: Request) {
  if (!hasSharedSecret(req, process.env.N8N_WEBHOOK_SECRET)) {
    return NextResponse.json({ ok: true });
  }

  const checks: Array<{ name: string; ok: boolean; needed: "required" | "recommended" | "later"; detail: string }> = [];
  const add = (name: string, ok: boolean, needed: "required" | "recommended" | "later", detail: string) =>
    checks.push({ name, ok, needed, detail });

  const supabaseEnv = set("NEXT_PUBLIC_SUPABASE_URL") && set("NEXT_PUBLIC_SUPABASE_ANON_KEY") && set("SUPABASE_SERVICE_ROLE_KEY");
  add("Database and login (Supabase)", supabaseEnv, "required", supabaseEnv ? "Keys are set." : "Set the three Supabase variables.");

  if (supabaseEnv) {
    const db = getAdminClient()!;
    const missing: string[] = [];
    for (const table of TABLES) {
      const { error } = await db.from(table).select("*", { head: true, count: "exact" }).limit(1);
      if (error) missing.push(table);
    }
    const { error: columnError } = await db.from("profiles").select("referred_by, state, assisted").limit(1);
    if (columnError) missing.push("profiles columns from migration 0005");
    add(
      "Database tables",
      missing.length === 0,
      "required",
      missing.length === 0 ? "All tables present." : `Missing: ${missing.join(", ")}. Apply the migrations in supabase/migrations in order.`,
    );
    const { data: bucket } = await db.storage.getBucket("identity-docs");
    add("ID photo storage", Boolean(bucket) && bucket?.public === false, "required", bucket ? (bucket.public ? "Bucket identity-docs must be private." : "Private bucket present.") : "Bucket identity-docs is missing (migration 0003).");
  }

  add("Capi (Anthropic)", set("ANTHROPIC_API_KEY"), "required", set("ANTHROPIC_API_KEY") ? "Key is set." : "Without it Capi answers with a fixed fallback and letters are not reworded.");
  add("Mail (Lob)", set("LOB_API_KEY"), "required", set("LOB_API_KEY") ? "Key is set." : "Without it letters are recorded but NOT mailed.");
  const whatsapp = set("WHATSAPP_ACCESS_TOKEN") && set("WHATSAPP_PHONE_NUMBER_ID");
  add("WhatsApp sending", whatsapp, "required", whatsapp ? "Keys are set." : "Without it no WhatsApp message is sent.");
  add(
    "WhatsApp inbound security",
    !whatsapp || (set("WHATSAPP_APP_SECRET") && set("WHATSAPP_WEBHOOK_VERIFY_TOKEN")),
    "required",
    "WHATSAPP_APP_SECRET and WHATSAPP_WEBHOOK_VERIFY_TOKEN must both be set once WhatsApp is live.",
  );
  add("App address", set("NEXT_PUBLIC_APP_URL"), "required", "NEXT_PUBLIC_APP_URL is used for the links in WhatsApp messages.");
  add("Sales number on the ad page", set("NEXT_PUBLIC_WHATSAPP_NUMBER"), "required", "NEXT_PUBLIC_WHATSAPP_NUMBER sends the ad page's button to WhatsApp.");
  add("Monitoring signup link", Boolean(MONITORING_OFFER.signupUrl), "required", MONITORING_OFFER.signupUrl ? `Set. Price shown: ${MONITORING_OFFER.priceLabel}.` : "NEXT_PUBLIC_MONITORING_SIGNUP_URL is not set; customers cannot subscribe from the app.");
  const provider = process.env.MONITORING_PROVIDER || "demo";
  add("Report source", provider !== "demo", "required", provider === "demo" ? "MONITORING_PROVIDER is demo: everyone sees the sample report." : `Provider: ${provider}.`);
  // No client can sign, so no work can start, until the agreement is ready (docs/AGREEMENT.md).
  const agreement = agreementReadiness();
  add(
    "Service agreement",
    agreement.ready,
    "required",
    agreement.ready
      ? `Version ${agreement.version} is approved and complete.`
      : [
          agreement.missing.length > 0 ? `Not set: ${agreement.missing.map((m) => m.env).join(", ")}.` : "",
          agreement.unverifiedStatutes.length > 0
            ? `Statutory text not yet compared with the official source: ${agreement.unverifiedStatutes.join("; ")}.`
            : "",
          agreement.approved
            ? ""
            : `NEXT_PUBLIC_AGREEMENT_APPROVED_VERSION is not ${agreement.version}: set it once an attorney approves that version.`,
        ]
          .filter(Boolean)
          .join(" "),
  );
  // Nothing is charged until a processor that accepts this business is set up (docs/BILLING.md).
  const billing = billingReadiness();
  add(
    "Billing (payment processor)",
    billing.ready,
    "required",
    billing.ready
      ? `Processor "${billing.gatewayName}" is configured; authorization ${billing.authorizationVersion} is approved. /api/cron/billing must be called hourly.`
      : billing.problems.join(" "),
  );
  add("Team alerts", set("TEAM_WEBHOOK_URL") || set("SALES_WEBHOOK_URL"), "recommended", "TEAM_WEBHOOK_URL tells the team when a client cancels or asks to end the service.");
  add("Error alerts", set("ERROR_WEBHOOK_URL"), "recommended", "ERROR_WEBHOOK_URL sends failures to Slack or n8n.");
  add("New-lead alerts", set("SALES_WEBHOOK_URL"), "recommended", "SALES_WEBHOOK_URL pings sales when a lead writes in.");

  const blocking = checks.filter((c) => !c.ok && c.needed === "required").map((c) => c.name);
  return NextResponse.json({ ok: true, readyForCustomers: blocking.length === 0, blocking, checks });
}
