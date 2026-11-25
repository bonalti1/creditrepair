"use client";

import { useState } from "react";
import Link from "next/link";
import { ACTION_LABEL, BLOCK_TEXT, collectionItems, reminderLinks, STANDING_LABEL, type CollectionItem } from "@/lib/accounting/collections";
import type { useAccounting } from "@/lib/accounting/data";
import { shownName } from "@/lib/accounting/facts";
import { formatCents } from "@/lib/accounting/money";
import { receivables } from "@/lib/accounting/summary";
import type { CollectionActionKind } from "@/lib/accounting/types";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { relativeDay } from "@/lib/staff/format";
import { Chip, ClientLanguageTag, QUIET_BUTTON, ROW_BUTTON } from "@/components/staff/ui";
import { CONTROL, Money, Note, Tile, TileGrid, useBi } from "./bits";

type Acc = ReturnType<typeof useAccounting>;

const TONE = { processing: "bg-blue-50 text-blue-700", retrying: "bg-blue-50 text-blue-700", needs_person: "bg-amber-100 text-blue-900", written_off: "bg-slate-100 text-slate-600" } as const;

export default function Collections({ acc, reveal }: { acc: Acc; reveal: boolean }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const now = new Date();
  const items = collectionItems(acc.facts, acc.staff.clients, acc.book.collectionActions, now);
  const ar = receivables(acc.input, now);

  return (
    <div className="space-y-5" data-testid="collections">
      <Note>
        {t(
          "Solo cobros por trabajo ya hecho (después del periodo de cancelación); el sistema ya reintentó y avisó al cliente con el enlace «Actualizar mi tarjeta». Recordatorios solo por WhatsApp o correo, que envías tú; nunca SMS. Sin recargos ni amenazas. Cualquier siguiente paso lo decide una persona.",
          "Only charges for work already done (after the cancellation window); the system already retried and sent the client the “Update my card” link. Reminders only by WhatsApp or email, sent by you; never SMS. No late fees, no threats. A person decides any next step.",
        )}
      </Note>
      <TileGrid>
        <Tile label={t("Por cobrar", "Receivable")} note={t(`${ar.open.length} cobro(s)`, `${ar.open.length} charge(s)`)}>
          <Money cents={ar.totalCents} />
        </Tile>
        <Tile label={t("0–30 días", "0–30 days")}>{formatCents(ar.buckets["0-30"])}</Tile>
        <Tile label={t("31–60 días", "31–60 days")}>{formatCents(ar.buckets["31-60"])}</Tile>
        <Tile label={t("Más de 60 días", "Over 60 days")}>{formatCents(ar.buckets["61-90"] + ar.buckets["90+"])}</Tile>
      </TileGrid>
      {items.length === 0 ? (
        <Note tone="ok">{t("Ningún pago pendiente. Nada que hacer aquí.", "No payments outstanding. Nothing to do here.")}</Note>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <CollectionCard key={item.fact.id} acc={acc} item={item} reveal={reveal} locale={locale} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CollectionCard({ acc, item, reveal, locale }: { acc: Acc; item: CollectionItem; reveal: boolean; locale: "en" | "es" }) {
  const t = useTx();
  const bi = useBi();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const client = item.client;
  const links = client ? reminderLinks(client, item.fact) : null;
  const record = async (kind: CollectionActionKind) => {
    const result = await acc.act({ action: "collection", chargeId: item.fact.id, kind, note });
    if (!result.ok) return setError(bi(result.message));
    setError(null);
    setNote("");
  };
  const blocked = (blocks: typeof item.whatsappBlocks) => blocks.map((b) => BLOCK_TEXT[b][locale]).join(" ");

  return (
    <li className="card px-5 py-4" data-testid="collection-item">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15.5px] font-semibold text-slate-900">
            <Link href={`/equipo/clientes/${item.fact.clientId}`} className="underline-offset-2 hover:underline">
              {shownName(item.fact.clientName, reveal)}
            </Link>{" "}
            · {formatCents(item.fact.amountCents - (item.fact.charge.creditCents ?? 0))}
          </p>
          <p className="mt-0.5 text-[13px] text-slate-500">
            <span className="font-mono">{item.fact.invoice}</span> · {t(`ronda ${item.fact.roundNumber}`, `round ${item.fact.roundNumber}`)} · {t(`${item.daysOverdue} días`, `${item.daysOverdue} days`)} ·{" "}
            {t(`${item.fact.charge.attempts} intento(s)`, `${item.fact.charge.attempts} attempt(s)`)}
            {item.fact.charge.failureCode ? ` · ${item.fact.charge.failureCode}` : ""}
            {item.fact.charge.returnCode ? ` · ACH ${item.fact.charge.returnCode}` : ""}
          </p>
          {item.fact.charge.nextAttemptAt && <p className="text-[13px] text-slate-500">{t("Próximo reintento automático: ", "Next automatic retry: ")}{relativeDay(item.fact.charge.nextAttemptAt, new Date(), locale)}</p>}
        </div>
        <Chip tone={TONE[item.standing]}>{STANDING_LABEL[item.standing][locale]}</Chip>
      </div>

      {item.standing !== "written_off" && client && links && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ClientLanguageTag client={client} className="mr-1" />
          {item.whatsappBlocks.length === 0 ? (
            <a href={links.whatsapp} target="_blank" rel="noreferrer" className={ROW_BUTTON} onClick={() => void record("reminder_whatsapp")} data-testid="remind-whatsapp">
              {t("Recordar por WhatsApp", "Remind on WhatsApp")}
            </a>
          ) : (
            <span className="text-[12.5px] text-slate-500" data-testid="whatsapp-blocked">
              WhatsApp: {blocked(item.whatsappBlocks)}
            </span>
          )}
          {item.emailBlocks.length === 0 && links.email ? (
            <a href={links.email} className={ROW_BUTTON} onClick={() => void record("reminder_email")}>
              {t("Recordar por correo", "Remind by email")}
            </a>
          ) : (
            item.emailBlocks.length > 0 && <span className="text-[12.5px] text-slate-500">{t("Correo: ", "Email: ")}{blocked(item.emailBlocks)}</span>
          )}
        </div>
      )}

      {item.standing !== "written_off" && (
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
          <input className={CONTROL} placeholder={t("Nota: qué pasó o qué se decidió y por qué", "Note: what happened or what was decided and why")} value={note} onChange={(e) => setNote(e.target.value)} aria-label={t("Nota", "Note")} />
          <div className="flex flex-wrap gap-1">
            {(["called", "decided_wait", "decided_pause", "decided_write_off"] as const).map((k) => (
              <button key={k} type="button" className={QUIET_BUTTON} onClick={() => void record(k)} data-testid={`collection-${k}`}>
                {k === "called" ? t("Llamé", "Called") : k === "decided_wait" ? t("Esperar", "Wait") : k === "decided_pause" ? t("Pausar cobros", "Pause billing") : t("Dar de baja", "Write off")}
              </button>
            ))}
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-[13px] text-red-700">{error}</p>}

      {item.actions.length > 0 && (
        <ol className="mt-3 space-y-1 border-t hairline pt-2 text-[12.5px] text-slate-600">
          {item.actions.map((a) => (
            <li key={a.id}>
              {relativeDay(a.at, new Date(), locale)} · {ACTION_LABEL[a.kind][locale]} · {a.by}
              {a.note ? `: ${a.note}` : ""}
            </li>
          ))}
        </ol>
      )}
      {item.actions.some((a) => a.kind === "decided_pause") && (
        <p className="mt-2 text-[12.5px] text-slate-500">
          {t("Para pausar de verdad, hazlo en la tarjeta de cobros del cliente.", "To actually pause, do it on the client's billing card.")}{" "}
          <Link href={`/equipo/clientes/${item.fact.clientId}`} className="font-medium text-blue-700 underline">
            {t("Abrir cliente", "Open client")}
          </Link>
        </p>
      )}
    </li>
  );
}
