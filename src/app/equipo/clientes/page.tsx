"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { formatPhone, relativeDay } from "@/lib/staff/format";
import {
  clientExceptions,
  clientStage,
  EXCEPTION_KINDS,
  EXCEPTION_LABEL,
  nextStep,
  STAGE_ORDER,
  STAGES,
  type ExceptionKind,
  type Stage,
} from "@/lib/staff/stage";
import { fullName } from "@/lib/staff/types";
import { useStaff } from "@/lib/staff/useStaff";
import Icon from "@/components/Icon";
import { ActorTag, SeverityDot, StageChip } from "@/components/staff/ui";

// Every client, findable in a few keystrokes. Filters live in the address, so
// a stage on the home screen links straight to its clients and a filtered
// list can be bookmarked.

const control =
  "h-11 rounded-2xl bg-white px-3.5 text-[15px] text-slate-900 shadow-[0_0_0_1px_rgba(0,0,0,0.08)] outline-none focus:ring-2 focus:ring-blue-300";

/** Lowercase, no accents: "Solís" is found by "solis". */
const plain = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

function ClientList() {
  const { ready, clients, now } = useStaff();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Typed text is kept here as well as in the address, so typing never waits on navigation.
  const [query, setQuery] = useState(params.get("q") ?? "");
  const stageParam = params.get("etapa") ?? "";
  const stage = (STAGE_ORDER as readonly string[]).includes(stageParam) ? (stageParam as Stage) : "";
  const noticeParam = params.get("aviso") ?? "";
  const notice =
    noticeParam === "alguno" || (EXCEPTION_KINDS as readonly string[]).includes(noticeParam)
      ? (noticeParam as "alguno" | ExceptionKind)
      : "";
  const seller = params.get("vendedor") ?? "";
  const filtered = Boolean(query || stage || notice || seller);

  const setParam = (name: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(name, value);
    else next.delete(name);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const rows = useMemo(
    () =>
      clients
        .map((client) => ({
          client,
          stage: clientStage(client, now),
          exceptions: clientExceptions(client, now),
          step: nextStep(client, now),
        }))
        .sort(
          (a, b) =>
            STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage) ||
            fullName(a.client).localeCompare(fullName(b.client), "es"),
        ),
    [clients, now],
  );
  const sellers = useMemo(() => [...new Set(clients.map((c) => c.salesperson))].sort(), [clients]);

  if (!ready) return null;

  const needle = plain(query.trim());
  const digits = query.replace(/\D/g, "");
  const shown = rows.filter((row) => {
    if (stage && row.stage !== stage) return false;
    if (notice === "alguno" && row.exceptions.length === 0) return false;
    if (notice && notice !== "alguno" && !row.exceptions.some((e) => e.kind === notice)) return false;
    if (seller && row.client.salesperson !== seller) return false;
    if (!needle) return true;
    return plain(fullName(row.client)).includes(needle) || (digits.length >= 3 && row.client.phone.includes(digits));
  });

  return (
    <main className="animate-rise">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h1 className="text-[28px] font-semibold tracking-tight text-slate-900">Clientes</h1>
        <p className="text-[14px] tabular-nums text-slate-500" role="status">
          {filtered ? `${shown.length} de ${rows.length}` : `${rows.length} en total`}
        </p>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_13rem_13rem_13.5rem]">
        <div className="relative">
          <Icon name="search" size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setParam("q", e.target.value);
            }}
            placeholder="Buscar por nombre o teléfono"
            aria-label="Buscar por nombre o teléfono"
            className={`${control} w-full pl-10 placeholder:text-slate-400`}
          />
        </div>
        <select aria-label="Etapa" className={control} value={stage} onChange={(e) => setParam("etapa", e.target.value)}>
          <option value="">Todas las etapas</option>
          {STAGE_ORDER.map((s) => (
            <option key={s} value={s}>{STAGES[s].label}</option>
          ))}
        </select>
        <select aria-label="Avisos" className={control} value={notice} onChange={(e) => setParam("aviso", e.target.value)}>
          <option value="">Con o sin avisos</option>
          <option value="alguno">Necesita una persona</option>
          {EXCEPTION_KINDS.map((k) => (
            <option key={k} value={k}>{EXCEPTION_LABEL[k]}</option>
          ))}
        </select>
        <select aria-label="Vendedor" className={control} value={seller} onChange={(e) => setParam("vendedor", e.target.value)}>
          <option value="">Todos los vendedores</option>
          {sellers.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {filtered && (
        <button
          type="button"
          onClick={() => {
            setQuery("");
            router.replace(pathname, { scroll: false });
          }}
          className="mt-3 px-1 text-[13px] font-medium text-blue-700 underline-offset-2 hover:underline"
        >
          Quitar filtros
        </button>
      )}

      <div className="card mt-4 overflow-hidden">
        <div className="hidden grid-cols-[minmax(0,1.3fr)_12.5rem_minmax(0,1.5fr)_7rem_1.25rem] gap-4 border-b hairline px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 lg:grid">
          <span>Cliente</span>
          <span>Etapa</span>
          <span>Qué sigue</span>
          <span>Actividad</span>
          <span />
        </div>

        {shown.length === 0 ? (
          <p className="px-5 py-8 text-center text-[15px] text-slate-500">Ningún cliente coincide con estos filtros.</p>
        ) : (
          <ul>
            {shown.map(({ client, stage: s, exceptions, step }, index) => (
              <li key={client.id} className={index > 0 ? "border-t hairline" : ""}>
                <Link
                  href={`/equipo/clientes/${client.id}`}
                  className="pressable grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-5 py-3.5 hover:bg-slate-50 lg:grid-cols-[minmax(0,1.3fr)_12.5rem_minmax(0,1.5fr)_7rem_1.25rem]"
                >
                  <span className="flex min-w-0 gap-2.5">
                    {exceptions[0] ? (
                      <SeverityDot severity={exceptions[0].severity} />
                    ) : (
                      <span className="mt-[7px] h-2.5 w-2.5 shrink-0" />
                    )}
                    <span className="min-w-0">
                      <span className="block break-words text-[16px] font-medium leading-snug text-slate-900">{fullName(client)}</span>
                      <span className="block truncate text-[13px] text-slate-500">
                        {formatPhone(client.phone)} · {client.salesperson}
                      </span>
                    </span>
                  </span>
                  <span className="justify-self-end lg:justify-self-start">
                    <StageChip stage={s} />
                  </span>
                  <span className="col-span-2 min-w-0 pl-5 lg:col-span-1 lg:pl-0">
                    <ActorTag actor={step.actor} />
                    <span className="block text-[14px] leading-snug text-slate-700">{step.text}</span>
                    {exceptions.length > 0 && (
                      <span className="block text-[13px] leading-snug text-slate-500">
                        Aviso: {exceptions.map((e) => EXCEPTION_LABEL[e.kind].toLowerCase()).join(", ")}
                      </span>
                    )}
                  </span>
                  <span className="col-span-2 pl-5 text-[13px] text-slate-500 lg:col-span-1 lg:pl-0">
                    <span className="lg:hidden">Última actividad: </span>
                    {relativeDay(client.lastActivityAt, now)}
                  </span>
                  <Icon name="chevron" size={18} className="hidden text-slate-300 lg:block" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

export default function Clientes() {
  return (
    <Suspense fallback={null}>
      <ClientList />
    </Suspense>
  );
}
