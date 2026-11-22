"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { resolveTerms } from "../agreement/terms";
import { feeToCents } from "../billing/rules";
import { isSupabaseConfigured } from "../supabase/config";
import { useAgreement } from "../ux/agreementStore";
import { readDemoBilling } from "../ux/billingLocal";
import { useFlags } from "../ux/flagsStore";
import { useLetterMail } from "../ux/letterMail";
import { useClientReport } from "../ux/reportStore";
import { demoReportImportedAt, demoReviewFinishedAt, deviceCaseFacts, readCaseDemoExtras, type CaseDemoExtras } from "./demo";
import { caseTimeline, EMPTY_CASE_FACTS, type CaseFacts, type CaseTimeline, type L } from "./timeline";

// The client's case for "Mi caso", Home's status sentence and the "¿Qué está
// pasando?" button. Same switch as the other stores (supabase/config.ts):
//
//  - Demo: built from what this device saved (the agreement, the answers, the
//    round, its mail status, the payments), plus the example case's extra
//    facts when one was loaded (case/demo.ts). `example` says so, and the
//    screens label it.
//  - Database: GET /api/case, the client's own rows (case/server.ts).

export interface CaseView {
  ready: boolean;
  live: boolean;
  /** Demo: the example case is loaded on this device. */
  example: boolean;
  facts: CaseFacts;
  timeline: CaseTimeline;
}

let caseAnswer: Promise<CaseFacts | null> | null = null;

function fetchCase(): Promise<CaseFacts | null> {
  caseAnswer ??= fetch("/api/case", { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<{ authenticated: boolean; facts?: CaseFacts }>) : null))
    .then((body) => (body?.authenticated && body.facts ? body.facts : null))
    .catch(() => {
      caseAnswer = null;
      return null;
    });
  return caseAnswer;
}

export function useCase(locale: L): CaseView {
  const live = isSupabaseConfigured();
  const { flags, roundFlags, roundApproved, roundMailedAt, hydrated } = useFlags();
  const { agreement, hydrated: agreementReady } = useAgreement();
  const report = useClientReport();
  const letterMail = useLetterMail();
  const [serverFacts, setServerFacts] = useState<CaseFacts | null>(null);
  const [serverReady, setServerReady] = useState(false);
  const [extras, setExtras] = useState<CaseDemoExtras | null>(null);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    if (!live) {
      setExtras(readCaseDemoExtras());
      return;
    }
    let cancelled = false;
    fetchCase().then((facts) => {
      if (cancelled) return;
      setServerFacts(facts);
      setServerReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [live]);

  const deviceReady = hydrated && agreementReady && report.ready && now !== null;
  const facts = useMemo<CaseFacts>(() => {
    if (live) return serverFacts ?? EMPTY_CASE_FACTS;
    if (!deviceReady) return EMPTY_CASE_FACTS;
    const billing = readDemoBilling();
    const done = report.items.length > 0 && report.items.every((i) => flags[i.fingerprint]);
    return deviceCaseFacts({
      agreement,
      items: report.items,
      flags,
      roundFlags,
      roundApproved,
      roundMailedAt,
      letterMail,
      charges: billing.scenario === "live" ? billing.charges : [],
      showAmounts: feeToCents(resolveTerms().monthlyFee) !== null,
      extras,
      reportImportedAt: demoReportImportedAt(),
      reviewFinishedAt: demoReviewFinishedAt(done),
    });
  }, [live, serverFacts, deviceReady, agreement, report.items, flags, roundFlags, roundApproved, roundMailedAt, letterMail, extras]);

  const timeline = useMemo(() => caseTimeline(facts, locale, now ?? new Date()), [facts, locale, now]);
  return { ready: live ? serverReady : deviceReady, live, example: !live && extras !== null, facts, timeline };
}

/** Forget the case read from the server, so the next screen reads it again. */
export function forgetCase(): void {
  caseAnswer = null;
}

/** A stable callback for screens that change the demo case and want a fresh read. */
export function useReloadPage(): () => void {
  return useCallback(() => window.location.reload(), []);
}
