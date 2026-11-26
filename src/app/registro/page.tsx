import SignupChat from "@/components/signup/SignupChat";
import { callsEnabled } from "@/lib/calls/config";
import { softPullProvider } from "@/lib/credit/softPull";
import { inRequestLocale } from "@/lib/i18n/server";
import { SIGNUP_COPY } from "@/lib/signup/copy";
import { SITE_COPY } from "@/lib/site/copy";
import { monitoringNote, optionPrices, publicPlans } from "@/lib/site/plans";

// /registro: sign up in one chat with Alti, the AI assistant
// (docs/SIGNUP-CHAT.md). One more way in, beside /onboarding, /acuerdo and
// the salesperson's invitation. The server hands the chat what only it
// knows: the attorney-approved, offered plans (none: the rule only, as
// /precios shows it), whether calls are on (off by default), and which
// soft-pull provider is connected (none by default).

export async function generateMetadata() {
  return inRequestLocale({
    en: { title: SIGNUP_COPY.en.metaTitle, description: SIGNUP_COPY.en.metaDescription, robots: { index: false, follow: true } },
    es: { title: SIGNUP_COPY.es.metaTitle, description: SIGNUP_COPY.es.metaDescription, robots: { index: false, follow: true } },
  });
}

export default async function Registro() {
  const [en, es, pricesEn, pricesEs] = await Promise.all([publicPlans("en"), publicPlans("es"), optionPrices("en"), optionPrices("es")]);
  return (
    <SignupChat
      plans={{ en, es }}
      optionPrices={{ en: pricesEn, es: pricesEs }}
      monitoringNote={{ en: monitoringNote("en"), es: monitoringNote("es") }}
      rules={{ en: [...SITE_COPY.en.pricing.rules], es: [...SITE_COPY.es.pricing.rules] }}
      callsEnabled={callsEnabled()}
      softPullProvider={softPullProvider().id}
    />
  );
}
