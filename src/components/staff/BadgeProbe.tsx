"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { workQueue } from "@/lib/autopilot/queue";
import { useAutopilot } from "@/lib/autopilot/useAutopilot";
import { fetchAdsSummary } from "@/lib/ads/data";
import { overviewCards } from "@/lib/control/overview";
import { getLeadData } from "@/lib/leads/data";
import type { Lead } from "@/lib/leads/types";
import { useMail } from "@/lib/mail/useMail";
import { publishBadges } from "@/lib/staff/navBadges";
import { useStaff } from "@/lib/staff/useStaff";

// The red circles' numbers that the shell can work out on any page
// (src/lib/staff/navBadges.ts): the Overview's own «Needs you» counts, from the
// same pure function (control/overview.ts overviewCards), on the same clients,
// work queue and lead list, read through the member's own connection. Renders
// nothing. The Overview page adds what only it reads (Content, the books,
// Partners) when it opens.
//
//   My day       ← the Clients card's «Needs you» (the work queue on Home)
//   Leads        ← the Leads & sales card's (waiting + handed over)
//   Fulfillment  ← the Support card's (client questions waiting)
//   Money        ← the Money card's (payment notices), only with billing.view
//   Marketing    ← plus the Ads Manager's ads to turn off that still spend, only with ads.view (its own source)

const REFRESH_MS = 60_000;

export default function BadgeProbe() {
  const { ready: clientsReady, clients, now, reload, viewer, can, locale } = useStaff();
  const { furnishers, gaps, ready: mailReady } = useMail();
  const { env, ready: autopilotReady } = useAutopilot();
  const pathname = usePathname();
  const worksLeads = can("leads.work");
  const leadData = useMemo(() => getLeadData(viewer, locale), [viewer, locale]);
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const lastReload = useRef(Date.now());

  // The lead list: once, then every minute while the page is visible.
  useEffect(() => {
    if (!viewer || !worksLeads) {
      setLeads(null);
      return;
    }
    let live = true;
    const run = () => {
      if (document.hidden) return;
      leadData
        .list()
        .then((list) => live && setLeads(list.leads))
        .catch(() => live && setLeads(null));
    };
    run();
    const timer = window.setInterval(run, REFRESH_MS);
    document.addEventListener("visibilitychange", run);
    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", run);
    };
  }, [viewer, worksLeads, leadData]);

  // The ads to turn off that still spend (src/lib/ads): once, then every minute while the page is visible.
  const seesAds = can("ads.view");
  useEffect(() => {
    if (!viewer || !seesAds) {
      publishBadges("ads", {});
      return;
    }
    let live = true;
    const run = () => {
      if (document.hidden) return;
      void fetchAdsSummary(viewer).then((summary) => {
        if (live) publishBadges("ads", { content: summary?.turnOff ?? null });
      });
    };
    run();
    const timer = window.setInterval(run, REFRESH_MS);
    document.addEventListener("visibilitychange", run);
    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", run);
    };
  }, [viewer, seesAds]);

  // A new page re-reads the clients at most once a minute, so a notice handled on one screen leaves the circle.
  useEffect(() => {
    if (Date.now() - lastReload.current < REFRESH_MS) return;
    lastReload.current = Date.now();
    void reload();
  }, [pathname, reload]);

  const ready = clientsReady && mailReady && autopilotReady && !!viewer;
  useEffect(() => {
    if (!ready) return;
    const queue = workQueue(clients, now, { furnishers, furnisherGaps: gaps, autopilot: env, locale }, viewer?.role ?? null);
    const cards = overviewCards({ clients, queue, leads, leadsError: null, extras: null, money: null, books: null, handle: viewer?.handle ?? null, can, now, locale });
    const needs = (key: string) => cards.find((c) => c.key === key)?.needsYou.count ?? null;
    publishBadges("probe", {
      day: needs("clients"),
      leads: worksLeads && leads ? needs("leads") : null,
      clients: needs("support"),
      money: needs("money"),
    });
  }, [ready, clients, now, furnishers, gaps, env, locale, viewer, leads, worksLeads, can]);

  return null;
}
