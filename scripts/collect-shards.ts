import { execFileSync } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { collect } from "../src/catalog/collector.ts";
import { atomicWrite, rootDirectory } from "../src/catalog/io.ts";
import { parseIJson } from "../src/catalog/canonical-json.ts";
import { canonicalJson } from "../src/catalog/canonical-value.ts";
import {
  assertCollectionBase,
  collectionPlanId,
  collectionShardIds,
  collectShard,
  createCollectionPlan,
  parseCollectionPlan,
  readCollectionShards,
  writeCollectionShard,
} from "../src/catalog/collection-shards.ts";

async function main() {
  const [command, first, second, third] = process.argv.slice(2);
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const data = join(rootDirectory, "data");
  const pointer = await readFile(join(data, "catalog-snapshot.json"));
  if (command === "plan" && first !== undefined) {
    const plan = createCollectionPlan(revision, pointer);
    await atomicWrite(join(resolve(first), "plan.json"), canonicalJson(plan));
    if (process.env.GITHUB_OUTPUT !== undefined)
      await appendFile(
        process.env.GITHUB_OUTPUT,
        `sha=${revision}\nplan_id=${collectionPlanId(plan)}\n`,
      );
    return;
  }
  if (first === undefined) throw new Error("Collection requires a plan");
  const plan = parseCollectionPlan(parseIJson(await readFile(first), 65_536));
  assertCollectionBase(plan, revision, pointer);
  if (command === "collect" && second !== undefined && third !== undefined) {
    const id = collectionShardIds.find((id) => id === second);
    if (id === undefined) throw new Error("Unknown collection shard");
    const jitter = Number(process.env.KMODELS_JITTER_MS ?? "0");
    if (Number.isFinite(jitter) && jitter > 0) await wait(Math.floor(Math.random() * jitter));
    const shard = await collectShard(plan, id, data);
    await writeCollectionShard(resolve(third), shard);
    console.log(`Collected ${shard.batch.results.length} providers in ${id}`);
    return;
  }
  if (command === "merge" && second !== undefined) {
    const collected = await readCollectionShards(resolve(second), plan);
    const catalog = await collect({ now: new Date(plan.observed_at), collected });
    console.log(
      `Assembled ${catalog.models.length} models from ${collected.results.length} providers`,
    );
    return;
  }
  throw new Error(
    "Usage: collect-shards plan OUTPUT | collect PLAN SHARD OUTPUT | merge PLAN INPUT",
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
