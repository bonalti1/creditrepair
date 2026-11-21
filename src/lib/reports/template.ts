import { DEMO_RAW_REPORT } from "../demo";
import type { RawReport } from "../domain/parser";

// A filled example of the app's own report format, for the "Descargar
// plantilla" link on the import screen. It is the demo report (src/lib/demo.ts)
// dated today, so a copy imported as it is reads as a current report. Nobody in
// it exists.

export const TEMPLATE_FILE_NAME = "plantilla-reporte-credalti.json";

export function templateReport(now: Date): RawReport {
  return { ...structuredClone(DEMO_RAW_REPORT), source: "plantilla", pulledAt: now.toISOString() };
}

/** The template as the text of a .json file. */
export function templateJson(now: Date): string {
  return `${JSON.stringify(templateReport(now), null, 2)}\n`;
}
