import { ALL_BUREAU_KEYS, PRIMARY_BUREAUS, SECONDARY_BUREAUS } from "./bureaus";
import type {
  AttackPlan,
  Bureau,
  EscalationStage,
  ItemCategory,
  ItemFlag,
  PlannedLetter,
  ReportItem,
} from "./types";

// Attack engine (spec §4.2) — round-based, ~40-day cycles.
//   Attack 1: personal-info cleanup letters to all 3 bureaus.
//   Attack 2+: separate letters per category (accounts / inquiries / public records)
//              per bureau, plus secondary-bureau scope.
//   Escalation per item: FCRA §611 dispute → method of verification → furnisher-direct.
//
// Legally load-bearing invariant: only items the USER flagged AND attested as
// "inaccurate, unverifiable, or outdated" may appear in any letter. The plan
// builder enforces it here and the approval route enforces it again server-side.

export const ROUND_CYCLE_DAYS = 40;

const NEXT_STAGE: Record<EscalationStage, EscalationStage> = {
  dispute: "mov",
  mov: "furnisher_direct",
  furnisher_direct: "furnisher_direct", // terminal — repeat furnisher-direct
};

export interface ItemHistory {
  /** Highest escalation stage already mailed for this fingerprint, if any. */
  [fingerprint: string]: EscalationStage | undefined;
}

export function nextStageFor(fingerprint: string, history: ItemHistory): EscalationStage {
  const prior = history[fingerprint];
  return prior ? NEXT_STAGE[prior] : "dispute";
}

const CATEGORY_TEMPLATES: Record<ItemCategory, Record<EscalationStage, string>> = {
  tradeline: {
    dispute: "dispute_611_accounts",
    mov: "mov_request",
    furnisher_direct: "furnisher_direct",
  },
  inquiry: {
    dispute: "dispute_611_inquiries",
    mov: "mov_request",
    furnisher_direct: "furnisher_direct",
  },
  public_record: {
    dispute: "dispute_611_public_records",
    mov: "mov_request",
    furnisher_direct: "furnisher_direct",
  },
  personal_info: {
    dispute: "personal_info_cleanup",
    mov: "personal_info_cleanup",
    furnisher_direct: "personal_info_cleanup",
  },
};

export function buildAttackPlan(params: {
  roundNumber: number;
  items: ReportItem[];
  flags: ItemFlag[];
  history: ItemHistory;
}): AttackPlan {
  const { roundNumber, items, flags, history } = params;
  const letters: PlannedLetter[] = [];

  const attestedFps = new Set(flags.filter((f) => f.attested && f.attestedAt).map((f) => f.fingerprint));
  const itemByFp = new Map(items.map((i) => [i.fingerprint, i]));

  if (roundNumber <= 1) {
    // Attack 1: personal-info cleanup to all three bureaus. Personal-info variants
    // still require attestation before inclusion.
    for (const bureau of ALL_BUREAU_KEYS) {
      const fps = items
        .filter(
          (i) => i.bureau === bureau && i.category === "personal_info" && attestedFps.has(i.fingerprint),
        )
        .map((i) => i.fingerprint);
      if (fps.length === 0) continue;
      letters.push({
        target: PRIMARY_BUREAUS[bureau],
        category: "personal_info",
        stage: "personal_info_cleanup",
        templateKey: "personal_info_cleanup",
        itemFingerprints: fps,
      });
    }
    return { roundNumber, letters };
  }

  // Attack 2+: group attested items by (bureau, category, stage).
  const groups = new Map<string, { bureau: Bureau; category: ItemCategory; stage: EscalationStage; fps: string[] }>();
  const furnisherLetters = new Map<string, PlannedLetter>();

  for (const fp of attestedFps) {
    const item = itemByFp.get(fp);
    if (!item || item.category === "personal_info") continue;
    const stage = nextStageFor(fp, history);

    if (stage === "furnisher_direct") {
      // Furnisher-direct letters go to the data furnisher, not the bureau.
      // Items with no known furnisher (e.g. inquiries) stay at MOV with the bureau.
      if (item.furnisher) {
        const key = item.furnisher.name;
        const existing = furnisherLetters.get(key);
        if (existing) existing.itemFingerprints.push(fp);
        else
          furnisherLetters.set(key, {
            target: {
              type: "furnisher",
              key,
              name: item.furnisher.name,
              addressLines: item.furnisher.addressLines,
            },
            category: item.category,
            stage: "furnisher_direct",
            templateKey: "furnisher_direct",
            itemFingerprints: [fp],
          });
        continue;
      }
    }

    const effectiveStage = stage === "furnisher_direct" ? "mov" : stage;
    const groupKey = `${item.bureau}|${item.category}|${effectiveStage}`;
    const group = groups.get(groupKey);
    if (group) group.fps.push(fp);
    else groups.set(groupKey, { bureau: item.bureau, category: item.category, stage: effectiveStage, fps: [fp] });
  }

  for (const g of groups.values()) {
    letters.push({
      target: PRIMARY_BUREAUS[g.bureau],
      category: g.category,
      stage: g.stage,
      templateKey: CATEGORY_TEMPLATES[g.category][g.stage],
      itemFingerprints: g.fps,
    });
  }
  letters.push(...furnisherLetters.values());

  // Secondary-bureau scope (round 2 only): file-disclosure + dispute/suppression
  // letters to the secondary bureaus, mirroring the Dispute Beast differentiation.
  if (roundNumber === 2 && attestedFps.size > 0) {
    for (const target of SECONDARY_BUREAUS) {
      letters.push({
        target,
        category: "tradeline",
        stage: "dispute",
        templateKey: "secondary_bureau_request",
        itemFingerprints: [],
      });
    }
  }

  return { roundNumber, letters };
}
