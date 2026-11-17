import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { leaseSchema } from "./state.ts";
import { writePrivateJson } from "./files.ts";

const temp = process.env.RUNNER_TEMP;
if (!temp) throw new Error("Missing runner directory");
const lease = leaseSchema.parse(
  JSON.parse(await readFile(join(temp, "gh-aw/maintenance/lease.json"), "utf8")),
);
await mkdir(join(temp, "repair-expert"), { recursive: true });
await writePrivateJson(join(temp, "repair-expert/usage.json"), {
  lease_id: lease.id,
  charged_microusd: 0,
});
