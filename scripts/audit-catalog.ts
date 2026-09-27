import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchSource } from "../src/catalog/fetch.ts";
import {
  auditDecisionsSchema,
  auditCacheSchema,
  auditSemanticCoverage,
  auditSnapshot,
  auditSnapshotSchema,
  auditTarget,
  emptySemanticAudit,
  prepareSemanticAudit,
  semanticAuditMarkdown,
  semanticContracts,
  type AuditCache,
} from "../src/catalog/semantic-audit.ts";
import { reviewedPublicSource } from "../src/catalog/public-evidence.ts";

const directory = process.env.KMODELS_SEMANTIC_AUDIT_DIR ?? "/tmp/kmodels-semantic-audit";
await mkdir(directory, { recursive: true });
const replayIndex = process.argv.indexOf("--replay");
const replayPath = replayIndex < 0 ? undefined : process.argv[replayIndex + 1];
if (replayIndex >= 0) {
  if (replayPath === undefined) throw new Error("--replay requires snapshot.json");
  const snapshot = auditSnapshotSchema.parse(JSON.parse(await readFile(replayPath, "utf8")));
  const result = prepareSemanticAudit(snapshot);
  await writeFile(
    join(directory, "replayed-records.json"),
    `${JSON.stringify(result.records, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      source_hash: snapshot.source_hash,
      output_hash: result.output_hash,
      extractor_version: auditTarget().source.extractorVersion,
      records_path: join(directory, "replayed-records.json"),
    }),
  );
} else {
  const at = new Date().toISOString();
  const apiKey = process.env.JEV_API_KEY?.trim();
  let report = emptySemanticAudit(apiKey ? "failed" : "skipped", at);
  // A timeout/process interruption during an enabled audit must remain incomplete, not skipped.
  await writeFile(join(directory, "report.json"), JSON.stringify(report));
  if (apiKey) {
    try {
      const documents = [];
      for (const { path } of semanticContracts) {
        const url = `https://vercel.com${path}`;
        try {
          const source = reviewedPublicSource(auditTarget().source.id, url);
          const fetched = await fetchSource({ ...source, maxResponseBytes: 64_000 });
          documents.push({ url, body: fetched.body });
        } catch {
          /* The report retains every missing document as incomplete evidence. */
        }
      }
      const snapshot = auditSnapshot(documents, at);
      await writeFile(join(directory, "snapshot.json"), `${JSON.stringify(snapshot)}\n`);
      let cache: AuditCache = {};
      try {
        cache = auditCacheSchema.parse(
          JSON.parse(await readFile(join(directory, "cache.json"), "utf8")),
        );
      } catch {
        /* An absent or invalid optional cache requires fresh judgments. */
      }
      const prepared = prepareSemanticAudit(snapshot);
      await writeFile(
        join(directory, "parsed-records.json"),
        `${JSON.stringify(prepared.records, null, 2)}\n`,
      );
      report = await auditSemanticCoverage(snapshot, { apiKey, cache });
      // Retain only this run's exact requests, bounding persistent cache growth.
      const current = new Set(report.judgments.map(({ request_hash }) => request_hash));
      await writeFile(
        join(directory, "cache.json"),
        JSON.stringify(
          Object.fromEntries(Object.entries(cache).filter(([hash]) => current.has(hash))),
        ),
      );
    } catch {
      report = emptySemanticAudit("failed", at);
    }
  }
  const decisions = auditDecisionsSchema.parse(
    JSON.parse(
      await readFile(new URL("../docs/semantic-audit-decisions.json", import.meta.url), "utf8"),
    ),
  );
  await writeFile(join(directory, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  const markdown = semanticAuditMarkdown(report, decisions);
  console.log(markdown.trimEnd());
  if (process.env.GITHUB_STEP_SUMMARY !== undefined)
    await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
}
