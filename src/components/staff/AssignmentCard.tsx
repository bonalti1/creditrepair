"use client";

import { useState } from "react";
import { shortDay } from "@/lib/staff/format";
import { deniedReason, type Viewer } from "@/lib/staff/permissions";
import { assignableMembers, memberName, type TeamMember } from "@/lib/staff/team";
import type { TeamData } from "@/lib/staff/teamData";
import type { StaffClient } from "@/lib/staff/types";
import { DeniedNote, SectionTitle } from "@/components/staff/ui";

// Who works this client, and the way to give the case to someone else
// (administrators). Every change is kept in the client's activity.

export default function AssignmentCard({
  client,
  viewer,
  members,
  team,
  canAssign,
  onChanged,
}: {
  client: StaffClient;
  viewer: Viewer | null;
  members: TeamMember[];
  team: TeamData;
  canAssign: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const [to, setTo] = useState(client.assignedTo ?? "none");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const last = client.assignments?.at(-1);
  const options = assignableMembers(members);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    const result = await team.assignClients([client.id], to === "none" ? null : to, viewer);
    setBusy(false);
    setMessage(result.ok ? "Guardado." : result.message);
    if (result.ok) await onChanged();
  };

  return (
    <section aria-labelledby="asignado" data-testid="assignment">
      <SectionTitle>
        <span id="asignado">Quién lo trabaja</span>
      </SectionTitle>
      <div className="card px-5 py-4">
        <p className="text-[15px] font-medium text-slate-900">
          {client.assignedTo ? memberName(members, client.assignedTo) : <span className="text-slate-500">Sin asignar</span>}
        </p>
        {last && (
          <p className="text-[13px] text-slate-500">
            {last.auto ? "Por turno" : `Lo asignó ${memberName(members, last.by)}`} el {shortDay(last.at)}
          </p>
        )}
        {canAssign ? (
          <div className="mt-3 flex gap-2 border-t hairline pt-3">
            <label htmlFor="asignar-a" className="sr-only">
              Asignar a
            </label>
            <select
              id="asignar-a"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setMessage(null);
              }}
              className="h-11 min-w-0 flex-1 rounded-2xl bg-white px-3 text-[14px] text-slate-900 shadow-[0_0_0_1px_rgba(0,0,0,0.08)] outline-none focus:ring-2 focus:ring-blue-300"
            >
              {options.map((m) => (
                <option key={m.handle} value={m.handle}>{m.name}</option>
              ))}
              <option value="none">Nadie (sin asignar)</option>
            </select>
            <button
              type="button"
              onClick={save}
              disabled={busy || to === (client.assignedTo ?? "none")}
              className="pressable h-11 shrink-0 rounded-full bg-blue-50 px-4 text-[14px] font-semibold text-blue-700 hover:bg-blue-100 disabled:bg-slate-100 disabled:text-slate-400"
            >
              Asignar
            </button>
          </div>
        ) : (
          <div className="mt-3 border-t hairline pt-3">
            <DeniedNote>{deniedReason("clients.assign")}</DeniedNote>
          </div>
        )}
        {message && (
          <p className="mt-2 text-[13px] text-slate-600" role="status">
            {message}
          </p>
        )}
      </div>
    </section>
  );
}
