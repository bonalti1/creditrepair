"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { HostedFieldsConfig } from "@/lib/billing/gateway";

// The payment processor's own fields, mounted in the browser. A card or bank
// account number is typed into the processor's iframe (NMI Collect.js) or its
// hosted lightbox (Authorize.Net AcceptUI): this app's code never sees it. All
// that comes back is a single-use token, which goes to POST
// /api/billing/payment-method.
//
// UNVERIFIED (docs/BILLING.md): Collect.js's configure() options (variant
// "inline", fields.ccnumber/ccexp/cvv and checkaccount/checkaba/checkname,
// callback(response.token)) and startPaymentRequest(); AcceptUI's button
// attributes (data-billingAddressOptions, data-apiLoginID, data-clientKey,
// data-acceptUIFormBtnTxt, data-acceptUIFormHeaderTxt, data-paymentOptions,
// data-responseHandler) and the response shape (opaqueData.dataValue). They
// are confirmed only by quotes from the processors' documentation and forums;
// test both against a sandbox before going live.

type Kind = "card" | "ach";

declare global {
  interface Window {
    CollectJS?: { configure: (options: Record<string, unknown>) => void; startPaymentRequest: () => void };
    [handler: `credaltiAccept${string}`]: unknown;
  }
}

function loadScript(src: string, attributes: Record<string, string> = {}): Promise<void> {
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
  if (existing) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    for (const [k, v] of Object.entries(attributes)) script.setAttribute(k, v);
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.appendChild(script);
  });
}

export default function HostedFields({
  config,
  kind,
  label,
  onToken,
  onError,
}: {
  config: HostedFieldsConfig;
  kind: Kind;
  label: string;
  /**
   * The token, and what the processor says about the card with it: its type
   * (Collect.js: response.card.type) or its BIN (Collect.js: response.card.bin;
   * AcceptUI: response.encryptedCardData.bin), never the number. The screen
   * checks the brand against the accepted ones before sending (billing/cardBrands.ts).
   * UNVERIFIED like the rest of this file: check both against a sandbox.
   */
  onToken: (token: string, card?: { brand: string | null; bin: string | null }) => void;
  onError: (message: string) => void;
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [ready, setReady] = useState(false);
  const tokenRef = useRef(onToken);
  tokenRef.current = onToken;

  useEffect(() => {
    if (config.kind === "collectjs") {
      loadScript(config.scriptUrl, { "data-tokenization-key": config.tokenizationKey })
        .then(() => {
          window.CollectJS?.configure({
            variant: "inline",
            paymentType: kind === "ach" ? "ck" : "cc",
            fields:
              kind === "ach"
                ? { checkname: { selector: `#${id}-name` }, checkaba: { selector: `#${id}-aba` }, checkaccount: { selector: `#${id}-account` } }
                : { ccnumber: { selector: `#${id}-number` }, ccexp: { selector: `#${id}-exp` }, cvv: { selector: `#${id}-cvv` } },
            callback: (response: { token?: string; card?: { type?: string; bin?: string } }) =>
              response.token ? tokenRef.current(response.token, { brand: response.card?.type ?? null, bin: response.card?.bin ?? null }) : onError("no token"),
          });
          setReady(true);
        })
        .catch((e: Error) => onError(e.message));
    }
    if (config.kind === "acceptui") {
      const handler = `credaltiAccept${id}` as const;
      window[handler] = (response: { opaqueData?: { dataValue?: string }; messages?: { resultCode?: string }; encryptedCardData?: { bin?: string } }) => {
        const token = response.opaqueData?.dataValue;
        if (response.messages?.resultCode === "Ok" && token) tokenRef.current(token, { brand: null, bin: response.encryptedCardData?.bin ?? null });
        else onError("not accepted");
      };
      // AcceptUI binds to buttons with class "AcceptUI" that exist when it loads.
      loadScript(config.scriptUrl)
        .then(() => setReady(true))
        .catch((e: Error) => onError(e.message));
      return () => {
        delete window[handler];
      };
    }
  }, [config, kind, id, onError]);

  if (config.kind === "collectjs") {
    const field = "mt-1 h-11 rounded-xl bg-white px-3 shadow-[0_0_0_1px_rgba(0,0,0,0.12)]";
    return (
      <div data-testid="hosted-fields-collectjs">
        {(kind === "ach" ? ["name", "aba", "account"] : ["number", "exp", "cvv"]).map((f) => (
          <div key={f} id={`${id}-${f}`} className={field} />
        ))}
        <button type="button" disabled={!ready} onClick={() => window.CollectJS?.startPaymentRequest()} className="pressable mt-3 h-11 rounded-full bg-blue-700 px-5 text-[15px] font-semibold text-white disabled:bg-slate-300">
          {label}
        </button>
      </div>
    );
  }
  if (config.kind === "acceptui") {
    return (
      <button
        type="button"
        className="AcceptUI pressable h-11 rounded-full bg-blue-700 px-5 text-[15px] font-semibold text-white disabled:bg-slate-300"
        disabled={!ready}
        data-billingaddressoptions='{"show":false,"required":false}'
        data-apiloginid={config.apiLoginId}
        data-clientkey={config.clientKey}
        data-acceptuiformbtntxt={label}
        data-acceptuiformheadertxt={label}
        data-paymentoptions={JSON.stringify({ showCreditCard: kind === "card", showBankAccount: kind === "ach" })}
        data-responsehandler={`credaltiAccept${id}`}
        data-testid="hosted-fields-acceptui"
      >
        {label}
      </button>
    );
  }
  return null;
}
