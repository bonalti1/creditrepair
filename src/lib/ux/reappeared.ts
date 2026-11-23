// "Reappeared": an item a past round's report showed gone that a newer report
// lists again. What the client reads, as a fact, with the law it rests on and
// no promise: FCRA § 611(a)(5)(B) (15 U.S.C. § 1681i(a)(5)(B)) says a bureau
// may put back information it deleted only if the furnisher certifies it is
// complete and accurate, and must tell the consumer in writing within 5
// business days. The item goes back to the client's review: the client
// decides whether it is inaccurate, and only then can it go in the next round.

export const REAPPEARED_BADGE = { en: "Reappeared", es: "Volvió a aparecer" } as const;

/** The plain explanation, in the client's language. `goneOn` is the date of the report that no longer listed it. */
export function reappearedExplanation(locale: "es" | "en", goneOn: string): string {
  const date = new Date(goneOn).toLocaleDateString(locale === "es" ? "es-MX" : "en-US", { day: "numeric", month: "long", year: "numeric" });
  return locale === "es"
    ? `Este punto ya no aparecía en tu reporte del ${date} y ahora aparece otra vez. Cuando un buró vuelve a poner un dato que había quitado, la ley (FCRA § 611(a)(5)(B)) le pide que el acreedor certifique que es completo y exacto, y que te avise por escrito en 5 días hábiles. Revísalo: tú decides si es inexacto. Si dices que lo es, puede ir en tu próxima ronda.`
    : `This item no longer appeared on your report from ${date}, and now it shows again. When a bureau puts back information it had removed, the law (FCRA § 611(a)(5)(B)) requires the furnisher to certify it is complete and accurate, and the bureau to tell you in writing within 5 business days. Take a look: you decide whether it's inaccurate. If you say it is, it can go in your next round.`;
}
