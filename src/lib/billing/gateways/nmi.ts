import { sha256Hex } from "../../agreement/sha256";
import type {
  AttachBankResult,
  AttachResult,
  GatewayChargeResult,
  GatewayEvent,
  GatewayRefundResult,
  PaymentGateway,
  WebhookParse,
} from "../gateway";
import { amount, brandOf, hmacHex, last4Of, sameHex, withTimeout, type Fetch } from "./shared";

// NMI (Network Merchants), one of the two gateways high-risk credit repair
// merchants commonly use and Credit Repair Cloud supports.
//
//   Cards and bank accounts are entered in Collect.js, NMI's hosted fields
//   (iframes served by NMI). The browser gets a single-use payment_token; this
//   app never sees a card or account number.
//   The token goes into NMI's Customer Vault (customer_vault=add_customer);
//   charges use the vault id. We store "nmi:vault:<id>" (never digits alone).
//   Charges, refunds and voids: the Payment API (transact.php), form-encoded,
//   answering form-encoded (response=1 approved, 2 declined, 3 error).
//   Idempotency: NMI's transact.php takes no idempotency key that we could
//   confirm. Our charge id + attempt goes in `orderid`, and before any sale
//   we ask the Query API (query.php) for a transaction with that order id: an
//   approved one is the answer, so a retry after a timeout never charges twice.
//   Webhooks: signed with HMAC-SHA256 over "<nonce>.<body>", header
//   "Webhook-Signature: t=<nonce>,s=<signature>".
//
// Confirmed from NMI's documentation (as quoted in search results; the NMI
// sites were not reachable from the build environment): the Collect.js script
// with data-tokenization-key and response.token; the tokenization key is
// public and only makes tokens; payment_token with type=sale on the Direct
// Post API; customer_vault=add_customer returns customer_vault_id and a later
// sale passes customer_vault_id; response_code 100 approved / 200 declined;
// the webhook header, nonce and HMAC-SHA256 of nonce + "." + body; event
// names transaction.<action>.<result> (e.g. transaction.sale.success) and a
// "Check Status" event family for settled / returned / late-return checks.
//
// Every other detail is marked UNVERIFIED below and listed in docs/BILLING.md.

export const NMI_ENV = {
  securityKey: "NMI_SECURITY_KEY",
  tokenizationKey: "NEXT_PUBLIC_NMI_TOKENIZATION_KEY",
  webhookSigningKey: "NMI_WEBHOOK_SIGNING_KEY",
  apiUrl: "NMI_API_URL",
  queryUrl: "NMI_QUERY_URL",
} as const;

// UNVERIFIED: the production endpoints of the Payment API and the Query API.
const DEFAULT_API_URL = "https://secure.nmi.com/api/transact.php";
const DEFAULT_QUERY_URL = "https://secure.nmi.com/api/query.php";
// Confirmed: Collect.js is served from secure.nmi.com. UNVERIFIED: this exact path.
export const COLLECT_JS_URL = "https://secure.nmi.com/token/Collect.js";

export type NmiFields = Record<string, string>;

/** NMI answers "response=1&responsetext=SUCCESS&transactionid=…": as a record. */
export function parseNmiResponse(body: string): NmiFields {
  return Object.fromEntries(new URLSearchParams(body.trim()).entries());
}

/** Read the value of an XML element from the Query API's answer (a small, flat format; no XML library). */
function xmlValue(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml);
  return match ? match[1]!.trim() : null;
}

/** Each <transaction> block of a Query API answer. */
export function nmiQueryTransactions(xml: string): Array<{ transactionId: string | null; condition: string | null; orderId: string | null; actions: string[] }> {
  return [...xml.matchAll(/<transaction>([\s\S]*?)<\/transaction>/g)].map((m) => {
    const block = m[1]!;
    return {
      transactionId: xmlValue(block, "transaction_id"),
      // UNVERIFIED: "condition" values (pendingsettlement, complete, failed, canceled…).
      condition: xmlValue(block, "condition"),
      orderId: xmlValue(block, "order_id"),
      actions: [...block.matchAll(/<action_type>([^<]*)<\/action_type>/g)].map((a) => a[1]!),
    };
  });
}

