import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { fetchSource, fetchStateSchema } from "../src/catalog/fetch.ts";
import { sha256 } from "../src/catalog/io.ts";
import { publicEvidenceBaseline, reviewedPublicSource } from "../src/catalog/public-evidence.ts";

const sourceId = process.argv[2];
if (!sourceId)
  throw new Error(
    "Usage: vp node scripts/fetch-catalog-evidence.ts SOURCE_ID [FIXED_COMPANION_URL]",
  );
const source = reviewedPublicSource(sourceId, process.argv[3]);
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
const stateKey = companion === undefined ? sourceId : `${sourceId}/${companion.id}`;
const attemptOutcome =
  companion === undefined
    ? report.providers
        .flatMap(({ attempt }) => attempt?.sources ?? [])
        .find(({ source_id }) => source_id === sourceId)?.outcome
    : state.sources[stateKey]?.consecutiveFailures === 0
      ? "changed"
      : undefined;
const refresh = publicEvidenceBaseline(stateKey, hash, state, report.generated_at, attemptOutcome);
await mkdir(directory, { recursive: true });
const path = join(directory, `${source.id}-${hash.slice(0, 16)}.json`);
await writeFile(
  path,
  JSON.stringify({
    source_id: source.id,
    source_url: source.url,
    observed_at: new Date().toISOString(),
    source_hash: hash,
    refresh,
    omitted_dependencies: fetched.omittedOptionalDependencies ?? [],
    omitted_documents: fetched.omittedOptionalDocuments ?? [],
    body: fetched.body,
  }),
);
console.log(
  JSON.stringify({
    path,
    source_id: source.id,
    source_url: source.url,
    source_hash: hash,
    refresh,
    omitted_dependencies: fetched.omittedOptionalDependencies ?? [],
    omitted_documents: fetched.omittedOptionalDocuments ?? [],
  }),
);
