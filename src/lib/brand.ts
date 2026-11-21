// The one place the brand's names live. Pages, metadata, messages and the
// assistant's instructions read from here, so a rename is a one-file change.
//
// The company is Credalti; the name changed with the move to full service
// (the old name is in docs/BRAND.md). The assistant, the capybara mascot, is
// still Capi.
//
// Not renamed on purpose: localStorage keys ("bonalti.*"), routes, database
// objects and the package name. They are internal and customers never see them.

export const BRAND = {
  /** Company and product name, as customers read it. */
  name: "Credalti",
  /** The wordmark's two halves: the first is navy (white on dark), the second gold. */
  wordmark: ["Cred", "alti"],
  /** The AI assistant and mascot. */
  assistant: "Capi",
  /** Browser-tab title of the customer app. */
  title: "Credalti — Tu asistente de crédito con IA",
  /** Browser-tab title of the ad landing page. */
  startTitle: "Credalti — Empieza en 5 minutos",
  /** Browser-tab title of the staff console. */
  teamTitle: "Credalti — Equipo",
  /** Internal and spec name; never shown to customers. */
  internalName: "Bonalti Credit",
} as const;

export const COMPANY_NAME = BRAND.name;
export const ASSISTANT_NAME = BRAND.assistant;
