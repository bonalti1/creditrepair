"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cancellationDeadline } from "../agreement/businessDays";
import { AGREEMENT_VERSION, disclosureHash, documentHash, type AgreementLocale } from "../agreement/documents";
import { canCancelWithoutPenalty } from "../agreement/gate";
import { agreementReadiness, type AgreementMode } from "../agreement/readiness";
import { EMPTY_AGREEMENT, normalizeAgreement, type AgreementState } from "../agreement/record";
import { resolveTerms } from "../agreement/terms";
import { readStoredAgreement, writeStoredAgreement } from "./agreementLocal";

// The client's agreement, shared by the /acuerdo screens, Home and "Más".
// Signed in: the server's record (service_agreements via /api/agreement,
// RLS-scoped) is the source of truth, every change goes through the server,
// and the server decides the times and the deadline. Signed out / demo: this
// device's storage only, for demonstration.
// Same shape as the review store in flagsStore.ts.

export type AgreementActionResult =
  | { ok: true }
  | {
      ok: false;
      /** A code the screen can turn into a sentence: the server's, or "network". */
      code: string;
    };

interface ServerStatus {
  authenticated: boolean;
  agreement: unknown;
  profileName?: string | null;
  readiness?: { mode: AgreementMode; canSign: boolean; version: string };
}

async function post(path: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, data };
}

export function useAgreement() {
  const [agreement, setAgreement] = useState<AgreementState | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  /** The name on the account, when signed in and the profile has one. */
  const [profileName, setProfileName] = useState<string | null>(null);
  /** Whether a signature can be taken: the server's answer when signed in, this build's otherwise. */
  const [mode, setMode] = useState<AgreementMode>(() => agreementReadiness().mode);
  const synced = useRef(false);

  const store = useCallback((next: AgreementState | null) => {
    setAgreement(next);
    writeStoredAgreement(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const local = readStoredAgreement();
    fetch("/api/agreement")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: ServerStatus | null) => {
        if (cancelled) return;
        if (data?.authenticated) {
          synced.current = true;
          setSignedIn(true);
          setProfileName(data.profileName ?? null);
          if (data.readiness) setMode(data.readiness.mode);
          store(normalizeAgreement(data.agreement));
        } else {
          setAgreement(local);
        }
      })
      .catch(() => {
        if (!cancelled) setAgreement(local);
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [store]);

  /** Take the server's answer: the record it returns, or the reason it refused. */
  const fromServer = useCallback(
    (response: { status: number; data: Record<string, unknown> }): AgreementActionResult => {
      const record = normalizeAgreement(response.data.agreement);
      if (record) store(record);
      if (response.status >= 200 && response.status < 300) return { ok: true };
      const code = typeof response.data.code === "string" ? response.data.code : `http_${response.status}`;
      if (code === "agreement_not_ready") setMode("blocked");
      return { ok: false, code };
    },
    [store],
  );

  /** Step 1: "I received it and read it", with consent to electronic records. */
  const acknowledge = useCallback(
    async (locale: AgreementLocale): Promise<AgreementActionResult> => {
      const terms = resolveTerms();
      if (synced.current) {
        try {
          return fromServer(
            await post("/api/agreement/acknowledge", {
              version: AGREEMENT_VERSION,
              locale,
              disclosureHash: disclosureHash(AGREEMENT_VERSION, locale, terms),
              esignConsent: true,
            }),
          );
        } catch {
          return { ok: false, code: "network" };
        }
      }
      store({ ...EMPTY_AGREEMENT, disclosureAcknowledgedAt: new Date().toISOString(), version: AGREEMENT_VERSION, locale });
      return { ok: true };
    },
    [fromServer, store],
  );

  /** Step 2: the typed signature. */
  const sign = useCallback(
    async (fullName: string, locale: AgreementLocale): Promise<AgreementActionResult> => {
      const terms = resolveTerms();
      const hash = documentHash(AGREEMENT_VERSION, locale, terms);
      if (synced.current) {
        try {
          return fromServer(
            await post("/api/agreement/sign", {
              fullName,
              version: AGREEMENT_VERSION,
              locale,
              documentHash: hash,
              consents: { contract: true, authorization: true, esign: true },
            }),
          );
        } catch {
          return { ok: false, code: "network" };
        }
      }
      // Demo: the same record the server would write, kept on this device only.
      const current = readStoredAgreement();
      if (!current?.disclosureAcknowledgedAt || current.cancelledAt) return { ok: false, code: "disclosure_not_acknowledged" };
      const now = new Date();
      store({
        ...current,
        signedAt: now.toISOString(),
        cancellationDeadline: cancellationDeadline(now).toISOString(),
        version: AGREEMENT_VERSION,
        locale,
        signerName: fullName.replace(/\s+/g, " ").trim(),
        documentHash: hash,
        terms,
      });
      return { ok: true };
    },
    [fromServer, store],
  );

  /**
   * Cancel. Inside the window it is a cancellation, at once and without
   * conditions; after it, a request to end the service that the team handles.
   */
  const cancel = useCallback(
    async (reason?: string): Promise<AgreementActionResult> => {
      if (synced.current) {
        try {
          return fromServer(await post("/api/agreement/cancel", { reason: reason?.trim() || undefined }));
        } catch {
          return { ok: false, code: "network" };
        }
      }
      const current = readStoredAgreement();
      if (!current?.signedAt) return { ok: false, code: "not_signed" };
      if (current.cancelledAt) return { ok: true };
      const now = new Date();
      const note = reason?.trim() || null;
      store(
        canCancelWithoutPenalty(current, now)
          ? { ...current, cancelledAt: now.toISOString(), cancelledWithinWindow: true, cancellationReason: note }
          : { ...current, serviceEndRequestedAt: current.serviceEndRequestedAt ?? now.toISOString(), serviceEndReason: current.serviceEndReason ?? note },
      );
      return { ok: true };
    },
    [fromServer, store],
  );

  /** Demo only: forget the record on this device, to show the flow again. */
  const resetDemo = useCallback(() => {
    if (!synced.current) store(null);
  }, [store]);

  return { agreement, hydrated, signedIn, profileName, mode, acknowledge, sign, cancel, resetDemo };
}
