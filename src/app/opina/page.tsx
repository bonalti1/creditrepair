import RequestLocaleProvider from "@/lib/i18n/RequestLocaleProvider";
import OpinaContent from "@/components/reviews/OpinaContent";
import { BRAND } from "@/lib/brand";
import { inRequestLocale } from "@/lib/i18n/server";

// /opina (server wrapper): the review sites for anyone, in the visitor's language (?lang= from the message).

export async function generateMetadata() {
  return { title: `${await inRequestLocale({ en: "Leave a review", es: "Deja una reseña" })} · ${BRAND.name}` };
}

export default function Opina() {
  return (
    <RequestLocaleProvider>
      <OpinaContent />
    </RequestLocaleProvider>
  );
}
