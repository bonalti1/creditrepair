import { NextResponse } from "next/server";
import { reportError } from "@/lib/observability/errors";
import { livePlatforms } from "@/lib/reviews/reviews";
import { loadReviewPlatforms } from "@/lib/reviews/server";
import { rateLimit } from "@/lib/security/rateLimit";
import { getAdminClient } from "@/lib/supabase/admin";

// The review sites for the public page (/opina) and the pulse: the same links,
// in the same order, for everyone. Only the site and its link: never a rating,
// a count or anything about who was asked.

export async function GET(req: Request) {
  const limited = rateLimit(req, "review-links", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const db = getAdminClient();
  if (!db) return NextResponse.json({ platforms: [] });
  try {
    const platforms = livePlatforms(await loadReviewPlatforms(db)).map((p) => ({ key: p.key, url: p.url, enabled: true, rating: null, reviewCount: null, ratingUpdatedAt: null, ratingUpdatedBy: null }));
    return NextResponse.json({ platforms });
  } catch (error) {
    await reportError(error, { where: "api/reviews" });
    return NextResponse.json({ platforms: [] });
  }
}
