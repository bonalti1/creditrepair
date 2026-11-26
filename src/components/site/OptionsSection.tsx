import OptionComparison from "@/components/service/OptionComparison";
import { Container, Lead, SectionTitle } from "@/components/site/ui";
import { monitoringNote, optionPrices } from "@/lib/site/plans";
import { OPTIONS_SECTION_TEXT, type ServiceOption } from "@/lib/service/options";

// The two options on the website (/precios and /como-funciona): the side-by-
// side comparison with each option's offered plan price (or "Price set by the
// team"), and "Start with …" into the signup chat with that option chosen.

const startHref: Record<ServiceOption, string> = { full_service: "/registro?o=complete", diy: "/registro?o=diy" };

export default async function OptionsSection({ locale, id = "opciones" }: { locale: "en" | "es"; id?: string }) {
  const prices = await optionPrices(locale);
  const t = OPTIONS_SECTION_TEXT[locale];
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="py-14 sm:py-20">
      <Container>
        <SectionTitle id={`${id}-title`}>{t.title}</SectionTitle>
        <Lead className="mt-3">{t.lead}</Lead>
        <div className="mt-8">
          <OptionComparison locale={locale} prices={prices} monitoring={monitoringNote(locale)} startHref={startHref} />
        </div>
      </Container>
    </section>
  );
}
