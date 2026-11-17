import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { digest } from "./state.ts";

const directory = process.env.MAINTENANCE_OUTPUT;
if (!directory) throw new Error("Missing deployment receipt directory");
await mkdir(directory, { recursive: true });
await writeFile(
  join(directory, "deployment.json"),
  JSON.stringify({
    revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    snapshot_sha256: digest(await readFile("data/catalog-snapshot.json", "utf8")),
  }),
);
