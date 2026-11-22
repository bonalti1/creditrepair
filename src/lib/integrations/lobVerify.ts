import { parseUsAddress } from "../mail/address";
import { interpretLobVerification, lobVerificationRequest, uncheckedAddress, VERIFICATION_COST_MILLS, type VerifiedAddress } from "../mail/verify";

// Lob's US address verification (POST /v1/us_verifications). What was checked
// against Lob's own schema, and what was assumed, is written in
// src/lib/mail/verify.ts. Without LOB_API_KEY nothing is called: the address
// comes back "unchecked" (and the mail service is simulated in that case
// too, so no real letter goes to an address nobody verified).

const LOB_VERIFY_URL = "https://api.lob.com/v1/us_verifications";

export type VerifyFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

/** One address checked with Lob. Throws on a network or API error: the caller refuses to mail rather than guess. */
export async function verifyWithLob(lines: readonly string[], options: { fetchImpl?: VerifyFetch; apiKey?: string } = {}): Promise<VerifiedAddress> {
  const apiKey = options.apiKey ?? process.env.LOB_API_KEY;
  if (!apiKey) return uncheckedAddress(lines);
  const parsed = parseUsAddress([...lines]);
  // An address that does not even parse is never sent anywhere: undeliverable as written.
  if (!parsed.ok) return { result: "undeliverable", deliverability: "unreadable", lines: [...lines], suggestion: [], provider: "lob", costMills: 0 };
  const doFetch = options.fetchImpl ?? (fetch as unknown as VerifyFetch);
  const res = await doFetch(LOB_VERIFY_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(lobVerificationRequest(parsed.address)),
  });
  if (!res.ok) throw new Error(`Lob verification error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  return { ...interpretLobVerification(json, lines), provider: "lob", costMills: VERIFICATION_COST_MILLS };
}
