// Lob client (spec §4.2): after the user presses the approve button (the DIY
// moment), letters are printed and mailed via Lob. Thin fetch wrapper — no SDK
// dependency. Returns a queued placeholder when no API key is configured so the
// rest of the pipeline is testable end-to-end without a Lob account.

export interface MailAddress {
  name: string;
  addressLines: string[];
}

export interface MailResult {
  provider: "lob" | "stub";
  externalId: string;
  status: "queued" | "submitted";
}

export async function mailLetter(params: {
  to: MailAddress;
  from: MailAddress;
  bodyHtml: string;
  idempotencyKey: string;
}): Promise<MailResult> {
  const apiKey = process.env.LOB_API_KEY;
  if (!apiKey) {
    return { provider: "stub", externalId: `stub_${params.idempotencyKey}`, status: "queued" };
  }

  const [line1, line2] = params.to.addressLines;
  const [fromLine1, fromLine2] = params.from.addressLines;
  const cityStateZip = (line2 ?? line1 ?? "").match(/^(.*),\s*([A-Z]{2})\s+(\d{5}(-\d{4})?)$/);
  const fromCityStateZip = (fromLine2 ?? fromLine1 ?? "").match(/^(.*),\s*([A-Z]{2})\s+(\d{5}(-\d{4})?)$/);

  const body = new URLSearchParams({
    description: `Round letter ${params.idempotencyKey}`,
    "to[name]": params.to.name,
    "to[address_line1]": line1 ?? "",
    "to[address_city]": cityStateZip?.[1] ?? "",
    "to[address_state]": cityStateZip?.[2] ?? "",
    "to[address_zip]": cityStateZip?.[3] ?? "",
    "from[name]": params.from.name,
    "from[address_line1]": fromLine1 ?? "",
    "from[address_city]": fromCityStateZip?.[1] ?? "",
    "from[address_state]": fromCityStateZip?.[2] ?? "",
    "from[address_zip]": fromCityStateZip?.[3] ?? "",
    file: params.bodyHtml,
    color: "false",
  });

  const res = await fetch("https://api.lob.com/v1/letters", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": params.idempotencyKey,
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`Lob error ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { id: string };
  return { provider: "lob", externalId: json.id, status: "submitted" };
}
