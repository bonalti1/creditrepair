import { NextResponse } from "next/server";
import { newNonce, signState, tokenKey, verifyState } from "@/lib/content/publish/crypto";
import { PROVIDERS } from "@/lib/content/publish/gates";
import type { ProviderId } from "@/lib/content/publish/types";
import { saveConnection } from "@/lib/content/server";
import { reportError } from "@/lib/observability/errors";
import { requireCapability } from "@/lib/staff/access";

// Connecting a social account with OAuth, from /equipo/contenido/publicar.
// Administrators only (content.publish). One route for both halves:
//
//   GET /api/staff/content/connect/meta            → the provider's consent page
//   GET /api/staff/content/connect/meta?code=…     ← the provider sends the person back
//
// The "state" is signed (HMAC, CONTENT_TOKEN_KEY), names the provider and the
// administrator who started, expires in 10 minutes, and its nonce must match
// an httpOnly cookie set on this browser, so a link cannot be replayed or
// started by someone else. The tokens are encrypted before they are stored,
// and never returned: the person lands back on the settings screen with
// ?connected= or ?error=.

const COOKIE = "credalti.content_oauth";
const BACK = "/equipo/contenido/publicar";

function isProvider(value: string): value is ProviderId {
  return value === "meta" || value === "tiktok" || value === "youtube";
}

function base(req: Request): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin).replace(/\/$/, "");
}

function back(req: Request, query: string): NextResponse {
  const res = NextResponse.redirect(`${base(req)}${BACK}?${query}`, 303);
  res.cookies.set(COOKIE, "", { path: "/api/staff/content/connect", maxAge: 0 });
  return res;
}

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: name } = await params;
  if (!isProvider(name)) return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
  const allowed = await requireCapability("content.publish");
  if (!allowed.ok) return allowed.response;
  const provider = PROVIDERS[name];
  const key = tokenKey();
  if (!key || !provider.configured(process.env)) return back(req, `error=not_configured&provider=${name}`);
  const url = new URL(req.url);
  const redirectUri = `${base(req)}/api/staff/content/connect/${name}`;

  const code = url.searchParams.get("code");
  if (!code) {
    if (url.searchParams.get("error")) return back(req, `error=declined&provider=${name}`);
    const nonce = newNonce();
    const state = signState({ provider: name, userId: allowed.member.userId, nonce, expires: Date.now() + 10 * 60_000 }, key);
    const res = NextResponse.redirect(provider.authorizeUrl({ state, redirectUri, env: process.env }), 303);
    res.cookies.set(COOKIE, nonce, { httpOnly: true, secure: url.protocol === "https:", sameSite: "lax", path: "/api/staff/content/connect", maxAge: 600 });
    return res;
  }

  const state = verifyState(url.searchParams.get("state") ?? "", key);
  const cookie = req.headers.get("cookie")?.match(new RegExp(`(?:^|; )${COOKIE.replace(".", "\\.")}=([^;]+)`))?.[1] ?? null;
  if (!state || state.provider !== name || state.userId !== allowed.member.userId || !cookie || cookie !== state.nonce) {
    return back(req, `error=state&provider=${name}`);
  }
  try {
    const grant = await provider.exchangeCode({ code: code.slice(0, 2000), redirectUri, env: process.env }, fetch);
    if (!grant.accessToken) return back(req, `error=no_token&provider=${name}`);
    await saveConnection(allowed.db, { userId: allowed.member.userId, handle: allowed.member.handle }, name, grant, key);
    return back(req, `connected=${name}`);
  } catch (error) {
    await reportError(error, { where: "api/staff/content/connect", userId: allowed.member.userId, extra: { provider: name } });
    return back(req, `error=exchange&provider=${name}`);
  }
}
