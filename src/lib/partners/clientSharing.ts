"use client";

import { useCallback, useEffect, useState } from "react";
import { isDemoMode } from "../supabase/config";
import { buildDemoPartners } from "./demo";
import { SHARING_CONSENT_VERSION, type ShareHow, type ShareLevel } from "./sharing";
import { demoClientViews, demoPartnerByCode, demoReferringPartner, readDemoClientSharing, writeDemoClientSharing } from "./sharingDemo";
import { DEMO_ME, demoClientShareRequests, dismissDemoShareRequest } from "./portalDemo";
import type { ClientShareRequest } from "./portal";
import type { PartnerKind } from "./rules";

// The client's side of partner sharing, for "Quién puede ver tu progreso" and
// the onboarding's choice. Same switch as the other stores: the demo keeps the
// choice in this browser (sharingDemo.ts); with a database it is GET/POST
// /api/sharing, where the server checks and records it.

export interface ClientPartner {
  id: string;
  name: string;
  company: string | null;
  kind: PartnerKind;
  logo: string | null;
  status: string;
  referred: boolean;
  level: ShareLevel;
  how: ShareHow | null;
}

export interface ClientSharingState {
  partners: ClientPartner[];
  views: Array<{ partnerId: string; at: string }>;
  history: Array<{ partnerId: string; level: ShareLevel; previousLevel: ShareLevel; at: string }>;
  counts: { disputing: number; noLongerReported: number } | null;
  me: { name: string; goal: string | null };
  /** A partner's requests to follow the client's progress (migration 0033). */
  requests?: ClientShareRequest[];
}

export type SharingSave = { ok: true; unchanged?: boolean } | { ok: false; message: string; code?: string };

function demoState(): ClientSharingState {
  const now = new Date();
  const sharing = readDemoClientSharing();
  const referring = demoReferringPartner(now);
  const all = buildDemoPartners(now);
  const ids = [referring.id, ...sharing.added.filter((id) => id !== referring.id)];
  const partners = ids.flatMap((id) => {
    const p = all.find((x) => x.id === id);
    if (!p) return [];
    return [{ id: p.id, name: p.name, company: p.company, kind: p.kind, logo: null, status: p.status, referred: id === referring.id, level: sharing.levels[id] ?? "none", how: (id === referring.id ? "referred" : "added_by_code") as ShareHow }];
  });
  let name = "";
  let goal: string | null = null;
  try {
    name = window.localStorage.getItem("bonalti.inviteName") ?? "";
    goal = window.localStorage.getItem("bonalti.goal");
  } catch {
    // ignore
  }
  return {
    partners,
    views: demoClientViews(sharing, now),
    history: sharing.history,
    counts: null,
    me: { name: name || "Rosa Martínez", goal: goal ?? "mortgage" },
    requests: demoClientShareRequests(now),
  };
}

export function useClientSharing() {
  const demo = isDemoMode();
  const [state, setState] = useState<ClientSharingState | null>(null);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(async () => {
    if (demo) {
      setState(demoState());
      return;
    }
    try {
      const res = await fetch("/api/sharing", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setState((await res.json()) as ClientSharingState);
    } catch {
      setFailed(true);
    }
  }, [demo]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(
    async (target: { partnerId?: string; code?: string }, level: ShareLevel, textHash: string, locale: "es" | "en"): Promise<SharingSave> => {
      if (demo) {
        const id = target.partnerId ?? (target.code ? demoPartnerByCode(target.code)?.id : undefined);
        if (!id) return { ok: false, message: "not_found" };
        const before = readDemoClientSharing().levels[id] ?? "none";
        writeDemoClientSharing(id, level, Boolean(target.code));
        await reload();
        return { ok: true, unchanged: before === level };
      }
      try {
        const res = await fetch("/api/sharing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "set", ...target, level, locale, version: SHARING_CONSENT_VERSION, textHash }),
        });
        const body = (await res.json().catch(() => ({}))) as { unchanged?: boolean; code?: string; error?: string };
        await reload();
        if (res.ok) return { ok: true, unchanged: body.unchanged };
        return { ok: false, message: body.error ?? "error", code: body.code };
      } catch {
        return { ok: false, message: "error" };
      }
    },
    [demo, reload],
  );

  const lookup = useCallback(
    async (code: string): Promise<Omit<ClientPartner, "status" | "referred" | "level" | "how"> | null> => {
      const clean = code.trim().toLowerCase();
      if (demo) {
        const p = demoPartnerByCode(clean);
        return p ? { id: p.id, name: p.name, company: p.company, kind: p.kind, logo: null } : null;
      }
      const res = await fetch("/api/sharing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "lookup", code: clean }) }).catch(() => null);
      if (!res?.ok) return null;
      const body = (await res.json()) as { partner: { id: string; name: string; company: string | null; kind: PartnerKind; logo: string | null } };
      return body.partner;
    },
    [demo],
  );

  /** "Not now" on a partner's request: the card goes away; nothing is shared. */
  const dismissRequest = useCallback(
    async (id: string): Promise<boolean> => {
      if (demo) {
        dismissDemoShareRequest(DEMO_ME, new Date().toISOString());
        await reload();
        return true;
      }
      const res = await fetch("/api/sharing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "dismiss_request", id }) }).catch(() => null);
      await reload();
      return Boolean(res?.ok);
    },
    [demo, reload],
  );

  return { demo, state, failed, reload, save, lookup, dismissRequest };
}
