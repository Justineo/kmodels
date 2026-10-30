import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { fetchSource, fetchStateSchema } from "../src/catalog/fetch.ts";
import { sha256 } from "../src/catalog/io.ts";
import { summarizeDependencyFailures } from "../src/catalog/source-failure.ts";
import {
  linkedPublicSource,
  publicEvidenceBaseline,
  reviewedPublicSource,
} from "../src/catalog/public-evidence.ts";

const sourceId = process.argv[2];
if (!sourceId)
  throw new Error(
    "Usage: vp node scripts/fetch-catalog-evidence.ts SOURCE_ID [--index | FIXED_COMPANION_URL | --linked FIXED_COMPANION_URL TARGET_URL]",
  );
const linked = process.argv[3] === "--linked";
if (linked && (process.argv[4] === undefined || process.argv[5] === undefined || process.argv[6]))
  throw new Error("Linked evidence requires exactly one fixed companion and one target URL");
let source = reviewedPublicSource(sourceId, linked ? process.argv[4] : process.argv[3]);
let linkedFrom: { source_url: string; source_hash: string; body: string } | undefined;
if (linked) {
  const parent = await fetchSource(source);
  linkedFrom = { source_url: source.url, source_hash: sha256(parent.body), body: parent.body };
  source = linkedPublicSource(source, parent.body, z.string().parse(process.argv[5]));
}
const directory = "/tmp/gh-aw/agent/catalog-evidence";
const fetched = await fetchSource(source);
const hash = sha256(fetched.body);
const state = fetchStateSchema.parse(
  JSON.parse(await readFile(new URL("../data/fetch-state.json", import.meta.url), "utf8")),
);
const report = z
  .object({
    generated_at: z.iso.datetime({ offset: true }),
    providers: z.array(
      z.object({
        attempt: z
          .object({ sources: z.array(z.object({ source_id: z.string(), outcome: z.string() })) })
          .optional(),
      }),
    ),
  })
  .parse(
    JSON.parse(await readFile(new URL("../data/refresh-summary.json", import.meta.url), "utf8")),
  );
const companion = reviewedPublicSource(sourceId).linkedDocuments?.documents?.find(
  ({ url }) => url === process.argv[3],
);
const scope = linked
  ? "linked"
  : process.argv[3] === "--index"
    ? "index"
    : companion === undefined
      ? "source"
      : "companion";
const stateKey = linked
  ? `${sourceId}/linked/${source.url}`
  : scope === "index"
    ? `${sourceId}/index`
    : companion === undefined
      ? sourceId
      : `${sourceId}/${companion.id}`;
const attemptOutcome =
  scope === "source"
    ? report.providers
        .flatMap(({ attempt }) => attempt?.sources ?? [])
        .find(({ source_id }) => source_id === sourceId)?.outcome
    : state.sources[stateKey]?.consecutiveFailures === 0
      ? "changed"
      : undefined;
const refresh = publicEvidenceBaseline(stateKey, hash, state, report.generated_at, attemptOutcome);
await mkdir(directory, { recursive: true });
// Equal source bytes can have different observation/refresh metadata. Never overwrite a receipt
// already referenced by an investigation's whole-file hash.
const path = join(directory, `${source.id}-${scope}-${hash.slice(0, 16)}-${randomUUID()}.json`);
const receipt = JSON.stringify({
  source_id: source.id,
  scope,
  source_url: source.url,
  observed_at: new Date().toISOString(),
  source_hash: hash,
  ...(linkedFrom === undefined ? {} : { linked_from: linkedFrom }),
  refresh,
  ...summarizeDependencyFailures(fetched.dependencyFailures ?? []),
  body: fetched.body,
});
await writeFile(path, receipt, { flag: "wx" });
console.log(
  JSON.stringify({
    path,
    sha256: sha256(receipt),
    source_id: source.id,
    scope,
    source_url: source.url,
    source_hash: hash,
    ...(linkedFrom === undefined
      ? {}
      : {
          linked_from: { source_url: linkedFrom.source_url, source_hash: linkedFrom.source_hash },
        }),
    refresh,
    ...summarizeDependencyFailures(fetched.dependencyFailures ?? []),
  }),
);
