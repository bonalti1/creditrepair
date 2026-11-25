// Expense categories for a small Texas credit repair company. The same keys
// are seeded in the database (migration 0036, expense_categories) and a test
// keeps the two lists equal. Each has the account name the QuickBooks / Xero
// file uses, so the accountant can map it once.
//
// Grouped so the dashboard can say "advertising" without adding three lines,
// and so unit economics reads ad spend from the advertising group only.

export type CategoryGroup = "advertising" | "operations" | "people" | "compliance" | "financial" | "other";

export const CATEGORY_KEYS = [
  "advertising_meta",
  "advertising_google",
  "advertising_tiktok",
  "advertising_other",
  "software",
  "postage",
  "credit_monitoring",
  "payroll",
  "contractors",
  "legal_compliance",
  "insurance",
  "office_rent",
  "bank_fees",
  "processing_fees",
  "phone_whatsapp",
  "taxes_licenses",
  "other",
] as const;

export type CategoryKey = (typeof CATEGORY_KEYS)[number];

export interface ExpenseCategory {
  key: CategoryKey;
  group: CategoryGroup;
  en: string;
  es: string;
  hintEn: string;
  hintEs: string;
  /** The account name in the QuickBooks / Xero file. */
  account: string;
  /** Words in a bank line's description that suggest this category (lowercase, plain). */
  vendors: readonly string[];
}

export const CATEGORIES: readonly ExpenseCategory[] = [
  { key: "advertising_meta", group: "advertising", en: "Advertising: Meta (Facebook, Instagram)", es: "Publicidad: Meta (Facebook, Instagram)", hintEn: "Ads billed by Meta.", hintEs: "Anuncios que cobra Meta.", account: "Advertising & Marketing:Meta Ads", vendors: ["facebk", "facebook", "meta platforms", "meta ads", "instagram", "fb.me/ads"] },
  { key: "advertising_google", group: "advertising", en: "Advertising: Google", es: "Publicidad: Google", hintEn: "Google Ads, YouTube ads.", hintEs: "Google Ads, anuncios en YouTube.", account: "Advertising & Marketing:Google Ads", vendors: ["google ads", "google*ads", "googleads", "adwords"] },
  { key: "advertising_tiktok", group: "advertising", en: "Advertising: TikTok", es: "Publicidad: TikTok", hintEn: "TikTok for Business.", hintEs: "TikTok for Business.", account: "Advertising & Marketing:TikTok Ads", vendors: ["tiktok", "bytedance"] },
  { key: "advertising_other", group: "advertising", en: "Advertising: other", es: "Publicidad: otra", hintEn: "Flyers, radio, sponsorships, other ad networks.", hintEs: "Volantes, radio, patrocinios, otras redes.", account: "Advertising & Marketing:Other", vendors: ["vistaprint", "canva", "nextdoor", "yelp ads"] },
  { key: "software", group: "operations", en: "Software and subscriptions", es: "Software y suscripciones", hintEn: "Hosting, database, email, CRM, AI, design tools.", hintEs: "Hosting, base de datos, correo, CRM, IA, diseño.", account: "Software & Subscriptions", vendors: ["supabase", "vercel", "netlify", "render.com", "github", "google workspace", "gsuite", "microsoft", "anthropic", "openai", "highlevel", "gohighlevel", "zoom", "dropbox", "adobe", "notion", "n8n"] },
  { key: "postage", group: "operations", en: "Postage: Lob and certified mail", es: "Correo: Lob y correo certificado", hintEn: "Lob letters, USPS certified mail, stamps.", hintEs: "Cartas de Lob, correo certificado de USPS, estampillas.", account: "Postage & Delivery", vendors: ["lob.com", "lob ", "usps", "stamps.com", "pitney", "certified mail"] },
  { key: "credit_monitoring", group: "operations", en: "Credit monitoring", es: "Monitoreo de crédito", hintEn: "Monitoring the company pays for (test accounts, a client it covers).", hintEs: "Monitoreo que paga la empresa (cuentas de prueba, un cliente que cubre).", account: "Credit Monitoring Services", vendors: ["identityiq", "idiq", "smartcredit", "myscoreiq"] },
  { key: "payroll", group: "people", en: "Payroll", es: "Nómina", hintEn: "Wages, payroll taxes, the payroll service.", hintEs: "Sueldos, impuestos de nómina, el servicio de nómina.", account: "Payroll Expenses", vendors: ["gusto", "adp", "paychex", "payroll"] },
  { key: "contractors", group: "people", en: "Contractors", es: "Contratistas", hintEn: "People paid per job (a 1099 may be due).", hintEs: "Personas que cobran por trabajo (puede tocar un 1099).", account: "Contract Labor", vendors: ["upwork", "fiverr", "contractor"] },
  { key: "legal_compliance", group: "compliance", en: "Legal and compliance", es: "Legal y cumplimiento", hintEn: "Attorney, Texas CSO registration, the $10,000 surety bond, compliance reviews.", hintEs: "Abogado, registro CSO de Texas, la fianza de $10,000, revisiones de cumplimiento.", account: "Legal & Professional Fees", vendors: ["attorney", "law office", "law firm", "surety", "bond premium", "secretary of state", "sos.state.tx", "texas sos"] },
  { key: "insurance", group: "compliance", en: "Insurance", es: "Seguros", hintEn: "General liability, E&O, cyber.", hintEs: "Responsabilidad general, errores y omisiones, ciber.", account: "Insurance", vendors: ["insurance", "hiscox", "next insurance", "the hartford", "state farm"] },
  { key: "office_rent", group: "operations", en: "Office and rent", es: "Oficina y renta", hintEn: "Rent, coworking, office supplies, printer and paper.", hintEs: "Renta, coworking, papelería, impresora y papel.", account: "Rent & Office", vendors: ["regus", "wework", "rent", "office depot", "staples"] },
  { key: "bank_fees", group: "financial", en: "Bank fees", es: "Comisiones bancarias", hintEn: "Account fees, wires, overdrafts.", hintEs: "Mantenimiento de cuenta, transferencias, sobregiros.", account: "Bank Service Charges", vendors: ["service charge", "monthly maintenance", "maintenance fee", "wire fee", "overdraft"] },
  { key: "processing_fees", group: "financial", en: "Card and ACH processing fees", es: "Comisiones del procesador (tarjeta y ACH)", hintEn: "What NMI or Authorize.Net kept, from their statement. Replaces the estimate for that month.", hintEs: "Lo que cobró NMI o Authorize.Net, según su estado de cuenta. Reemplaza el estimado de ese mes.", account: "Merchant Account Fees", vendors: ["nmi", "authorize.net", "authnet", "merchant fee", "discount fee", "chargeback fee"] },
  { key: "phone_whatsapp", group: "operations", en: "Phone and WhatsApp", es: "Teléfono y WhatsApp", hintEn: "Phone plan, WhatsApp Business messages.", hintEs: "Plan de teléfono, mensajes de WhatsApp Business.", account: "Telephone & Messaging", vendors: ["at&t", "verizon", "t-mobile", "tmobile", "whatsapp", "twilio", "360dialog"] },
  { key: "taxes_licenses", group: "compliance", en: "Taxes and licenses", es: "Impuestos y licencias", hintEn: "Franchise tax, local licenses, filing fees.", hintEs: "Impuesto de franquicia, licencias locales, cuotas de registro.", account: "Taxes & Licenses", vendors: ["comptroller", "franchise tax", "irs", "eftps", "license"] },
  { key: "other", group: "other", en: "Other", es: "Otros", hintEn: "Anything else. Say what it was in the description.", hintEs: "Lo demás. Di qué fue en la descripción.", account: "Other Expenses", vendors: [] },
];

