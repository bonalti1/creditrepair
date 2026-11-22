import { sha256Hex } from "../../agreement/sha256";
import type { AttachBankResult, AttachResult, GatewayChargeResult, GatewayEvent, GatewayRefundResult, PaymentGateway, WebhookParse } from "../gateway";
import { amount, brandOf, hexToBytes, hmacHex, last4Of, sameHex, shortKey, withTimeout, type Fetch } from "./shared";

// Authorize.Net, the other gateway high-risk credit repair merchants commonly
// use and Credit Repair Cloud supports.
//
//   Card and bank details go into Accept's hosted payment form (AcceptUI.js,
//   a lightbox served by Authorize.Net). The browser gets opaqueData (a
//   one-time nonce, dataDescriptor COMMON.ACCEPT.INAPP.PAYMENT); this app
//   never sees a card or account number.
//   The nonce becomes a Customer Payment Profile (CIM); charges use the
//   profile. We store "anet:<customerProfileId>" and "anet:<paymentProfileId>".
//   JSON API at /xml/v1/request.api; the answer starts with a byte-order mark.
//   Idempotency: Authorize.Net has no idempotency key we could confirm. Our
//   charge id + attempt is hashed into invoiceNumber and refId (20 chars), and
//   before any charge we look for an unsettled transaction with that invoice
//   number: one that was approved is the answer.
//   Webhooks: "X-ANET-Signature: sha512=<HMAC-SHA512 of the body>".
//
// Confirmed from Authorize.Net's documentation and staff answers in its
// developer forum (as quoted in search results; the sites were not reachable
// from the build environment): the opaqueData descriptor; createCustomerProfile
// taking opaqueData in a payment profile, with validationMode liveMode; the
// Accept token is one-time use; AcceptUI's data-paymentOptions with
// showCreditCard / showBankAccount; eCheck.Net must be enabled on the account
// for bank fields to appear; the webhook header "sha512=" + uppercase hex
// HMAC-SHA512 of the raw body.
//
// UNVERIFIED (listed in docs/BILLING.md): whether the signature key is used as
// hex bytes or as text (both are tried); whether a BANK nonce can create a
// payment profile (a 2018 staff answer says it can, an older one says it
// cannot); the 20-character limits of refId and invoiceNumber; that
// getUnsettledTransactionList returns invoiceNumber; responseCode "4" (held
// for review) treated as "no definite answer"; refunds with a profile instead
// of the card's last four digits; and that no webhook reports eCheck returns
// or chargebacks (staff enter those by hand from the Merchant Interface).

export const AUTHORIZE_NET_ENV = {
  apiLoginId: "AUTHORIZE_NET_API_LOGIN_ID",
  transactionKey: "AUTHORIZE_NET_TRANSACTION_KEY",
  clientKey: "NEXT_PUBLIC_AUTHORIZE_NET_CLIENT_KEY",
  publicLoginId: "NEXT_PUBLIC_AUTHORIZE_NET_API_LOGIN_ID",
  signatureKey: "AUTHORIZE_NET_SIGNATURE_KEY",
  environment: "AUTHORIZE_NET_ENV",
} as const;

const ENDPOINT = { production: "https://api.authorize.net/xml/v1/request.api", sandbox: "https://apitest.authorize.net/xml/v1/request.api" };
// UNVERIFIED: the AcceptUI script locations (production / sandbox).
export const ACCEPT_UI_URL = { production: "https://js.authorize.net/v3/AcceptUI.js", sandbox: "https://jstest.authorize.net/v3/AcceptUI.js" };

type Json = Record<string, unknown>;

/** The JSON answer, without the byte-order mark Authorize.Net puts in front of it. */
export function parseAnetResponse(text: string): Json {
  return JSON.parse(text.replace(/^﻿/, "")) as Json;
}

const ok = (answer: Json) => (answer.messages as { resultCode?: string } | undefined)?.resultCode === "Ok";
const firstMessage = (answer: Json) => (answer.messages as { message?: Array<{ code?: string; text?: string }> } | undefined)?.message?.[0];

