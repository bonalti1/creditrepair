import { NextResponse } from "next/server";

// Fixed-window rate limiter, kept in process memory. It is the first line of
// defence for endpoints that cost money (the AI coach) or attract spam (the
// waitlist). On serverless hosting each instance keeps its own counters, so
// the effective limit is "per instance": good enough to stop a script hammering
// one endpoint, not a substitute for the platform's edge firewall.

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets. */
  retryAfter: number;
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) sweep(now);
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  return {
    allowed: bucket.count <= limit,
    remaining: Math.max(0, limit - bucket.count),
    retryAfter,
  };
}

function sweep(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  // Still full of live windows: drop the oldest entries rather than grow without bound.
  if (buckets.size >= MAX_BUCKETS) {
    const excess = buckets.size - MAX_BUCKETS + 1;
    let dropped = 0;
    for (const key of buckets.keys()) {
      buckets.delete(key);
      if (++dropped >= excess) break;
    }
  }
}

/** Best-effort caller address. Behind a proxy the first forwarded hop is the client. */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

/**
 * Route helper: returns a 429 response when the caller is over the limit,
 * otherwise null. `scope` names the endpoint; `subject` defaults to the IP.
 */
export function rateLimit(
  req: Request,
  scope: string,
  options: { limit: number; windowMs: number; subject?: string },
): NextResponse | null {
  const subject = options.subject ?? clientIp(req);
  const result = checkRateLimit(`${scope}:${subject}`, options.limit, options.windowMs);
  if (result.allowed) return null;
  return NextResponse.json(
    { error: "Too many requests. Please wait a moment and try again." },
    { status: 429, headers: { "Retry-After": String(result.retryAfter) } },
  );
}

/** Test hook. */
export function resetRateLimits() {
  buckets.clear();
}
