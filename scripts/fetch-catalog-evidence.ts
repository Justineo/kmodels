import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchSource } from "../src/catalog/fetch.ts";
import { sha256 } from "../src/catalog/io.ts";
import { reviewedPublicSource } from "../src/catalog/public-evidence.ts";

const sourceId = process.argv[2];
if (!sourceId)
  throw new Error(
    "Usage: vp node scripts/fetch-catalog-evidence.ts SOURCE_ID [FIXED_COMPANION_URL]",
  );
const source = reviewedPublicSource(sourceId, process.argv[3]);
const directory = "/tmp/gh-aw/agent/catalog-evidence";
const fetched = await fetchSource(source);
const hash = sha256(fetched.body);
await mkdir(directory, { recursive: true });
const path = join(directory, `${source.id}-${hash.slice(0, 16)}.json`);
await writeFile(
  path,
  JSON.stringify({
    source_id: source.id,
    source_url: source.url,
    observed_at: new Date().toISOString(),
    source_hash: hash,
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
    omitted_dependencies: fetched.omittedOptionalDependencies ?? [],
    omitted_documents: fetched.omittedOptionalDocuments ?? [],
  }),
);
