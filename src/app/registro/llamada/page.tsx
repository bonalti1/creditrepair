import { notFound } from "next/navigation";
import CallBooking from "@/components/signup/CallBooking";
import { callsEnabled } from "@/lib/calls/config";
import { inRequestLocale } from "@/lib/i18n/server";
import { BRAND } from "@/lib/brand";

// /registro/llamada: schedule a call with a person (docs/SIGNUP-CHAT.md).
// Built, and OFF by default: with NEXT_PUBLIC_CALLS_ENABLED unset this page
// does not exist (404) and no link points to it. When on, the call is for
// questions only: signing up and any payment happen afterwards, in writing,
// in the app, never on the call (Telemarketing Sales Rule, 16 C.F.R.
// 310.4(a)(2); the general-media exemption does not apply, 310.6(b)(5)).

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return inRequestLocale({
    en: { title: `Schedule a call · ${BRAND.name}`, robots: { index: false, follow: false } },
    es: { title: `Agenda una llamada · ${BRAND.name}`, robots: { index: false, follow: false } },
  });
}

export default function Llamada() {
  if (!callsEnabled()) notFound();
  return <CallBooking />;
}
