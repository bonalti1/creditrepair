"use client";

import { useState } from "react";
import { staffAuthor, useStaff } from "@/lib/staff/useStaff";
import { useTx } from "@/lib/staff/i18n/StaffLocale";
import { staffMessage } from "@/lib/staff/i18n/messages";
import { ROW_BUTTON } from "@/components/staff/ui";

const CONTROL = "h-11 md:h-10 min-w-0 rounded-xl bg-white px-3 text-[14px] text-slate-900 shadow-[0_0_0_1px_rgba(0,0,0,0.1)] outline-none focus:ring-2 focus:ring-blue-300";

/** Record a chargeback the processor's portal shows (when it sends no webhook). Only for money that was taken. */
export default function ChargebackForm({ row, onDone }: { row: { clientId: string; chargeId: string }; onDone: () => Promise<void> }) {
  const t = useTx();
  const { data, locale } = useStaff();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ reasonCode: "", receivedOn: new Date().toISOString().slice(0, 10) });
  const [error, setError] = useState<string | null>(null);
  if (!open) {
    return (
      <button type="button" className="text-[12.5px] font-medium text-blue-700 underline-offset-2 hover:underline" onClick={() => setOpen(true)}>
        {t("Registrar contracargo", "Record chargeback")}
      </button>
    );
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input className={`${CONTROL} w-28`} placeholder={t("Código", "Reason code")} value={f.reasonCode} onChange={(e) => setF({ ...f, reasonCode: e.target.value })} />
      <input className={`${CONTROL} w-40`} type="date" value={f.receivedOn} onChange={(e) => setF({ ...f, receivedOn: e.target.value })} />
      <button
        type="button"
        className={ROW_BUTTON}
        onClick={async () => {
          const r = await data.recordChargeback(row.clientId, row.chargeId, { reasonCode: f.reasonCode.trim() || null, receivedOn: f.receivedOn }, staffAuthor());
          if (!r.ok) return setError(staffMessage(r.message, locale));
          setOpen(false);
          await onDone();
        }}
      >
        {t("Guardar", "Save")}
      </button>
      {error && <span className="text-[12.5px] text-red-700">{error}</span>}
    </div>
  );
}

