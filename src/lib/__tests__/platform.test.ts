import { beforeEach, describe, expect, it } from "vitest";
import { toE164, toModelMessages } from "@/lib/chat/history";
import { resetAlertThrottle, shouldAlert } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { checkRateLimit, clientIp, rateLimit, resetRateLimits } from "@/lib/security/rateLimit";
import { hasSharedSecret, safeEqual, signMetaPayload, verifyMetaSignature } from "@/lib/security/signatures";

describe("rate limiter", () => {
  beforeEach(() => resetRateLimits());

  it("allows up to the limit, then refuses until the window resets", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) expect(checkRateLimit("k", 3, 60_000, t0 + i).allowed).toBe(true);
    const blocked = checkRateLimit("k", 3, 60_000, t0 + 10);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBe(60);
    expect(checkRateLimit("k", 3, 60_000, t0 + 60_001).allowed).toBe(true);
  });

  it("counts callers separately", () => {
    expect(checkRateLimit("a", 1, 1000, 0).allowed).toBe(true);
    expect(checkRateLimit("b", 1, 1000, 0).allowed).toBe(true);
    expect(checkRateLimit("a", 1, 1000, 1).allowed).toBe(false);
  });

  it("answers 429 with Retry-After from the route helper", async () => {
    const req = () => new Request("https://x.test/api/coach", { headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" } });
    expect(clientIp(req())).toBe("203.0.113.9");
    expect(rateLimit(req(), "t", { limit: 1, windowMs: 60_000 })).toBeNull();
    const res = rateLimit(req(), "t", { limit: 1, windowMs: 60_000 });
    expect(res?.status).toBe(429);
    expect(Number(res?.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});

describe("bounded body reader", () => {
  const post = (body: string, headers: Record<string, string> = {}) =>
    new Request("https://x.test", { method: "POST", body, headers });

  it("parses a normal body", async () => {
    expect(await readJsonBody(post('{"a":1}'), 100)).toEqual({ ok: true, data: { a: 1 } });
  });

  it("refuses an oversized body before parsing it, whatever the header claims", async () => {
    const big = JSON.stringify({ items: Array.from({ length: 5000 }, (_, i) => i) });
    expect(await readJsonBody(post(big), 1000)).toEqual({ ok: false, status: 413 });
    expect(await readJsonBody(post(big, { "content-length": "10" }), 1000)).toEqual({ ok: false, status: 413 });
  });

  it("reports malformed JSON as a bad request", async () => {
    expect(await readJsonBody(post("not json"), 100)).toEqual({ ok: false, status: 400 });
  });
});

describe("webhook signatures", () => {
  const secret = "app-secret";
  const body = JSON.stringify({ entry: [{ changes: [] }] });

  it("accepts a correctly signed WhatsApp delivery", () => {
    expect(verifyMetaSignature(body, signMetaPayload(body, secret), secret)).toBe(true);
  });

  it("rejects a missing, malformed, wrong-secret or tampered delivery", () => {
    expect(verifyMetaSignature(body, null, secret)).toBe(false);
    expect(verifyMetaSignature(body, "sha1=abc", secret)).toBe(false);
    expect(verifyMetaSignature(body, signMetaPayload(body, "other"), secret)).toBe(false);
    expect(verifyMetaSignature(body + " ", signMetaPayload(body, secret), secret)).toBe(false);
  });

  it("checks shared secrets without accepting an empty or absent one", () => {
    const req = (value?: string) =>
      new Request("https://x.test", { headers: value === undefined ? {} : { "x-webhook-secret": value } });
    expect(hasSharedSecret(req("s3cret"), "s3cret")).toBe(true);
    expect(hasSharedSecret(req("s3cre"), "s3cret")).toBe(false);
    expect(hasSharedSecret(req(), "s3cret")).toBe(false);
    expect(hasSharedSecret(req(""), undefined)).toBe(false);
    expect(safeEqual("a", "a")).toBe(true);
    expect(safeEqual("a", "ab")).toBe(false);
  });
});

describe("error alerts", () => {
  beforeEach(() => resetAlertThrottle());

  it("sends the same alert at most once per five minutes", () => {
    expect(shouldAlert("lob|Error|timeout", 0)).toBe(true);
    expect(shouldAlert("lob|Error|timeout", 60_000)).toBe(false);
    expect(shouldAlert("coach|Error|timeout", 60_000)).toBe(true);
    expect(shouldAlert("lob|Error|timeout", 5 * 60_000 + 1)).toBe(true);
  });
});

describe("chat history helpers", () => {
  it("normalises WhatsApp sender ids to E.164", () => {
    expect(toE164("15551234567")).toBe("+15551234567");
    expect(toE164("+1 (555) 123-4567")).toBe("+15551234567");
    expect(toE164("")).toBe("");
  });

  it("gives the model a thread that opens with the client and is capped", () => {
    const turns = [
      { role: "assistant" as const, text: "Hola, soy Capi." },
      { role: "user" as const, text: "¿Qué es una cobranza?" },
      { role: "assistant" as const, text: "Es una deuda enviada a un cobrador." },
      { role: "user" as const, text: "¿Y qué hago?" },
    ];
    expect(toModelMessages(turns).map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(toModelMessages([{ role: "assistant", text: "Hola" }])).toEqual([]);
    const long = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? ("assistant" as const) : ("user" as const), text: `m${i}` }));
    expect(toModelMessages(long, 12).length).toBeLessThanOrEqual(12);
    expect(toModelMessages(long, 12)[0]!.role).toBe("user");
  });
});

describe("login gate file", () => {
  // The framework only loads the gate from next to the app folder. At the
  // repository root it is silently ignored and every app page is left open,
  // which is how it sat until this test existed.
  it("lives in src/, beside app/, and exports proxy with the protected paths", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    expect(existsSync("src/proxy.ts")).toBe(true);
    expect(existsSync("proxy.ts")).toBe(false);
    expect(existsSync("middleware.ts")).toBe(false);
    const source = readFileSync("src/proxy.ts", "utf8");
    expect(source).toMatch(/export async function proxy\(/);
    for (const path of ["/asistente", "/mas", "/dashboard", "/audit", "/items", "/attack", "/rounds", "/goal", "/equipo"]) {
      expect(source).toContain(`"${path}/:path*"`);
    }
  });
});
