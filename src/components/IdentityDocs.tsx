"use client";

import { useEffect, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { useLocale } from "@/lib/i18n";

// Identity documents: bureaus routinely reject or stall disputes that arrive
// without a copy of ID + proof of address. Uploaded once, listed as enclosures
// on every letter.
//
// The upload goes through the server (/api/intake/document), which keeps the
// file in the private 'identity-docs' bucket (path {userId}/{kind}, as the
// letters expect), records it, and checks it automatically
// (src/lib/intake/identity.ts): the right kind of document, readable, not
// expired, the client's name, and for proof of address the mailing address on
// file and a recent date. "Revisado automáticamente" when it passes; otherwise
// a person on the team looks at it.
//
// Demo: the same screen, with a simulated check (labelled) and nothing stored.

const KINDS = [
  { kind: "government_id", es: "Identificación oficial con foto", en: "Government photo ID" },
  { kind: "proof_of_address", es: "Comprobante de domicilio", en: "Proof of address" },
] as const;

type Kind = (typeof KINDS)[number]["kind"];

interface Check {
  status: "accepted" | "needs_person" | "read" | "failed";
  reasons: string[];
  simulated: boolean;
}

export default function IdentityDocs() {
  const { locale } = useLocale();
  const es = locale === "es";
  const supabase = getBrowserSupabase();
  const [userId, setUserId] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<Record<string, boolean>>({});
  const [checks, setChecks] = useState<Partial<Record<Kind, Check>>>({});
  const [problems, setProblems] = useState<Partial<Record<Kind, string>>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      setUserId(data.user.id);
      const { data: rows } = await supabase.from("identity_documents").select("kind").eq("user_id", data.user.id);
      const map: Record<string, boolean> = {};
      for (const r of rows ?? []) map[r.kind] = true;
      setUploaded(map);
      const response = await fetch("/api/intake/document").catch(() => null);
      const body = response?.ok ? ((await response.json()) as { checks?: Array<Check & { kind: Kind }> }) : null;
      setChecks(Object.fromEntries((body?.checks ?? []).map((c) => [c.kind, c])));
    });
  }, [supabase]);

  // With a database the client must be signed in; in the demo anyone can try the check.
  const canUpload = !supabase || Boolean(userId);

  const upload = async (kind: Kind, file: File) => {
    setBusy(kind);
    setProblems((p) => ({ ...p, [kind]: undefined }));
    try {
      const form = new FormData();
      form.set("kind", kind);
      form.set("file", file);
      const response = await fetch("/api/intake/document", { method: "POST", body: form });
      const body = (await response.json().catch(() => ({}))) as Partial<Check> & { error?: string };
      if (!response.ok || !body.status) {
        setProblems((p) => ({ ...p, [kind]: body.error ?? (es ? "No se pudo subir. Intenta de nuevo." : "Could not upload. Please try again.") }));
        return;
      }
      setUploaded((u) => ({ ...u, [kind]: true }));
      setChecks((c) => ({ ...c, [kind]: { status: body.status!, reasons: body.reasons ?? [], simulated: body.simulated === true } }));
    } catch {
      setProblems((p) => ({ ...p, [kind]: es ? "No se pudo subir. Revisa tu conexión." : "Could not upload. Check your connection." }));
    } finally {
      setBusy(null);
    }
  };

  const title = es ? "Tus documentos de identidad" : "Your identity documents";
  const why = es
    ? "Los burós suelen exigir copia de tu identificación y comprobante de domicilio con cada disputa. Toma una foto clara de cada uno, una sola vez, y se adjuntan a todas tus cartas."
    : "Bureaus typically require a copy of your ID and proof of address with each dispute. Take one clear photo of each, once, and they are attached to all your letters.";

  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4" data-testid="identity-docs">
      <p className="font-semibold">🪪 {title}</p>
      <p className="mt-1 text-sm text-slate-600">{why}</p>
      {!canUpload ? (
        <p className="mt-2 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-500">
          {es ? "Inicia sesión para subir tus documentos." : "Sign in to upload your documents."}
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {KINDS.map((k) => {
            const check = checks[k.kind];
            return (
              <div key={k.kind} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" data-testid={`doc-${k.kind}`}>
                <label className="flex items-center justify-between gap-3">
                  <span>
                    {uploaded[k.kind] ? "✅ " : "📎 "}
                    {es ? k.es : k.en}
                  </span>
                  <span className="cursor-pointer rounded bg-amber-400 px-3 py-1 text-xs font-semibold text-blue-900">
                    {busy === k.kind ? (es ? "Revisando…" : "Checking…") : uploaded[k.kind] ? (es ? "Reemplazar" : "Replace") : es ? "Subir" : "Upload"}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,application/pdf,.heic,.heif"
                      className="hidden"
                      disabled={busy !== null}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (f) void upload(k.kind, f);
                      }}
                    />
                  </span>
                </label>
                {problems[k.kind] && (
                  <p className="mt-1.5 text-xs leading-relaxed text-red-700" role="alert">
                    {problems[k.kind]}
                  </p>
                )}
                {check && (
                  <div
                    className={`mt-2 rounded-lg px-2.5 py-2 text-xs leading-relaxed ${check.status === "accepted" ? "bg-green-50 text-green-800" : "bg-amber-50 text-blue-900"}`}
                    data-testid={`check-${check.status}`}
                  >
                    <p className="font-semibold">
                      {check.status === "accepted"
                        ? es
                          ? "Revisado automáticamente"
                          : "Checked automatically"
                        : es
                          ? "Una persona del equipo lo va a revisar"
                          : "A person on the team will review it"}
                      {check.simulated && (es ? " · simulado" : " · simulated")}
                    </p>
                    <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
                      {check.reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                    {check.status !== "accepted" && (
                      <p className="mt-1">{es ? "Si quieres, sube una foto nueva, completa y bien iluminada." : "If you like, upload a new, complete, well-lit photo."}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <p className="text-[11px] leading-relaxed text-slate-500">
            {es
              ? "Una revisión automática con IA comprueba que el documento se lea y coincida con tu cuenta. No guardamos los números de tu identificación."
              : "An automatic AI check confirms the document is readable and matches your account. We do not store your ID numbers."}
          </p>
        </div>
      )}
    </div>
  );
}
