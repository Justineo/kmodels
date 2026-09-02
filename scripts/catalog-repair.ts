import { appendFile, readFile, writeFile } from "node:fs/promises";
import { catalogRepairCandidates } from "../src/catalog/catalog-repair.ts";

const configuredPath = process.env.KMODELS_REFRESH_REPORT_PATH;
const reportPath = configuredPath ?? new URL("../data/refresh-summary.json", import.meta.url);
const candidates = catalogRepairCandidates(JSON.parse(await readFile(reportPath, "utf8")));

const markdown = [
  "## Catalog repair candidates",
  "",
  ...(candidates.length === 0
    ? ["No catalog problem requiring agent review was found."]
    : [
        "| Provider | Subject | Trigger | Access | Evidence |",
        "| --- | --- | --- | --- | --- |",
        ...candidates.map(
          ({ provider_id, subject_id, trigger, source_access, message }) =>
            `| ${provider_id} | ${subject_id} | ${trigger} | ${source_access ?? "provider"} | ${message.replaceAll("|", "\\|")} |`,
        ),
      ]),
  "",
].join("\n");

console.log(JSON.stringify(candidates, null, 2));
const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (summaryPath !== undefined) await appendFile(summaryPath, markdown);

const outputPath = process.argv[2] === "--github-output" ? process.argv[3] : undefined;
if (outputPath !== undefined)
  await appendFile(outputPath, `repairable=${candidates.length > 0 ? "true" : "false"}\n`);

if (candidates.length === 0) {
  const safeOutputsPath = process.env.GH_AW_SAFE_OUTPUTS;
  if (safeOutputsPath !== undefined)
    await appendFile(
      safeOutputsPath,
      `${JSON.stringify({ type: "noop", message: "No catalog problem requires agent review" })}\n`,
    );
}

const contextPath = process.env.KMODELS_CATALOG_REPAIR_CONTEXT;
if (contextPath !== undefined) await writeFile(contextPath, markdown);
