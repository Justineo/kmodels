import { appendFile, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as wait } from "node:timers/promises";
import { z } from "zod";
import { manifests, type SourceManifest } from "../../src/catalog/manifests.ts";
import { assistanceRequest, askOpenAI } from "./openai.ts";
import { leaseSchema } from "./state.ts";
import { readSharedFile, writePrivateJson } from "./files.ts";

const admissionSchema = z.object({
  candidates: z.array(z.object({ id: z.string() })),
  difficulty: z.enum(["routine", "semantic", "complex"]).default("semantic"),
});
export async function boundedEvidence(path: string, root: string): Promise<string> {
  const body = await readSharedFile(path, root, 128 * 1024);
  const evidence = z
    .object({ source_id: z.string(), source_url: z.url(), body: z.string() })
    .parse(JSON.parse(body));
  const source = manifests
    .flatMap<SourceManifest>((manifest) => manifest.sources)
    .find((source) => source.id === evidence.source_id);
  if (
    !source ||
    source.access !== "public" ||
    source.auth ||
    !source.allowedHosts.includes(new URL(evidence.source_url).hostname)
  )
    throw new Error("Expert evidence requires a reviewed public source");
  return body;
}

async function main(): Promise<void> {
  const [privateDirectory, admissionPath, leasePath] = process.argv.slice(2);
  if (!privateDirectory || !admissionPath || !leasePath)
    throw new Error("Expected private directory, admission and lease");
  const key = process.env.CATALOG_REPAIR_OPENAI_API_KEY;
  const admission = admissionSchema.parse(JSON.parse(await readFile(admissionPath, "utf8")));
  const lease = leaseSchema.parse(JSON.parse(await readFile(leasePath, "utf8")));
  const directory = "/tmp/gh-aw/agent/expert";
  await mkdir(directory, { recursive: true });
  await mkdir(privateDirectory, { recursive: true });
  // Record the actual Node process, not the vp launcher, for reliable post-step termination.
  await writeFile(join(privateDirectory, "pid"), String(process.pid));
  let charged = 0;
  let activeReservation = 0;
  const seen = new Set<string>();
  const save = async () =>
    writePrivateJson(join(privateDirectory, "usage.json"), {
      lease_id: lease.id,
      charged_microusd: charged + activeReservation,
    });
  await save();
  await writeFile(
    join(directory, "availability.json"),
    JSON.stringify({
      available: Boolean(key && lease.reserved_microusd > 7_500_000),
      difficulty: admission.difficulty,
      allowance_microusd: Math.max(0, lease.reserved_microusd - 7_500_000),
    }),
  );
  const deadline = Date.now() + 50 * 60000;
  while (Date.now() < deadline) {
    if (
      await lstat(join(privateDirectory, "stop")).then(
        () => true,
        () => false,
      )
    )
      break;
    for (const name of (await readdir(directory))
      .filter((name) => /^[a-f0-9-]{36}\.request\.json$/.test(name))
      .sort()) {
      if (seen.has(name)) continue;
      seen.add(name);
      let result: unknown;
      try {
        if (seen.size > 8) throw new Error("At most eight expert requests per investigation");
        if (lease.month !== new Date().toISOString().slice(0, 7))
          throw new Error("OpenAI lease expired at the UTC month boundary");
        if (!key || lease.reserved_microusd === 0)
          throw new Error("OpenAI unavailable or monthly budget exhausted");
        const path = join(directory, name);
        const request = assistanceRequest.parse(
          JSON.parse(await readSharedFile(path, directory, 24000)),
        );
        if (
          name !== `${request.id}.request.json` ||
          !admission.candidates.some((candidate) => candidate.id === request.candidate_id)
        )
          throw new Error("Expert request is outside immutable admission");
        const provider = request.candidate_id.split("/")[0];
        const sources = manifests
          .filter((manifest) => provider === "catalog" || manifest.provider.id === provider)
          .flatMap<SourceManifest>((manifest) => manifest.sources)
          .filter((source) => source.access === "public" && !source.auth);
        const evidence = (
          await Promise.all(
            request.evidence.map((path) =>
              boundedEvidence(path, "/tmp/gh-aw/agent/catalog-evidence"),
            ),
          )
        ).join("\n");
        result = await askOpenAI({
          key,
          request,
          level: admission.difficulty,
          domains: [...new Set(sources.flatMap((source) => source.allowedHosts))],
          evidence,
          available: Math.max(0, lease.reserved_microusd - 7_500_000 - charged),
          reserve: async (amount) => {
            activeReservation = amount;
            await save();
          },
          settle: async (amount) => {
            charged += amount;
            activeReservation = 0;
            await save();
          },
        });
      } catch (error) {
        charged += activeReservation;
        activeReservation = 0;
        await save();
        result = {
          error: error instanceof Error ? error.message : "Expert assistance failed",
          incomplete: true,
        };
      }
      const output = JSON.stringify(result);
      await writeFile(join(directory, name.replace(".request.", ".response.")), output, {
        flag: "wx",
      });
      // The agent can edit its response copy but cannot alter this trusted journal or spending.
      await appendFile(
        join(privateDirectory, "journal.jsonl"),
        JSON.stringify({ request: name, response: result }) + "\n",
      );
    }
    await wait(1000);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
