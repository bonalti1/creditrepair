import RequestLocaleProvider from "@/lib/i18n/RequestLocaleProvider";
import { requestLocale } from "@/lib/i18n/server";
import { VIDEO_COPY } from "@/lib/live/copy";
import { DEMO_VIDEO_TOKEN, SAMPLE_VIDEO_URL } from "@/lib/live/demo";
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
    page =
      token === DEMO_VIDEO_TOKEN
        ? {
            state: "ok",
            videoId: "demo",
            src: SAMPLE_VIDEO_URL,
            firstName: "Angela",
            locale: (await requestLocale()).locale,
            expiresAt: new Date(now.getTime() + 14 * 86_400_000).toISOString(),
            startHref: {
              complete: startHref({ firstName: "Angela", goal: "card", state: "TX", locale: "en", salesperson: null }, "complete"),
              diy: startHref({ firstName: "Angela", goal: "card", state: "TX", locale: "en", salesperson: null }, "diy"),
            },
            sample: true,
          }
        : { state: "gone", locale: (await requestLocale()).locale };
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
