// Writes the FICTIONAL monitoring-report fixtures the intake tests use:
//   src/lib/intake/__fixtures__/demo-monitoring-report.html
//   src/lib/intake/__fixtures__/demo-monitoring-report.pdf   (needs Playwright)
//
//   npm run intake:fixtures
//
// Playwright is not a dependency of the app. It is loaded from wherever Node
// can find it (a global install); without it only the HTML is written.
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { DEMO_RAW_REPORT } from "../src/lib/demo";
import { FIXTURE_REPORT_DATE, fixtureRawReport } from "../src/lib/intake/__fixtures__/fixture";
import { renderMonitoringReportHtml } from "../src/lib/intake/__fixtures__/monitoringReport";

const dir = "src/lib/intake/__fixtures__";
const html = renderMonitoringReportHtml(fixtureRawReport(DEMO_RAW_REPORT));
writeFileSync(`${dir}/demo-monitoring-report.html`, html);
console.log(`${dir}/demo-monitoring-report.html (report date ${FIXTURE_REPORT_DATE})`);

async function pdf() {
  let chromium: { launch: () => Promise<{ newPage: () => Promise<{ setContent: (h: string) => Promise<void>; pdf: (o: object) => Promise<Buffer> }>; close: () => Promise<void> }> };
  try {
    const require = createRequire(`${process.cwd()}/`);
    ({ chromium } = require("playwright"));
  } catch {
    console.log("Playwright not found: PDF not written.");
    return;
  }
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html);
  const bytes = await page.pdf({ format: "Letter", printBackground: true, margin: { top: "0.4in", bottom: "0.4in", left: "0.4in", right: "0.4in" } });
  writeFileSync(`${dir}/demo-monitoring-report.pdf`, bytes);
  await browser.close();
  console.log(`${dir}/demo-monitoring-report.pdf (${bytes.length} bytes)`);
}
void pdf();
