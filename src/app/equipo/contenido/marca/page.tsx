"use client";

import { useTx } from "@/lib/staff/i18n/StaffLocale";
import BrandKit from "@/components/staff/content/BrandKit";
import { ContentGate, ContentHeader } from "@/components/staff/content/ui";

// The brand kit: one place a designer or a VA learns the brand. Read-only,
// from the sources of truth (src/lib/content/brandKit.ts). Every role on the
// team may open it (content.share).

export default function BrandKitPage() {
  const t = useTx();
  return (
    <ContentGate needs="content.share" title={t("Kit de marca", "Brand kit")}>
      <main className="animate-rise">
        <ContentHeader
          title={t("Kit de marca", "Brand kit")}
          lead={t("El logo, los colores, las fuentes, Alti, la voz y las reglas de lo que decimos. Sale de los archivos de la marca; nada aquí se edita a mano.", "The logo, colours, fonts, Alti, the voice and the claim rules. Read from the brand's own files; nothing here is edited by hand.")}
        />
        <BrandKit />
      </main>
    </ContentGate>
  );
}
