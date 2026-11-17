import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { manifests } from "../../src/catalog/manifests.ts";

const directory = process.env.MAINTENANCE_OUTPUT;
if (!directory) throw new Error("Missing publication receipt directory");
const accepted = z
  .object({ sources: z.array(z.object({ id: z.string() })) })
  .parse(JSON.parse(await readFile("data/catalog.json", "utf8")));
const ids = new Set(accepted.sources.map((source) => source.id));
const artifact = process.env.REPAIR_ARTIFACT_DIR;
if (!artifact) throw new Error("Missing admitted publication artifact");
const patch = z
  .object({ patch_sha256: z.string().regex(/^[a-f0-9]{64}$/) })
  .parse(JSON.parse(await readFile(join(artifact, "repair.json"), "utf8")));
const providers = Object.fromEntries(
  manifests.map((manifest) => [
    manifest.provider.id,
    Object.fromEntries(
      manifest.sources
        .filter((source) => source.access === "public" || ids.has(source.id))
        .map((source) => [source.id, source.extractorVersion]),
    ),
  ]),
);
const shared = Object.fromEntries(
  Object.values(providers).flatMap((versions) => Object.entries(versions)),
);
await mkdir(directory, { recursive: true });
await writeFile(
  join(directory, "publication.json"),
  JSON.stringify({
    revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    patch_sha256: patch.patch_sha256,
    providers: { ...providers, catalog: shared, workflow: shared },
  }),
);
