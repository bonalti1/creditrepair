import RequestLocaleProvider from "@/lib/i18n/RequestLocaleProvider";
import { requestLocale } from "@/lib/i18n/server";
import { LIVE_COPY } from "@/lib/live/copy";
import { originFromParams, parseKeywords, prefillText } from "@/lib/live/keywords";
import { smsFunnelEnabled } from "@/lib/live/sms";
import { AFFILIATE_DISCLOSURE, MONITORING_OFFER } from "@/lib/monitoring/offer";
import LiveContent from "@/components/live/LiveContent";

// /live (docs/LIVE-FUNNEL.md): where the webinar's keyword reply, the link in
// the comments or the bio, and the ads lead. Phone first, English first and
// Spanish one tap away. Two big actions: chat with the team on WhatsApp (the
// keyword prefilled, with the campaign as a #tag), or get the credit report
// reviewed (a short form, then their own report). The link's src / kw / c
// tags ride along into the lead (first touch), with the ad tags the Ads
// Manager keeps (src/lib/ads/capture.ts). Kept out of search engines: it is a
// campaign page (src/lib/site/routes.ts PRIVATE_PATHS).

export async function generateMetadata() {
  const copy = LIVE_COPY[(await requestLocale()).locale];
  return { title: copy.metaTitle, description: copy.metaDescription, robots: { index: false, follow: false } };
}

export default async function LivePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const get = (name: string) => {
    const v = raw[name];
    return typeof v === "string" ? v : null;
  };
  const origin = originFromParams({ get });
  const keyword = origin.keyword ?? parseKeywords()[0]?.word ?? "CREDIT";
  return (
    <RequestLocaleProvider>
      <LiveContent
        origin={{ src: get("src"), kw: get("kw"), c: get("c") ?? get("campaign"), p: get("p") }}
        prefill={prefillText(keyword, origin.campaign)}
        whatsapp={process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || null}
        smsEnabled={smsFunnelEnabled()}
        identityIq={{ url: MONITORING_OFFER.signupUrl, disclosure: AFFILIATE_DISCLOSURE }}
      />
    </RequestLocaleProvider>
  );
}
