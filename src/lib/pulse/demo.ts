import type { StaffClient } from "../staff/types";
import type { PulseRow } from "./pulse";

// The demo's answers to "¿Cómo vamos?", invented, so the business dashboard
// and the client page have something to show. Each one is put on an invented
// client who has reached that moment (signed; first round mailed; first
// answer in). The comments are about how the service feels, as real ones are.

const DAY = 24 * 60 * 60 * 1000;

const SEEDS: Array<{ id: string; moment: PulseRow["moment"]; rating: PulseRow["rating"]; comment: string | null; daysAgo: number }> = [
  { id: "c07", moment: "agreement_signed", rating: 3, comment: null, daysAgo: 6 },
  { id: "c08", moment: "agreement_signed", rating: 2, comment: "La app me pidió el comprobante de domicilio dos veces.", daysAgo: 8 },
  { id: "c10", moment: "first_round_mailed", rating: 3, comment: "Me explicaron todo muy claro y en español.", daysAgo: 11 },
  { id: "c11", moment: "first_round_mailed", rating: 1, comment: "Una de mis cartas regresó y me enteré cuando pregunté.", daysAgo: 4 },
  { id: "c14", moment: "first_answer", rating: 3, comment: "Gracias por avisarme cuando llegó mi reporte nuevo.", daysAgo: 12 },
  { id: "c05", moment: "agreement_signed", rating: 3, comment: null, daysAgo: 7 },
  { id: "c06", moment: "agreement_signed", rating: 2, comment: null, daysAgo: 9 },
];

export function withDemoPulses(clients: StaffClient[], now: Date): StaffClient[] {
  return clients.map((client) => {
    const mine = SEEDS.filter((s) => s.id === client.id && client.agreementSignedAt && !client.agreementCancelledAt);
    if (mine.length === 0) return client;
    const pulses: PulseRow[] = mine.map((s) => ({
      userId: client.id,
      moment: s.moment,
      rating: s.rating,
      comment: s.comment,
      createdAt: new Date(now.getTime() - s.daysAgo * DAY).toISOString(),
    }));
    return { ...client, pulses };
  });
}
