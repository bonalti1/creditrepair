"use client";

import { useCallback, useEffect, useState } from "react";
import { isDemoMode } from "../supabase/config";
import { buildDemoPartners } from "../partners/demo";
import { consentHash, SHARING_CONSENT_VERSION, type ShareLevel } from "../partners/sharing";
import { demoReferringPartner, readDemoClientSharing, writeDemoClientSharing } from "../partners/sharingDemo";
import { readStoredAgreement, writeStoredAgreement } from "../ux/agreementLocal";
import { forgetCase } from "../case/useCase";
import { introHash, introRoute, INTRO_CONSENT_VERSION, readDemoAccepting, type IntroPartner } from "./connect";
import type { Graduation } from "./graduation";
import { parseIdType, type IdType } from "./itin";
import { rankOffers, readDemoOffers } from "./offers";
import type { AftercareMarkKey } from "./plan";
import type { AftercareState } from "./server";

// The client's after-care, for /construir, the home-ready path, the ITIN
// guide and graduation in Mi caso. Same switch as the other stores
// (supabase/config.ts): the demo keeps everything in this browser; with a
// database it is GET/POST /api/aftercare (and /api/sharing for the
// home-ready choice, which is part of the partner sharing consent).

const DEMO_KEY = "credalti.demoAftercare.v1";
export const ID_TYPE_KEY = "bonalti.idType";

interface DemoAftercare {
  marks: AftercareState["marks"];
  graduation: Graduation | null;
  introRequest: AftercareState["introRequest"];
  homeReady: Record<string, boolean>;
}

function readDemo(): DemoAftercare {
  try {
    const raw = window.localStorage.getItem(DEMO_KEY);
    if (raw) return { marks: {}, graduation: null, introRequest: null, homeReady: {}, ...(JSON.parse(raw) as Partial<DemoAftercare>) };
  } catch {
    // ignore
  }
  return { marks: {}, graduation: null, introRequest: null, homeReady: {} };
}

function writeDemo(next: DemoAftercare) {
  try {
    window.localStorage.setItem(DEMO_KEY, JSON.stringify(next));
  } catch {
    // Kept for this visit only.
  }
}

export function readIdType(): IdType | null {
  try {
    return parseIdType(window.localStorage.getItem(ID_TYPE_KEY));
  } catch {
    return null;
  }
}

function demoState(): AftercareState {
  const now = new Date();
  const demo = readDemo();
  const offers = readDemoOffers();
  const referring = demoReferringPartner(now);
  const all = buildDemoPartners(now);
  const acceptingIds = readDemoAccepting();
  const accepting: IntroPartner[] = all.filter((p) => p.status === "approved" && p.kind === "loan_officer" && acceptingIds.includes(p.id)).map((p) => ({ id: p.id, name: p.name, company: p.company, kind: p.kind }));
  const sharing = readDemoClientSharing();
  let goal: string | null = null;
  try {
    goal = window.localStorage.getItem("bonalti.goal");
  } catch {
    // ignore
  }
  const connected = [referring, ...all.filter((p) => sharing.added.includes(p.id))].filter((p) => p.status === "approved" && (p.kind === "loan_officer" || p.kind === "realtor"));
  return {
    idType: readIdType(),
    goal: goal ?? "mortgage",
    marks: demo.marks,
    graduation: demo.graduation,
    offersEnabled: offers.enabled,
    offers: offers.enabled ? rankOffers(offers.offers) : [],
    intro: introRoute({ id: referring.id, name: referring.name, company: referring.company, kind: referring.kind, status: referring.status }, accepting),
    introRequest: demo.introRequest,
    homeShares: connected.map((p) => {
      const level = sharing.levels[p.id] ?? "none";
      return { partnerId: p.id, name: p.name, company: p.company, kind: p.kind, level, homeReady: level !== "none" && demo.homeReady[p.id] === true };
    }),
  };
}

export type SaveResult = { ok: true } | { ok: false; message: string; code?: string };

async function post(path: string, body: unknown): Promise<SaveResult> {
  try {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const answer = (await res.json().catch(() => ({}))) as { error?: unknown; code?: string };
    if (res.ok) return { ok: true };
    return { ok: false, message: typeof answer.error === "string" ? answer.error : "error", code: answer.code };
  } catch {
    return { ok: false, message: "error" };
  }
}

