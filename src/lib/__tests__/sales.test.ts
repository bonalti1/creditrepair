import { describe, expect, it } from "vitest";
import { checkMarketingCopy } from "@/lib/compliance/guardrails";
import { buildInvitePath, inviteMessageEs, parseInvite, toRefSlug } from "@/lib/sales/invite";

const parse = (path: string) => parseInvite(new URLSearchParams(path.split("?")[1] ?? ""));

describe("sales invite link", () => {
  it("round-trips what the salesperson entered", () => {
    const path = buildInvitePath({ name: "María José", goal: "mortgage", state: "tx", refName: "Ana" });
    expect(path.startsWith("/onboarding?")).toBe(true);
    expect(parse(path)).toEqual({ name: "María José", goal: "mortgage", state: "TX", ref: "ana", refName: "Ana" });
  });

  it("holds no phone number or other contact detail", () => {
    const path = buildInvitePath({ name: "María", goal: "auto", state: "TX", refName: "Ana" });
    expect(path).not.toMatch(/\d{7,}|@/);
  });

  it("strips markup and digits from names instead of showing them to the customer", () => {
    const invite = parse('/onboarding?n=<img src=x onerror=1>Ana&rn=Bob"onclick=1&g=mortgage');
    expect(invite?.name).toBe("img srcx onerrorAna".slice(0, 30));
    expect(invite?.name).not.toMatch(/[<>="\d]/);
    expect(invite?.refName).not.toMatch(/[<>="\d]/);
  });

  it("ignores a goal or state it does not recognise", () => {
    const invite = parse("/onboarding?n=Luis&g=free-money&s=ZZ");
    expect(invite).toEqual({ name: "Luis", goal: null, state: null, ref: null, refName: null });
  });

  it("treats a link with nothing usable as ordinary onboarding", () => {
    expect(parse("/onboarding")).toBeNull();
    expect(parse("/onboarding?g=nope&s=99&n=1")).toBeNull();
  });

  it("makes a safe attribution handle from a name", () => {
    expect(toRefSlug("Ana María Peña")).toBe("ana-maria-pena");
    expect(toRefSlug("  ")).toBeNull();
    expect(toRefSlug("../../admin")).toBe("admin");
    expect(toRefSlug("a".repeat(80))!.length).toBe(30);
  });

  it("writes a message that stays inside the claim rules", () => {
    const message = inviteMessageEs({ name: "María" }, "https://app.example/onboarding?n=Mar%C3%ADa");
    expect(message).toContain("¡Listo, María!");
    expect(message).toContain("https://app.example/onboarding");
    expect(message).toMatch(/Tú decides/);
    expect(message).toMatch(/asistente con IA/);
    expect(checkMarketingCopy(message)).toEqual([]);
  });
});