export function nmiGateway(
  env: Record<string, string | undefined>,
  options: { fetch?: Fetch } = {},
): { ok: true; gateway: PaymentGateway } | { ok: false; message: string } {
  const securityKey = env[NMI_ENV.securityKey]?.trim();
  const tokenizationKey = env[NMI_ENV.tokenizationKey]?.trim() ?? process.env.NEXT_PUBLIC_NMI_TOKENIZATION_KEY?.trim();
  if (!securityKey || !tokenizationKey) {
    return {
      ok: false,
      message: `BILLING_GATEWAY is "nmi" but ${!securityKey ? NMI_ENV.securityKey : NMI_ENV.tokenizationKey} is not set. Nothing was charged. See docs/BILLING.md.`,
    };
  }
  const fetchImpl = options.fetch ?? fetch;
  const apiUrl = env[NMI_ENV.apiUrl]?.trim() || DEFAULT_API_URL;
  const queryUrl = env[NMI_ENV.queryUrl]?.trim() || DEFAULT_QUERY_URL;
  const signingKey = env[NMI_ENV.webhookSigningKey]?.trim() || null;

  const post = async (fields: NmiFields): Promise<NmiFields> => {
    const res = await withTimeout(fetchImpl, apiUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ security_key: securityKey, ...fields }).toString(),
    });
    if (!res.ok) throw new Error(`NMI answered HTTP ${res.status}`);
    return parseNmiResponse(await res.text());
  };

  const query = async (fields: NmiFields): Promise<string> => {
    const res = await withTimeout(fetchImpl, queryUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ security_key: securityKey, ...fields }).toString(),
    });
    if (!res.ok) throw new Error(`NMI query answered HTTP ${res.status}`);
    return res.text();
  };

  const vaultId = (ref: string) => ref.replace(/^nmi:vault:/, "");

  /** Put a token in the Customer Vault and read back what kind of method it is. */
  const addToVault = async (token: string): Promise<{ id: string; xml: string } | { code: string }> => {
    const answer = await post({ customer_vault: "add_customer", payment_token: token });
    if (answer.response !== "1" || !answer.customer_vault_id) return { code: answer.response_code || "vault_refused" };
    // UNVERIFIED: report_type=customer_vault and the element names cc_number, cc_type, check_account, account_type.
    const xml = await query({ report_type: "customer_vault", customer_vault_id: answer.customer_vault_id }).catch(() => "");
    return { id: answer.customer_vault_id, xml };
  };

  const gateway: PaymentGateway = {
    name: "nmi",
    live: true,
    async createCustomer({ userId }) {
      // NMI's vault holds a method per record; there is no separate customer to create.
      return { customerRef: `nmi:cus:${sha256Hex(userId).slice(0, 16)}` };
    },
    async attachPaymentMethod({ token }): Promise<AttachResult> {
      const added = await addToVault(token);
      if ("code" in added) return { ok: false, code: added.code };
      const last4 = last4Of(xmlValue(added.xml, "cc_number"));
      if (!last4) return { ok: false, code: "not_a_card" };
      return { ok: true, paymentMethodRef: `nmi:vault:${added.id}`, brand: brandOf(xmlValue(added.xml, "cc_type") ?? "card"), last4 };
    },
    async attachBankAccount({ token }): Promise<AttachBankResult> {
      const added = await addToVault(token);
      if ("code" in added) return { ok: false, code: added.code };
      const last4 = last4Of(xmlValue(added.xml, "check_account"));
      if (!last4) return { ok: false, code: "not_a_bank_account" };
      const type = (xmlValue(added.xml, "account_type") ?? "checking").toLowerCase();
      return { ok: true, paymentMethodRef: `nmi:vault:${added.id}`, accountType: type === "savings" ? "savings" : "checking", last4 };
    },
    async charge(input): Promise<GatewayChargeResult> {
      try {
        // The same attempt asked again: if NMI already approved it, that is the answer.
        const known = nmiQueryTransactions(await query({ order_id: input.idempotencyKey }));
        const approved = known.find((t) => t.transactionId && t.condition !== "failed" && t.condition !== "canceled" && t.actions.includes("sale"));
        if (approved?.transactionId) return { ok: true, reference: approved.transactionId };
        const fields: NmiFields = {
          type: "sale",
          customer_vault_id: vaultId(input.paymentMethodRef),
          amount: amount(input.amountCents),
          currency: "USD",
          orderid: input.idempotencyKey,
          order_description: input.description.slice(0, 255),
        };
        // UNVERIFIED: sec_code on a vault sale for a bank account; WEB = consumer debit authorized online (Nacha).
        if (input.methodKind === "ach") fields.sec_code = "WEB";
        const answer = await post(fields);
        if (answer.response === "1" && answer.transactionid) return { ok: true, reference: answer.transactionid };
        if (answer.response === "2") return { ok: false, kind: "declined", code: `nmi_${answer.response_code || "declined"}` };
        return { ok: false, kind: "error", message: `NMI: ${answer.responsetext || "no answer"}` };
      } catch (error) {
        return { ok: false, kind: "error", message: error instanceof Error ? error.message : String(error) };
      }
    },
    async refund(input): Promise<GatewayRefundResult> {
      try {
        // An unsettled charge is voided; a settled one refunded. UNVERIFIED: the condition names.
        const known = nmiQueryTransactions(await query({ transaction_id: input.chargeReference }))[0];
        const unsettled = known?.condition === "pendingsettlement" || known?.condition === "pending";
        const answer = await post(
          unsettled
            ? { type: "void", transactionid: input.chargeReference }
            : { type: "refund", transactionid: input.chargeReference, amount: amount(input.amountCents) },
        );
        if (answer.response === "1") return { ok: true, reference: answer.transactionid || input.chargeReference, kind: unsettled ? "void" : "refund" };
        return { ok: false, message: `NMI: ${answer.responsetext || "refund refused"}` };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
      }
    },
    async detachPaymentMethod({ paymentMethodRef }) {
      await post({ customer_vault: "delete_customer", customer_vault_id: vaultId(paymentMethodRef) });
    },
    async parseWebhook({ rawBody, headers }): Promise<WebhookParse> {
      if (!signingKey) return { ok: false, reason: "not_configured" };
      const header = headers.get("webhook-signature") ?? "";
      const nonce = /(?:^|,)\s*t=([^,]+)/.exec(header)?.[1];
      const signature = /(?:^|,)\s*s=([^,]+)/.exec(header)?.[1];
      if (!nonce || !signature) return { ok: false, reason: "bad_signature" };
      if (!sameHex(await hmacHex("SHA-256", signingKey, `${nonce}.${rawBody}`), signature)) return { ok: false, reason: "bad_signature" };
      let body: { event_id?: unknown; event_type?: unknown; event_body?: Record<string, unknown> };
      try {
        body = JSON.parse(rawBody);
      } catch {
        return { ok: false, reason: "malformed" };
      }
      return { ok: true, events: [nmiEvent(body)] };
    },
    hostedFields: () => ({ kind: "collectjs", scriptUrl: COLLECT_JS_URL, tokenizationKey }),
  };
  return { ok: true, gateway };
}

