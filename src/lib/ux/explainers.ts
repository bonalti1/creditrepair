import type { ItemCategory } from "../domain/types";

// Plain-Spanish explainers — the anti-jargon layer. Every item the user sees
// comes with "¿qué es esto?" and "¿qué debo verificar?" in words a first-time
// user understands. Copy discipline: educate on WHAT to check, never tell the
// user an item IS wrong or promise that disputing removes it (Armor #3).

export interface CategoryExplainer {
  what: string;
  whyItMatters: string;
  checkHints: string[];
}

export const CATEGORY_EXPLAINERS: Record<ItemCategory, CategoryExplainer> = {
  tradeline: {
    what: "Una cuenta de crédito a tu nombre: tarjeta, préstamo, auto o una cuenta en cobranza.",
    whyItMatters:
      "Las cuentas con pagos tardíos, cargos dados de baja (charge-off) o cobranzas son lo que más pesa en tu reporte.",
    checkHints: [
      "¿Reconoces al acreedor y la cuenta?",
      "¿El saldo y el límite son correctos?",
      "¿Las fechas (apertura, último pago, primer atraso) coinciden con tu realidad?",
      "¿Aparece la misma deuda dos veces (cobrador y acreedor original con saldo ambos)?",
      "¿Ya pasaron más de 7 años desde el primer atraso? Si sí, podría estar desactualizada.",
    ],
  },
  inquiry: {
    what: "Un registro de que alguien consultó tu crédito. Las consultas 'duras' (hard) ocurren cuando pides crédito.",
    whyItMatters:
      "Las consultas duras que no autorizaste pueden indicar un error o incluso robo de identidad.",
    checkHints: [
      "¿Recuerdas haber pedido crédito con esta empresa en esa fecha?",
      "¿Autorizaste que revisaran tu crédito?",
      "¿La consulta tiene más de 2 años? Debería haber caído ya.",
    ],
  },
  public_record: {
    what: "Un registro legal público: bancarrota, gravamen o sentencia.",
    whyItMatters:
      "Son de los elementos más serios de un reporte y a veces siguen apareciendo después de resolverse o vencer.",
    checkHints: [
      "¿El registro es realmente tuyo (no de alguien con nombre parecido)?",
      "¿El estado es correcto (resuelto, descargado, pagado)?",
      "¿Ya venció el plazo legal para reportarlo?",
    ],
  },
  personal_info: {
    what: "Datos personales que los burós tienen de ti: nombres, direcciones, empleos.",
    whyItMatters:
      "Datos viejos o incorrectos pueden mezclar tu expediente con el de otra persona y 'anclar' cuentas que no son tuyas. Por eso el Ataque 1 empieza aquí.",
    checkHints: [
      "¿Esta dirección o variante de nombre sigue siendo tuya y actual?",
      "¿Este empleo es correcto?",
      "¿Reconoces todas las variantes de tu nombre?",
    ],
  },
};

/** Jargon dictionary: terms that appear in report data, in plain Spanish. */
export const TERM_GLOSSARY: Record<string, string> = {
  "charge-off":
    "«Charge-off»: el acreedor dio la deuda por perdida en sus libros. La deuda sigue existiendo, pero se reporta como incobrable.",
  collection:
    "«Cobranza»: la deuda fue vendida o asignada a un cobrador. A veces la misma deuda aparece dos veces (cobrador + acreedor original).",
  hard: "«Consulta dura»: alguien revisó tu crédito porque pediste crédito. Requiere tu autorización.",
  late: "«Pago tardío»: un pago registrado con 30/60/90+ días de retraso.",
  repossession: "«Reposesión»: el prestamista recuperó el bien (por ejemplo, un auto) por falta de pago.",
};

export const STAGE_EXPLAINERS: Record<string, { name: string; plain: string }> = {
  personal_info_cleanup: {
    name: "Limpieza de datos personales",
    plain:
      "Esta carta pide a los burós quitar direcciones, nombres o empleos viejos o incorrectos de tu expediente. Es el primer paso porque un expediente limpio evita mezclas con datos de otras personas.",
  },
  dispute: {
    name: "Disputa FCRA §611",
    plain:
      "Esta carta ejerce tu derecho legal (ley FCRA, sección 611) a que el buró investigue los elementos que tú crees inexactos. Tienen ~30 días para verificar cada uno o eliminarlo.",
  },
  mov: {
    name: "Método de verificación",
    plain:
      "El buró respondió que «verificó» tus elementos. Esta carta le pide que explique CÓMO los verificó y con quién habló. Si no puede demostrarlo, debe eliminarlos.",
  },
  furnisher_direct: {
    name: "Directo al informante",
    plain:
      "Esta carta va directo a la empresa que reporta el dato (no al buró). La ley (FCRA §623) la obliga a investigar tu disputa y corregir o dejar de reportar lo que no pueda verificar.",
  },
  secondary_bureau_request: {
    name: "Expediente de buró secundario",
    plain:
      "Además de los 3 burós grandes, hay agencias de datos menos conocidas (LexisNexis, Innovis…). Esta carta pide tu expediente completo para revisar qué dicen de ti.",
  },
};
