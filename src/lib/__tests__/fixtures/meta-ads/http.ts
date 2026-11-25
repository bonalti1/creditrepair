import { readFileSync } from "node:fs";
import { join } from "node:path";

// A stand-in for Meta's Graph API in the tests: answers each GET from the
// fixture JSON next to this file, records every call (method, URL, headers),
// and refuses anything that is not a GET. No live call is ever made.

const dir = join(process.cwd(), "src/lib/__tests__/fixtures/meta-ads");
export const fixture = (name: string): unknown => JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8"));

export interface Call {
  method: string;
  url: string;
  authorization: string | null;
}

export function fakeMeta(options: { failWith?: string; insights?: unknown } = {}) {
  const calls: Call[] = [];
  const http = async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    calls.push({ method, url, authorization: headers.get("authorization") });
    if (method !== "GET") return new Response(JSON.stringify({ error: { message: "read only", code: 3 } }), { status: 400 });
    if (options.failWith) return new Response(JSON.stringify(fixture(options.failWith)), { status: 400 });
    const u = new URL(url);
    const path = u.pathname.replace(/^\/v\d+\.\d+\//, "");
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    if (path === "act_123456789") return json(fixture("account"));
    if (path === "act_123456789/campaigns") return json(fixture(u.searchParams.get("after") ? "campaigns-2" : "campaigns-1"));
    if (path === "act_123456789/adsets") return json(fixture("adsets"));
    if (path === "act_123456789/ads") return json(fixture("ads"));
    if (path === "act_123456789/insights") return json(options.insights ?? fixture("insights"));
    if (path === "400000000000001") return json({ id: "400000000000001", source: "https://video.xx.fbcdn.net/v/clip1.mp4", picture: "https://scontent.xx.fbcdn.net/v/pic1.jpg" });
    return new Response(JSON.stringify({ error: { message: `unknown path ${path}`, code: 100 } }), { status: 404 });
  };
  return { http, calls };
}

export const META_ENV = { META_ADS_ACCESS_TOKEN: "EAAtesttoken", META_AD_ACCOUNT_ID: "act_123456789" } as Record<string, string>;
