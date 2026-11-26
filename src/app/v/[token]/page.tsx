import RequestLocaleProvider from "@/lib/i18n/RequestLocaleProvider";
import { requestLocale } from "@/lib/i18n/server";
import { VIDEO_COPY } from "@/lib/live/copy";
import { demoReviews, SAMPLE_VIDEO_URL } from "@/lib/live/demo";
import { demoLeadForToken } from "@/lib/live/demoFunnels";
import type { GoalKey } from "@/lib/sales/invite";
import { startHref, videoForToken, type VideoPage } from "@/lib/live/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { isDemoMode } from "@/lib/supabase/config";
import VideoView from "@/components/live/VideoView";

// A person's private video (/v/<token>, docs/LIVE-FUNNEL.md): the video the
// team recorded about the report they sent, and nothing else from it: no
// report data on the page, only their first name. «Get started» opens the
// signup with their invitation and the package they pick preselected
// (option=complete|diy); «Chat with us» opens WhatsApp. The link expires after
// 14 days; it is never indexed (noindex, and /v/ is in robots' disallow list),
// and link previews get a generic title with no name. The video itself is a
// short-lived signed link to the private bucket.

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { locale } = await requestLocale();
  return { title: VIDEO_COPY[locale].metaTitle, robots: { index: false, follow: false, nocache: true }, openGraph: { title: VIDEO_COPY[locale].metaTitle }, referrer: "no-referrer" as const };
}

export default async function VideoLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const now = new Date();
  let page: VideoPage;
  if (isDemoMode()) {
    // The demo's sample links: /v/demo (Angela's sample video) and the one a member "sends" from the review queue
    // (/v/demo-rosa, /v/demo-210). Always the labelled sample video; what the person does stays in this browser.
    const leadId = demoLeadForToken(token);
    const review = leadId ? demoReviews(now).find((r) => r.leadId === leadId) : undefined;
    const locale = (await requestLocale()).locale;
    if (review) {
      const firstName = review.firstName?.split(" ")[0] ?? null;
      const who = { firstName, goal: (review.goal as GoalKey | null) ?? null, state: review.state, locale, salesperson: null };
      page = {
        state: "ok",
        videoId: `demo-${review.id}`,
        src: SAMPLE_VIDEO_URL,
        firstName,
        locale,
        expiresAt: new Date(now.getTime() + 14 * 86_400_000).toISOString(),
        startHref: { complete: startHref(who, "complete"), diy: startHref(who, "diy") },
        sample: true,
      };
    } else page = { state: "gone", locale };
  } else {
    const db = getAdminClient();
    page = db ? await videoForToken(db, token, now) : { state: "gone", locale: "en" };
  }
  return (
    <RequestLocaleProvider>
      <VideoView page={page} token={token} whatsapp={process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || null} />
    </RequestLocaleProvider>
  );
}
