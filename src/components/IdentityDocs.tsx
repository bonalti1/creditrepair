"use client";

import { useEffect, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { useLocale } from "@/lib/i18n";

// Identity documents: bureaus routinely reject or stall disputes that arrive
// without a copy of ID + proof of address. Uploaded once, listed as enclosures
// on every letter. Demo mode shows the explanation; authed mode uploads to the
// private 'identity-docs' bucket (path {userId}/{kind}, RLS-scoped).

const KINDS = [
  { kind: "government_id", es: "Identificación oficial con foto", en: "Government photo ID" },
  { kind: "proof_of_address", es: "Comprobante de domicilio", en: "Proof of address" },
] as const;

export default function IdentityDocs() {
  const { locale } = useLocale();
  const supabase = getBrowserSupabase();
  const [userId, setUserId] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      setUserId(data.user.id);
      const { data: rows } = await supabase
        .from("identity_documents")
        .select("kind")
        .eq("user_id", data.user.id);
      const map: Record<string, boolean> = {};
      for (const r of rows ?? []) map[r.kind] = true;
      setUploaded(map);
    });
  }, [supabase]);

  const upload = async (kind: string, file: File) => {
    if (!supabase || !userId) return;
    setBusy(kind);
    try {
      const ext = file.name.split(".").pop() ?? "pdf";
      const path = `${userId}/${kind}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("identity-docs")
        .upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      await supabase
        .from("identity_documents")
        .upsert({ user_id: userId, kind, storage_path: path }, { onConflict: "user_id,kind" });
      setUploaded((u) => ({ ...u, [kind]: true }));
    } catch {
      // surfaced via missing checkmark; keep quiet in scaffold
    } finally {
      setBusy(null);
    }
  };

  const title = locale === "es" ? "Tus documentos de identidad" : "Your identity documents";
  const why =
    locale === "es"
      ? "Los burós suelen exigir copia de tu identificación y comprobante de domicilio con cada disputa. Súbelos una vez y se listan como anexos en todas tus cartas."
      : "Bureaus typically require a copy of your ID and proof of address with each dispute. Upload once and they're listed as enclosures on all your letters.";
  const demoNote =
    locale === "es"
      ? "Disponible al activar tu cuenta — en la demo, las cartas se generan sin anexos."
      : "Available once your account is active — demo letters generate without enclosures.";

  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
      <p className="font-semibold">🪪 {title}</p>
      <p className="mt-1 text-sm text-slate-600">{why}</p>
      {!userId ? (
        <p className="mt-2 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-500">{demoNote}</p>
      ) : (
        <div className="mt-3 space-y-2">
          {KINDS.map((k) => (
            <label
              key={k.kind}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <span>
                {uploaded[k.kind] ? "✅ " : "📎 "}
                {locale === "es" ? k.es : k.en}
              </span>
              <span className="cursor-pointer rounded bg-blue-700 px-3 py-1 text-xs font-semibold text-white">
                {busy === k.kind ? "…" : uploaded[k.kind] ? (locale === "es" ? "Reemplazar" : "Replace") : locale === "es" ? "Subir" : "Upload"}
                <input
                  type="file"
                  accept="image/*,.pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) upload(k.kind, f);
                  }}
                />
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
