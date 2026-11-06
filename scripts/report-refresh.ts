import { appendFile, readFile } from "node:fs/promises";
import { refreshReport } from "../src/catalog/refresh-report.ts";

const configuredPath = process.env.KMODELS_REFRESH_REPORT_PATH;
const reportPath = configuredPath ?? new URL("../data/refresh-summary.json", import.meta.url);
const summaryPath = process.env.GITHUB_STEP_SUMMARY;

let source: string;
try {
  source = await readFile(reportPath, "utf8");
} catch (error) {
  if (configuredPath === undefined) throw error;
  const markdown = "## Catalog refresh\n\nNo structured refresh report was produced.\n";
  console.log("::warning title=Catalog refresh::No structured refresh report was produced");
  if (summaryPath !== undefined) await appendFile(summaryPath, markdown);
  process.exit(0);
}

const output = refreshReport(JSON.parse(source));
if (summaryPath === undefined) console.log(output.markdown.trimEnd());
for (const warning of output.warnings)
  console.log(`::warning title=Catalog refresh::${warning.replaceAll("%", "%25")}`);
if (summaryPath !== undefined) {
  await appendFile(summaryPath, output.markdown);
  console.log("Catalog refresh details are in the job summary.");
}