export function useAftercare() {
  const demo = isDemoMode();
  const [state, setState] = useState<AftercareState | null>(null);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(async () => {
    if (demo) {
      setState(demoState());
      return;
    }
    try {
      const res = await fetch("/api/aftercare", { cache: "no-store" });
      const body = (await res.json()) as AftercareState & { authenticated?: boolean };
      if (!res.ok || body.authenticated === false) throw new Error(String(res.status));
      // A choice made in onboarding before sign-in is saved once, here.
      const pending = readIdType();
      if (!body.idType && pending) {
        await post("/api/aftercare", { action: "id_type", idType: pending });
        body.idType = pending;
      }
      setState(body);
    } catch {
      setFailed(true);
    }
  }, [demo]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const setIdType = useCallback(
    async (idType: IdType) => {
      try {
        window.localStorage.setItem(ID_TYPE_KEY, idType);
      } catch {
        // ignore
      }
      const r = demo ? ({ ok: true } as const) : await post("/api/aftercare", { action: "id_type", idType });
      await reload();
      return r;
    },
    [demo, reload],
  );

  const mark = useCallback(
    async (key: AftercareMarkKey, done: boolean): Promise<SaveResult> => {
      if (demo) {
        const d = readDemo();
        writeDemo({ ...d, marks: { ...d.marks, [key]: { done, at: new Date().toISOString() } } });
        await reload();
        return { ok: true };
      }
      const r = await post("/api/aftercare", { action: "mark", key, done });
      await reload();
      return r;
    },
    [demo, reload],
  );

  const graduate = useCallback(
    async (keepTips: boolean, locale: "es" | "en", markedStillReported: number, reason: Graduation["reason"]): Promise<SaveResult> => {
      if (demo) {
        const at = new Date().toISOString();
        const d = readDemo();
        writeDemo({ ...d, graduation: { completedAt: at, reason, keepTips } });
        // As the database does: finishing ends the service on the agreement.
        const agreement = readStoredAgreement();
        if (agreement?.signedAt && !agreement.serviceEndRequestedAt) writeStoredAgreement({ ...agreement, serviceEndRequestedAt: at });
        await reload();
        return { ok: true };
      }
      const r = await post("/api/aftercare", { action: "graduate", keepTips, locale, markedStillReported });
      forgetCase();
      await reload();
      return r;
    },
    [demo, reload],
  );

  const setTips = useCallback(
    async (keepTips: boolean): Promise<SaveResult> => {
      if (demo) {
        const d = readDemo();
        if (d.graduation) writeDemo({ ...d, graduation: { ...d.graduation, keepTips } });
        await reload();
        return { ok: true };
      }
      const r = await post("/api/aftercare", { action: "tips", keepTips });
      await reload();
      return r;
    },
    [demo, reload],
  );

  const requestIntro = useCallback(
    async (partner: IntroPartner, locale: "es" | "en", how: "referred" | "accepting"): Promise<SaveResult> => {
      if (demo) {
        const d = readDemo();
        writeDemo({ ...d, introRequest: { id: "demo-intro", partnerId: partner.id, partnerName: partner.company ? `${partner.name}, ${partner.company}` : partner.name, how, at: new Date().toISOString() } });
        await reload();
        return { ok: true };
      }
      const r = await post("/api/aftercare", { action: "intro", partnerId: partner.id, locale, version: INTRO_CONSENT_VERSION, textHash: introHash(partner, locale) });
      await reload();
      return r;
    },
    [demo, reload],
  );

  const withdrawIntro = useCallback(async (): Promise<SaveResult> => {
    if (demo) {
      writeDemo({ ...readDemo(), introRequest: null });
      await reload();
      return { ok: true };
    }
    const r = await post("/api/aftercare", { action: "withdraw_intro" });
    await reload();
    return r;
  }, [demo, reload]);

  /** Turns home-ready sharing on or off for one partner. Turning it on with nothing shared starts "Progress only". */
  const shareHome = useCallback(
    async (partner: { partnerId: string; name: string; company: string | null; level: string }, on: boolean, locale: "es" | "en"): Promise<SaveResult> => {
      const current = (["progress", "summary"].includes(partner.level) ? partner.level : "none") as ShareLevel;
      const level: ShareLevel = on && current === "none" ? "progress" : current;
      if (level === "none") return { ok: true };
      if (demo) {
        if (current === "none") writeDemoClientSharing(partner.partnerId, level);
        const d = readDemo();
        writeDemo({ ...d, homeReady: { ...d.homeReady, [partner.partnerId]: on } });
        await reload();
        return { ok: true };
      }
      const r = await post("/api/sharing", {
        action: "set",
        partnerId: partner.partnerId,
        level,
        locale,
        version: SHARING_CONSENT_VERSION,
        homeReady: on,
        textHash: consentHash(level, partner, locale, SHARING_CONSENT_VERSION, { homeReady: on }),
      });
      await reload();
      return r;
    },
    [demo, reload],
  );

  return { demo, state, failed, reload, setIdType, mark, graduate, setTips, requestIntro, withdrawIntro, shareHome };
}
