"use client";

import { useCallback, useEffect, useState } from "react";
import { NoAccess, PRIMARY_BUTTON, ROW_BUTTON, SECONDARY_BUTTON, SectionTitle } from "@/components/staff/ui";
import { OfferCard } from "@/components/aftercare/AftercareViews";
import { readDemoAccepting, writeDemoAccepting } from "@/lib/aftercare/connect";
import {
  DEFAULT_AFFILIATE_DISCLOSURE,
  OFFER_KIND_LABEL,
  OFFER_KINDS,
  offerInputSchema,
  rankOffers,
  readDemoOffers,
  writeDemoOffers,
  yearlyCostLabel,
  type Offer,
  type OfferInput,
  type OfferKind,
} from "@/lib/aftercare/offers";
import { buildDemoPartners } from "@/lib/partners/demo";
import { deniedReason } from "@/lib/staff/permissions";
import { useStaff } from "@/lib/staff/useStaff";
import { useTx } from "@/lib/staff/i18n/StaffLocale";

// Partner offers (/equipo/ofertas), administrators only. The owner adds
// vetted credit-building products: name, type, provider, cost to the client,
// link, ITIN-friendly or not, and the affiliate disclosure. The marketplace is
// OFF until an administrator turns it on. Clients see active offers cheapest
// first, then by name: there is no commission field to rank by. Also here:
// which partner loan officers accept new clients ("Connect me with a loan
// officer"). Attorney questions: docs/AFTERCARE.md.

interface Officer {
  id: string;
  name: string;
  company: string | null;
  accepting: boolean;
}

interface Form {
  id: string | null;
  name: string;
  kind: OfferKind;
  provider: string;
  cost: string;
  costNote: string;
  url: string;
  itinFriendly: boolean;
  affiliate: boolean;
  affiliateDisclosure: string;
  active: boolean;
}

const EMPTY: Form = { id: null, name: "", kind: "secured_card", provider: "", cost: "0", costNote: "", url: "https://", itinFriendly: false, affiliate: false, affiliateDisclosure: DEFAULT_AFFILIATE_DISCLOSURE, active: true };

const field = "h-11 w-full rounded-xl bg-white px-3 text-[15px] text-slate-900 shadow-[0_0_0_1px_rgba(0,0,0,0.12)] outline-none focus:ring-2 focus:ring-blue-300";

function toInput(f: Form): OfferInput | null {
  const cents = Math.round(Number(f.cost.replace(/[$,\s]/g, "")) * 100);
  const parsed = offerInputSchema.safeParse({
    name: f.name,
    kind: f.kind,
    provider: f.provider,
    yearlyCostCents: Number.isFinite(cents) ? cents : -1,
    costNote: f.costNote,
    url: f.url,
    itinFriendly: f.itinFriendly,
    affiliate: f.affiliate,
    affiliateDisclosure: f.affiliate ? f.affiliateDisclosure : null,
    active: f.active,
  });
  return parsed.success ? parsed.data : null;
}