const BY_KEY = new Map(CATEGORIES.map((c) => [c.key, c]));

export function isCategoryKey(value: unknown): value is CategoryKey {
  return typeof value === "string" && BY_KEY.has(value as CategoryKey);
}

export function category(key: CategoryKey): ExpenseCategory {
  return BY_KEY.get(key)!;
}

export function categoryLabel(key: string, locale: "en" | "es"): string {
  const c = BY_KEY.get(key as CategoryKey);
  return c ? c[locale] : key;
}

export const GROUP_LABEL: Record<CategoryGroup, { en: string; es: string }> = {
  advertising: { en: "Advertising", es: "Publicidad" },
  operations: { en: "Operations", es: "Operación" },
  people: { en: "People", es: "Personal" },
  compliance: { en: "Legal, insurance and taxes", es: "Legal, seguros e impuestos" },
  financial: { en: "Bank and processing", es: "Banco y procesador" },
  other: { en: "Other", es: "Otros" },
};

export const isAdvertising = (key: string): boolean => BY_KEY.get(key as CategoryKey)?.group === "advertising";

/** Lowercase, accents off, punctuation kept where vendors use it (at&t, lob.com). */
export function plainText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** The category a bank line's words suggest, or null. The person can always change it. */
export function suggestCategory(description: string): CategoryKey | null {
  const text = ` ${plainText(description)} `;
  for (const c of CATEGORIES) if (c.vendors.some((v) => text.includes(v))) return c.key;
  return null;
}

// ── Payment methods: how the company paid ───────────────────────────────

export const PAYMENT_METHODS = ["business_card", "bank_transfer", "ach", "check", "cash", "personal_card", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, { en: string; es: string }> = {
  business_card: { en: "Business card", es: "Tarjeta de la empresa" },
  bank_transfer: { en: "Bank transfer", es: "Transferencia" },
  ach: { en: "ACH debit", es: "Débito ACH" },
  check: { en: "Check", es: "Cheque" },
  cash: { en: "Cash", es: "Efectivo" },
  personal_card: { en: "Personal card (reimburse)", es: "Tarjeta personal (reembolsar)" },
  other: { en: "Other", es: "Otro" },
};

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === "string" && (PAYMENT_METHODS as readonly string[]).includes(value);
}
