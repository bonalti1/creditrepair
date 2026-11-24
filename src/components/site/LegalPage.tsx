import SiteShell from "./SiteShell";
import { Container, PageHero, PendingBadge } from "./ui";
import type { Step } from "@/lib/site/copy";

/**
 * A legal placeholder page (/privacidad, /terminos): what can already be said
 * plainly and truthfully, marked "Draft · pending attorney review" at the top
 * and the bottom. The final text replaces `sections` once counsel approves it.
 */
export default function LegalPage({
  eyebrow,
  title,
  lead,
  sections,
  pending,
}: {
  eyebrow: string;
  title: string;
  lead: string;
  sections: Step[];
  pending: string;
}) {
  return (
    <SiteShell>
      <main>
        <PageHero eyebrow={eyebrow} title={title} lead={lead}>
          <div className="mt-6">
            <PendingBadge>{pending}</PendingBadge>
          </div>
        </PageHero>
        <section aria-label={title} className="py-12 sm:py-16">
          <Container narrow>
            <div className="divide-y divide-slate-200 rounded-3xl bg-white ring-1 ring-slate-200">
              {sections.map((s) => (
                <div key={s.title} className="p-6 sm:p-8">
                  <h2 className="text-[19px] font-semibold text-blue-900">{s.title}</h2>
                  <p className="mt-2 text-[16px] leading-relaxed text-slate-700">{s.body}</p>
                </div>
              ))}
            </div>
            <p className="mt-6 text-[14px] text-slate-500">{pending}</p>
          </Container>
        </section>
      </main>
    </SiteShell>
  );
}
