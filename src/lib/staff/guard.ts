import type { BillingActionResult, RoundRef, StaffData } from "./data";
import { can, canSeeClient, deniedReason, exceptionVisibleTo, visibleClients, type Capability, type Viewer } from "./permissions";
import type { ExceptionKind } from "./stage";

// The console's data, as one member of the team may use it.
//
// Every page reads and acts through this wrapper, never through the raw data:
// a client the viewer may not see is not listed and cannot be opened, and an
// action the viewer's role may not take is refused here, whatever the screen
// showed. It is the same check the server routes make (requireCapability in
// access.ts), applied again where the demo keeps its records.

/** Thrown by an action the viewer's role may not take. The message is the reason, in Spanish. */
export class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionError";
  }
}

export interface GuardHooks {
  /** Called with the rounds that were sent and who sent them (the demo records the sender). */
  onRoundsSent?: (rounds: RoundRef[], by: string) => void | Promise<void>;
}

/** "question:c04-q1" → "question_waiting"; "payment_past_due:ch1" → "payment_past_due". */
export function exceptionKindOfKey(key: string): ExceptionKind {
  const prefix = key.split(":")[0]!;
  return (prefix === "question" ? "question_waiting" : prefix) as ExceptionKind;
}

export function guardStaffData(data: StaffData, viewer: Viewer | null, hooks: GuardHooks = {}): StaffData {
  const allowed = (capability: Capability) => can(viewer?.role, capability);
  const need = (capability: Capability) => {
    if (!allowed(capability)) throw new PermissionError(deniedReason(capability));
  };
  const visible = async (clientId: string) => {
    const client = await data.getClient(clientId);
    return client && canSeeClient(viewer, client) ? client : null;
  };
  const mustSee = async (clientId: string) => {
    const client = await visible(clientId);
    if (!client) throw new PermissionError("Este cliente no está entre los tuyos.");
    return client;
  };
  /** The same checks, answered the way the billing actions answer. */
  const money = async (capability: Capability, clientId: string): Promise<BillingActionResult | null> => {
    if (!allowed(capability)) return { ok: false, message: deniedReason(capability) };
    if (!(await visible(clientId))) return { ok: false, message: "Este cliente no está entre los tuyos." };
    return null;
  };

  return {
    demo: data.demo,
    async listClients() {
      return visibleClients(viewer, await data.listClients());
    },
    async getClient(id) {
      return visible(id);
    },
    async markRoundsSent(rounds) {
      need("rounds.send");
      const mine: RoundRef[] = [];
      for (const ref of rounds) if (await visible(ref.clientId)) mine.push(ref);
      if (mine.length === 0) return;
      await data.markRoundsSent(mine);
      // Only what actually went out (the data layer skips a round that may not be sent).
      const after = await Promise.all(mine.map((ref) => data.getClient(ref.clientId)));
      const sent = mine.filter((ref, i) => after[i]?.rounds.some((r) => r.number === ref.roundNumber && r.mailedAt));
      if (sent.length > 0 && viewer) await hooks.onRoundsSent?.(sent, viewer.handle);
    },
    async addNote(clientId, text, author) {
      need("clients.followup");
      await mustSee(clientId);
      return data.addNote(clientId, text, author);
    },
    async resolveException(clientId, exceptionKey) {
      need("clients.followup");
      await mustSee(clientId);
      if (!exceptionVisibleTo(viewer?.role, exceptionKindOfKey(exceptionKey))) {
        throw new PermissionError("Este aviso lo atiende el equipo que trabaja el caso.");
      }
      return data.resolveException(clientId, exceptionKey);
    },
    async saveReport(clientId, input) {
      need("reports.import");
      await mustSee(clientId);
      return data.saveReport(clientId, input);
    },
    async saveReportSample(clientId, input) {
      need("reports.import");
      await mustSee(clientId);
      return data.saveReportSample(clientId, input);
    },
    async sendReply(clientId, text, author) {
      need("clients.reply");
      await mustSee(clientId);
      return data.sendReply(clientId, text, author);
    },
    async refundCharge(clientId, chargeId, reason, by) {
      return (await money("billing.refund", clientId)) ?? data.refundCharge(clientId, chargeId, reason, by);
    },
    async pauseBilling(clientId, reason, by) {
      return (await money("billing.pause", clientId)) ?? data.pauseBilling(clientId, reason, by);
    },
    async resumeBilling(clientId) {
      return (await money("billing.pause", clientId)) ?? data.resumeBilling(clientId);
    },
  };
}