/**
 * One NMI webhook, in our words. UNVERIFIED: the field names inside
 * event_body (transaction_id, action.amount, action.response_code,
 * condition) and the exact names of the check-status and chargeback events;
 * anything not recognised is kept as "ignored" (recorded, never acted on).
 */
export function nmiEvent(body: { event_id?: unknown; event_type?: unknown; event_body?: Record<string, unknown> }): GatewayEvent {
  const eventId = String(body.event_id ?? "");
  const type = String(body.event_type ?? "");
  const e = body.event_body ?? {};
  const action = (e.action ?? {}) as Record<string, unknown>;
  const reference = String(e.transaction_id ?? "");
  const at = typeof action.date === "string" ? action.date : new Date().toISOString();
  if (!eventId || !reference) return { kind: "ignored", eventId: eventId || `nmi-${Date.now()}`, type };
  if (/^transaction\.check\.status\.(return|latereturn)$/.test(type)) {
    const code = String(action.response_code ?? e.return_code ?? "").toUpperCase();
    return /^R[0-9A-Z]{2}$/.test(code) ? { kind: "ach_return", eventId, reference, code, at } : { kind: "ignored", eventId, type };
  }
  if (type === "transaction.check.status.settle") return { kind: "charge_settled", eventId, reference, at };
  if (/^chargeback\./.test(type)) {
    const cents = Math.round(Number(action.amount ?? e.amount ?? NaN) * 100);
    return {
      kind: "chargeback_opened",
      eventId,
      reference,
      amountCents: Number.isFinite(cents) && cents > 0 ? cents : null,
      reasonCode: typeof e.reason_code === "string" ? e.reason_code.slice(0, 40) : null,
      caseId: typeof e.case_id === "string" ? e.case_id.slice(0, 120) : null,
      at,
    };
  }
  return { kind: "ignored", eventId, type };
}