export default function OfertasPage() {
  const { ready, can, data, locale } = useStaff();
  const t = useTx();
  const demo = data.demo;
  const [enabled, setEnabled] = useState(false);
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (demo) {
      const state = readDemoOffers();
      setEnabled(state.enabled);
      setOffers(state.offers);
      const accepting = readDemoAccepting();
      setOfficers(
        buildDemoPartners(new Date())
          .filter((p) => p.kind === "loan_officer" && p.status === "approved")
          .map((p) => ({ id: p.id, name: p.name, company: p.company, accepting: accepting.includes(p.id) })),
      );
      return;
    }
    const res = await fetch("/api/staff/offers", { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return setOffers([]);
    const body = (await res.json()) as { enabled: boolean; offers: Offer[]; loanOfficers: Officer[] };
    setEnabled(body.enabled);
    setOffers(body.offers);
    setOfficers(body.loanOfficers);
  }, [demo]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  if (!ready || !offers) return null;
  if (!can("partners.manage")) return <NoAccess title={t("Ofertas", "Offers")} reason={deniedReason("partners.manage", locale)} />;

  const post = async (body: unknown) => {
    const res = await fetch("/api/staff/offers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    return Boolean(res?.ok);
  };

  const toggleSwitch = async () => {
    const next = !enabled;
    if (demo) writeDemoOffers({ enabled: next, offers });
    else if (!(await post({ action: "switch", enabled: next }))) return setMessage(t("No se pudo guardar.", "Could not save."));
    setMessage(next ? t("Ofertas visibles para los clientes.", "Offers are visible to clients.") : t("Ofertas ocultas para los clientes.", "Offers are hidden from clients."));
    await load();
  };

  const save = async () => {
    if (!form) return;
    const input = toInput(form);
    if (!input) return setMessage(t("Revisa los campos: nombre, proveedor, costo, nota del costo, enlace https y, si es afiliada, el aviso (20 caracteres o más).", "Check the fields: name, provider, cost, cost note, an https link and, for an affiliate offer, the disclosure (20 characters or more)."));
    if (demo) {
      const id = form.id ?? `00000000-0000-4000-b000-${String(Date.now()).slice(-12).padStart(12, "0")}`;
      const offer: Offer = { id, ...input };
      writeDemoOffers({ enabled, offers: [...offers.filter((o) => o.id !== id), offer] });
    } else if (!(await post({ action: "save", id: form.id, offer: input }))) {
      return setMessage(t("No se pudo guardar.", "Could not save."));
    }
    setForm(null);
    setMessage(t("Oferta guardada.", "Offer saved."));
    await load();
  };

  const setAccepting = async (o: Officer) => {
    if (demo) {
      const ids = readDemoAccepting();
      writeDemoAccepting(o.accepting ? ids.filter((x) => x !== o.id) : [...ids, o.id]);
    } else if (!(await post({ action: "accepting", partnerId: o.id, accepting: !o.accepting }))) {
      return setMessage(t("No se pudo guardar.", "Could not save."));
    }
    await load();
  };

  const ranked = rankOffers(offers);
  const inactive = offers.filter((o) => !o.active);
  const clientLocale = locale === "es" ? "es" : "en";

  return (
    <main className="animate-rise space-y-8" data-testid="staff-offers">
      <header>
        <h1 className="text-[28px] font-semibold tracking-tight text-slate-900">{t("Ofertas de socios", "Partner offers")}</h1>
        <p className="mt-1 max-w-3xl text-[15px] leading-relaxed text-slate-600">
          {t(
            "Productos para construir crédito que los clientes pueden ver en «Construye tu crédito». Opcionales, nunca requeridos, y ordenados por lo que le cuestan al cliente y luego por nombre, nunca por comisión. Si Credalti puede recibir un pago, el cliente ve el aviso junto a la oferta.",
            "Credit-building products clients can see in \"Build your credit\". Optional, never required, and ordered by what they cost the client and then by name, never by commission. If Credalti may be paid, the client sees the disclosure next to the offer.",
          )}
        </p>
      </header>

      <section aria-labelledby="switch" className="card flex flex-wrap items-center justify-between gap-4 px-5 py-4" data-testid="offers-switch">
        <div className="min-w-0">
          <h2 id="switch" className="text-[17px] font-semibold text-slate-900">{t("Mostrar ofertas a los clientes", "Show offers to clients")}</h2>
          <p className="text-[14px] text-slate-600">
            {enabled ? t("Encendido: los clientes ven las ofertas activas.", "On: clients see the active offers.") : t("Apagado (así empieza): ningún cliente ve ofertas.", "Off (the default): no client sees any offer.")}
          </p>
          <p className="mt-1 text-[13px] text-slate-500">{t("Antes de encenderlo, pídele al abogado que revise las preguntas de docs/AFTERCARE.md (CROA, UDAAP, avisos de afiliado).", "Before turning it on, ask the attorney to review the questions in docs/AFTERCARE.md (CROA, UDAAP, affiliate disclosures).")}</p>
        </div>
        <button type="button" role="switch" aria-checked={enabled} onClick={toggleSwitch} className={enabled ? SECONDARY_BUTTON : PRIMARY_BUTTON}>
          {enabled ? t("Apagar", "Turn off") : t("Encender", "Turn on")}
        </button>
      </section>

      {message && <p className="rounded-xl bg-blue-50 px-4 py-3 text-[14px] text-blue-900" role="status">{message}</p>}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-labelledby="list">
          <SectionTitle aside={!form && <button type="button" className={ROW_BUTTON} onClick={() => setForm({ ...EMPTY })} data-testid="offer-add">{t("Agregar oferta", "Add offer")}</button>}>
            <span id="list">{t("Ofertas, en el orden que las ven los clientes", "Offers, in the order clients see them")}</span>
          </SectionTitle>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[14px]">
              <thead className="text-[12px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">#</th>
                  <th className="px-4 py-3 font-semibold">{t("Oferta", "Offer")}</th>
                  <th className="px-4 py-3 font-semibold">{t("Tipo", "Type")}</th>
                  <th className="px-4 py-3 font-semibold">{t("Costo para el cliente", "Cost to the client")}</th>
                  <th className="px-4 py-3 font-semibold">ITIN</th>
                  <th className="px-4 py-3 font-semibold">{t("Afiliada", "Affiliate")}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {[...ranked, ...inactive].map((o, i) => (
                  <tr key={o.id} className="border-t hairline align-top">
                    <td className="px-4 py-3 tabular-nums text-slate-500">{o.active ? i + 1 : "—"}</td>
                    <td className="px-4 py-3">
                      <span className="block font-medium text-slate-900">{o.name}</span>
                      <span className="block text-slate-500">{o.provider}</span>
                      {!o.active && <span className="text-[12px] font-semibold text-slate-500">{t("Inactiva", "Inactive")}</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{OFFER_KIND_LABEL[clientLocale][o.kind]}</td>
                    <td className="px-4 py-3 text-slate-700">
                      {yearlyCostLabel(o.yearlyCostCents, clientLocale)}
                      <span className="block text-[12px] text-slate-500">{o.costNote}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{o.itinFriendly ? t("Sí", "Yes") : t("No", "No")}</td>
                    <td className="px-4 py-3 text-slate-700">{o.affiliate ? t("Sí, con aviso", "Yes, disclosed") : t("No", "No")}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        className={ROW_BUTTON}
                        onClick={() =>
                          setForm({
                            id: o.id,
                            name: o.name,
                            kind: o.kind,
                            provider: o.provider,
                            cost: String(o.yearlyCostCents / 100),
                            costNote: o.costNote,
                            url: o.url,
                            itinFriendly: o.itinFriendly,
                            affiliate: o.affiliate,
                            affiliateDisclosure: o.affiliateDisclosure ?? DEFAULT_AFFILIATE_DISCLOSURE,
                            active: o.active,
                          })
                        }
                      >
                        {t("Editar", "Edit")}
                      </button>
                    </td>
                  </tr>
                ))}
                {offers.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-slate-500">{t("Todavía no hay ofertas.", "No offers yet.")}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="px-1 pt-2 text-[13px] text-slate-500">
            {t("No hay campo de comisión: el orden no puede depender de lo que pague un proveedor.", "There is no commission field: the order cannot depend on what a provider pays.")}
          </p>

          <section aria-labelledby="officers" className="mt-8" data-testid="accepting-officers">
            <SectionTitle>
              <span id="officers">{t("Oficiales de préstamos que aceptan clientes nuevos", "Loan officers accepting new clients")}</span>
            </SectionTitle>
            <div className="card divide-y divide-slate-100">
              {officers.map((o) => (
                <div key={o.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <span className="min-w-0">
                    <span className="block font-medium text-slate-900">{o.name}</span>
                    <span className="block text-[13px] text-slate-500">{o.company}</span>
                  </span>
                  <button type="button" role="switch" aria-checked={o.accepting} className={ROW_BUTTON} onClick={() => setAccepting(o)}>
                    {o.accepting ? t("Acepta clientes · quitar", "Accepting · turn off") : t("Marcar que acepta", "Mark as accepting")}
                  </button>
                </div>
              ))}
              {officers.length === 0 && <p className="px-5 py-4 text-[14px] text-slate-500">{t("No hay oficiales de préstamos aprobados.", "No approved loan officers.")}</p>}
            </div>
            <p className="px-1 pt-2 text-[13px] text-slate-500">
              {t(
                "«Conéctame con un oficial de préstamos» va primero al socio que refirió al cliente; si no es oficial de préstamos ni agente de bienes raíces, a esta lista, por nombre. El cliente da su consentimiento y ve el aviso antes.",
                "\"Connect me with a loan officer\" goes first to the client's referring partner; if they are not a loan officer or real estate agent, to this list, by name. The client consents and sees the disclosure first.",
              )}
            </p>
          </section>
        </section>

        <aside className="space-y-4">
          {form ? (
            <section className="card space-y-3 px-5 py-5" aria-label={t("Oferta", "Offer")} data-testid="offer-form">
              <h2 className="text-[17px] font-semibold text-slate-900">{form.id ? t("Editar oferta", "Edit offer") : t("Nueva oferta", "New offer")}</h2>
              {(
                [
                  ["name", t("Nombre", "Name")],
                  ["provider", t("Proveedor", "Provider")],
                  ["cost", t("Costo para el cliente el primer año (USD; un depósito reembolsable no cuenta)", "Cost to the client in the first year (USD; a refundable deposit does not count)")],
                  ["costNote", t("Nota del costo, en palabras simples", "Cost note, in plain words")],
                  ["url", t("Enlace (https)", "Link (https)")],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="block">
                  <span className="block pb-1 text-[13px] font-medium text-slate-700">{label}</span>
                  <input className={field} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} inputMode={key === "cost" ? "decimal" : undefined} />
                </label>
              ))}
              <label className="block">
                <span className="block pb-1 text-[13px] font-medium text-slate-700">{t("Tipo", "Type")}</span>
                <select className={field} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as OfferKind })}>
                  {OFFER_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {OFFER_KIND_LABEL[clientLocale][k]}
                    </option>
                  ))}
                </select>
              </label>
              {(
                [
                  ["itinFriendly", t("Acepta ITIN (confirmado con el proveedor)", "Accepts ITIN (confirmed with the provider)")],
                  ["affiliate", t("Credalti puede recibir un pago si el cliente se inscribe", "Credalti may be paid if the client signs up")],
                  ["active", t("Activa", "Active")],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2.5 text-[14px] text-slate-800">
                  <input type="checkbox" className="h-5 w-5" checked={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} />
                  {label}
                </label>
              ))}
              {form.affiliate && (
                <label className="block">
                  <span className="block pb-1 text-[13px] font-medium text-slate-700">{t("Aviso de afiliado (lo ve el cliente)", "Affiliate disclosure (the client sees it)")}</span>
                  <textarea className={`${field} h-24 py-2`} value={form.affiliateDisclosure} onChange={(e) => setForm({ ...form, affiliateDisclosure: e.target.value })} />
                </label>
              )}
              <div className="flex gap-2 pt-1">
                <button type="button" className={PRIMARY_BUTTON} onClick={save} data-testid="offer-save">
                  {t("Guardar", "Save")}
                </button>
                <button type="button" className={SECONDARY_BUTTON} onClick={() => setForm(null)}>
                  {t("Cancelar", "Cancel")}
                </button>
              </div>
            </section>
          ) : (
            ranked[0] && (
              <section aria-labelledby="preview">
                <SectionTitle>
                  <span id="preview">{t("Así la ve el cliente", "How the client sees it")}</span>
                </SectionTitle>
                <ol>
                  <OfferCard offer={ranked.find((o) => o.affiliate) ?? ranked[0]} locale={clientLocale} />
                </ol>
              </section>
            )
          )}
        </aside>
      </div>

      {demo && <p className="text-xs text-slate-500">{t("Demo: las ofertas son ejemplos inventados. Los cambios se guardan solo en este navegador.", "Demo: the offers are made-up examples. Changes are saved only in this browser.")}</p>}
    </main>
  );
}