export function authorizeNetGateway(
  env: Record<string, string | undefined>,
  options: { fetch?: Fetch } = {},
): { ok: true; gateway: PaymentGateway } | { ok: false; message: string } {
  const apiLoginId = env[AUTHORIZE_NET_ENV.apiLoginId]?.trim();
  const transactionKey = env[AUTHORIZE_NET_ENV.transactionKey]?.trim();
  const clientKey = env[AUTHORIZE_NET_ENV.clientKey]?.trim();
  const missing = [
    [AUTHORIZE_NET_ENV.apiLoginId, apiLoginId],
    [AUTHORIZE_NET_ENV.transactionKey, transactionKey],
    [AUTHORIZE_NET_ENV.clientKey, clientKey],
  ].find(([, v]) => !v)?.[0];
  if (missing || !apiLoginId || !transactionKey || !clientKey) {
    return { ok: false, message: `BILLING_GATEWAY is "authorize_net" but ${missing} is not set. Nothing was charged. See docs/BILLING.md.` };
  }
  const environment = env[AUTHORIZE_NET_ENV.environment]?.trim() === "production" ? "production" : "sandbox";
  const endpoint = ENDPOINT[environment];
  const signatureKey = env[AUTHORIZE_NET_ENV.signatureKey]?.trim() || null;
  const fetchImpl = options.fetch ?? fetch;
  const auth = { name: apiLoginId, transactionKey };

  const call = async (root: string, body: Json): Promise<Json> => {
    const res = await withTimeout(fetchImpl, endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ [root]: { merchantAuthentication: auth, ...body } }),
    });
    if (!res.ok) throw new Error(`Authorize.Net answered HTTP ${res.status}`);
    return parseAnetResponse(await res.text());
  };

  const id = (ref: string) => ref.replace(/^anet:/, "");

  /** The nonce becomes a payment profile; then we read back what it is. */
  const addProfile = async (customerRef: string, token: string): Promise<{ profileId: string; payment: Json } | { code: string }> => {
    const created = await call("createCustomerPaymentProfileRequest", {
      customerProfileId: id(customerRef),
      paymentProfile: { payment: { opaqueData: { dataDescriptor: "COMMON.ACCEPT.INAPP.PAYMENT", dataValue: token } } },
      validationMode: "liveMode",
    });
    const profileId = typeof created.customerPaymentProfileId === "string" ? created.customerPaymentProfileId : null;
    if (!ok(created) || !profileId) return { code: `anet_${firstMessage(created)?.code ?? "refused"}` };
    const read = await call("getCustomerPaymentProfileRequest", { customerProfileId: id(customerRef), customerPaymentProfileId: profileId });
    const payment = ((read.paymentProfile as Json | undefined)?.payment as Json | undefined) ?? {};
    return { profileId, payment };
  };

  /** An approved, unsettled transaction carrying this invoice number, if any. UNVERIFIED: the list's field names. */
  const findByInvoice = async (invoice: string): Promise<string | null> => {
    const list = await call("getUnsettledTransactionListRequest", { sorting: { orderBy: "submitTimeUTC", orderDescending: true }, paging: { limit: 100, offset: 1 } });
    const transactions = (list.transactions as Json[] | undefined) ?? [];
    const hit = transactions.find((t) => t.invoiceNumber === invoice && t.transactionStatus !== "declined" && t.transactionStatus !== "voided");
    return hit && typeof hit.transId === "string" ? hit.transId : null;
  };

  const gateway: PaymentGateway = {
    name: "authorize_net",
    live: true,
    async createCustomer({ userId }) {
      const merchantCustomerId = sha256Hex(userId).slice(0, 20);
      const answer = await call("createCustomerProfileRequest", { profile: { merchantCustomerId, description: "Credalti client" } });
      if (ok(answer) && typeof answer.customerProfileId === "string") return { customerRef: `anet:${answer.customerProfileId}` };
      // E00039: a profile with this merchantCustomerId exists; its id is in the message. UNVERIFIED wording.
      const existing = /ID (\d+)/.exec(firstMessage(answer)?.text ?? "")?.[1];
      if (existing) return { customerRef: `anet:${existing}` };
      throw new Error(`Authorize.Net: ${firstMessage(answer)?.text ?? "could not create the customer"}`);
    },
    async attachPaymentMethod({ customerRef, token }): Promise<AttachResult> {
      const added = await addProfile(customerRef, token);
      if ("code" in added) return { ok: false, code: added.code };
      const card = added.payment.creditCard as Json | undefined;
      const last4 = last4Of(card?.cardNumber as string | undefined);
      if (!card || !last4) return { ok: false, code: "not_a_card" };
      return { ok: true, paymentMethodRef: `anet:${added.profileId}`, brand: brandOf(card.cardType as string | undefined), last4 };
    },
    async attachBankAccount({ customerRef, token }): Promise<AttachBankResult> {
      const added = await addProfile(customerRef, token);
      if ("code" in added) return { ok: false, code: added.code };
      const bank = added.payment.bankAccount as Json | undefined;
      const last4 = last4Of(bank?.accountNumber as string | undefined);
      if (!bank || !last4) return { ok: false, code: "not_a_bank_account" };
      return { ok: true, paymentMethodRef: `anet:${added.profileId}`, accountType: bank.accountType === "savings" ? "savings" : "checking", last4 };
    },
    async charge(input): Promise<GatewayChargeResult> {
      const invoice = shortKey(input.idempotencyKey);
      try {
        const known = await findByInvoice(invoice).catch(() => null);
        if (known) return { ok: true, reference: known };
        const answer = await call("createTransactionRequest", {
          refId: invoice,
          transactionRequest: {
            transactionType: "authCaptureTransaction",
            amount: amount(input.amountCents),
            profile: { customerProfileId: id(input.customerRef), paymentProfile: { paymentProfileId: id(input.paymentMethodRef) } },
            order: { invoiceNumber: invoice, description: input.description.slice(0, 255) },
          },
        });
        const tr = (answer.transactionResponse as Json | undefined) ?? {};
        const code = String(tr.responseCode ?? "");
        if (code === "1" && typeof tr.transId === "string" && tr.transId !== "0") return { ok: true, reference: tr.transId };
        if (code === "2") {
          const reason = (tr.errors as Array<{ errorCode?: string }> | undefined)?.[0]?.errorCode ?? "declined";
          return { ok: false, kind: "declined", code: `anet_${reason}` };
        }
        // "3" error, "4" held for review, or no transaction answer: nothing definite. UNVERIFIED for "4".
        return { ok: false, kind: "error", message: `Authorize.Net: ${firstMessage(answer)?.text ?? `responseCode ${code || "none"}`}` };
      } catch (error) {
        return { ok: false, kind: "error", message: error instanceof Error ? error.message : String(error) };
      }
    },
    async refund(input): Promise<GatewayRefundResult> {
      try {
        const details = await call("getTransactionDetailsRequest", { transId: input.chargeReference });
        const status = String((details.transaction as Json | undefined)?.transactionStatus ?? "");
        const unsettled = status === "capturedPendingSettlement" || status === "authorizedPendingCapture";
        const answer = await call("createTransactionRequest", {
          refId: shortKey(input.idempotencyKey),
          transactionRequest: unsettled
            ? { transactionType: "voidTransaction", refTransId: input.chargeReference }
            : {
                transactionType: "refundTransaction",
                amount: amount(input.amountCents),
                // UNVERIFIED: a refund to the stored profile rather than to the card's last four digits.
                ...(input.handle
                  ? { profile: { customerProfileId: id(input.handle.customerRef), paymentProfile: { paymentProfileId: id(input.handle.paymentMethodRef) } } }
                  : {}),
                refTransId: input.chargeReference,
              },
        });
        const tr = (answer.transactionResponse as Json | undefined) ?? {};
        if (String(tr.responseCode) === "1") return { ok: true, reference: String(tr.transId ?? input.chargeReference), kind: unsettled ? "void" : "refund" };
        return { ok: false, message: `Authorize.Net: ${firstMessage(answer)?.text ?? "refund refused"}` };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
      }
    },
    async detachPaymentMethod({ customerRef, paymentMethodRef }) {
      await call("deleteCustomerPaymentProfileRequest", { customerProfileId: id(customerRef), customerPaymentProfileId: id(paymentMethodRef) });
    },
    async parseWebhook({ rawBody, headers }): Promise<WebhookParse> {
      if (!signatureKey) return { ok: false, reason: "not_configured" };
      const header = headers.get("x-anet-signature") ?? "";
      const given = header.replace(/^sha512=/i, "");
      if (!given) return { ok: false, reason: "bad_signature" };
      const asHex = hexToBytes(signatureKey);
      const candidates = [await hmacHex("SHA-512", signatureKey, rawBody), ...(asHex ? [await hmacHex("SHA-512", asHex, rawBody)] : [])];
      if (!candidates.some((c) => sameHex(c, given))) return { ok: false, reason: "bad_signature" };
      try {
        return { ok: true, events: [anetEvent(JSON.parse(rawBody) as Json)] };
      } catch {
        return { ok: false, reason: "malformed" };
      }
    },
    hostedFields: () => ({
      kind: "acceptui",
      scriptUrl: ACCEPT_UI_URL[environment],
      apiLoginId: env[AUTHORIZE_NET_ENV.publicLoginId]?.trim() || apiLoginId,
      clientKey,
    }),
  };
  return { ok: true, gateway };
}

/** One Authorize.Net webhook, in our words. Only what we act on; the rest is recorded as ignored. */
export function anetEvent(body: Json): GatewayEvent {
  const eventId = String(body.notificationId ?? "");
  const type = String(body.eventType ?? "");
  const payload = (body.payload as Json | undefined) ?? {};
  const reference = String(payload.id ?? "");
  if (!eventId || !reference) return { kind: "ignored", eventId: eventId || `anet-${Date.now()}`, type };
  // A capture that Authorize.Net reports as created is already recorded by the charge itself; nothing else is confirmed.
  return { kind: "ignored", eventId, type };
}
