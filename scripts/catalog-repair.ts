import { appendFile, readFile, writeFile } from "node:fs/promises";
import {
  catalogRepairCandidates,
  catalogRepairEvidenceIncomplete,
} from "../src/catalog/catalog-repair.ts";
import { join } from "node:path";
import {
  auditDecisionsSchema,
  semanticAuditMarkdown,
  semanticAuditReportSchema,
  semanticRepairCandidates,
} from "../src/catalog/semantic-audit.ts";

const configuredPath = process.env.KMODELS_REFRESH_REPORT_PATH;
const reportPath = configuredPath ?? new URL("../data/refresh-summary.json", import.meta.url);
const report: unknown = JSON.parse(await readFile(reportPath, "utf8"));
const candidates = catalogRepairCandidates(report);
const sourceEvidenceIncomplete = catalogRepairEvidenceIncomplete(report);
let semanticMarkdown = "";
let auditIncomplete = false;
const auditDirectory = process.env.KMODELS_SEMANTIC_AUDIT_DIR;
if (auditDirectory !== undefined) {
  try {
    const audit = semanticAuditReportSchema.parse(
      JSON.parse(await readFile(join(auditDirectory, "report.json"), "utf8")),
    );
    const decisions = auditDecisionsSchema.parse(
      JSON.parse(
        await readFile(new URL("../docs/semantic-audit-decisions.json", import.meta.url), "utf8"),
      ),
    );
    auditIncomplete = ["partial", "failed"].includes(audit.status);
    const snapshot: unknown = ["skipped", "failed"].includes(audit.status)
      ? undefined
      : JSON.parse(await readFile(join(auditDirectory, "snapshot.json"), "utf8"));
    const additions = semanticRepairCandidates(audit, snapshot, decisions);
    for (const candidate of additions) {
      if (
        !candidates.some(
          ({ provider_id, subject_id }) =>
            provider_id === candidate.provider_id && subject_id === candidate.subject_id,
        )
      )
        candidates.push(candidate);
    }
    semanticMarkdown =
      semanticAuditMarkdown(audit, decisions) +
      `\nAudit evidence directory: ${auditDirectory}. Replay: vp node scripts/audit-catalog.ts --replay ${join(auditDirectory, "snapshot.json")}\n`;
  } catch {
    auditIncomplete = true;
    semanticMarkdown =
      "## Source semantic audit\n\nAudit unavailable, invalid, or stale. Deterministic repair candidates remain unchanged.\n";
  }
}

const markdown =
  [
    "## Catalog repair candidates",
    "",
    ...(candidates.length === 0
      ? [
          auditIncomplete || sourceEvidenceIncomplete
            ? "No deterministic repair candidate was found; source or audit evidence is incomplete."
            : "No deterministic catalog code-repair candidate was found.",
        ]
      : [
          "| Provider | Subject | Trigger | Access | Evidence |",
          "| --- | --- | --- | --- | --- |",
          ...candidates.map(
            ({ provider_id, subject_id, trigger, source_access, message }) =>
              `| ${provider_id} | ${subject_id} | ${trigger} | ${source_access ?? "provider"} | ${message.replaceAll("|", "\\|")} |`,
          ),
        ]),
    "",
    ...(sourceEvidenceIncomplete
      ? [
          "The refresh contains unavailable source evidence. This does not prove a parser defect or a healthy source; unresolved acquisition must remain incomplete.",
          "",
        ]
      : []),
  ].join("\n") + semanticMarkdown;

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
      `${JSON.stringify(
        auditIncomplete || sourceEvidenceIncomplete
          ? {
              type: "report_incomplete",
              reason:
                "Source or audit evidence is unavailable, invalid or partial; no conclusion about complete coverage is possible.",
            }
          : { type: "noop", message: "No deterministic catalog code-repair candidate was found" },
      )}\n`,
    );
}

const contextPath = process.env.KMODELS_CATALOG_REPAIR_CONTEXT;
if (contextPath !== undefined) await writeFile(contextPath, markdown);
