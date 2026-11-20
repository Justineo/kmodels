import { z } from "zod";
import { digest } from "./state.ts";
import type { Verification } from "./verification.ts";

const sourceReceipt = z.object({
  source_url: z.string(),
  source_hash: z.string().regex(/^[a-f0-9]{64}$/),
});
async function readIfPresent(read: (path: string) => Promise<string>, path: string) {
  try {
    return await read(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

// Gateway receipts are named with a fresh UUID, even for identical source bytes.
export async function takeoverFindings(
  report: Verification,
  patch: string,
  read: (path: string) => Promise<string>,
) {
  const sourceKeys = new Map<string, string>();
  async function probeKey(code: string) {
    for (const [path] of code.matchAll(
      /\/tmp\/gh-aw\/agent\/independent-sources\/[0-9a-f-]{36}\.json/g,
    )) {
      let key = sourceKeys.get(path);
      if (!key) {
        const raw = await readIfPresent(read, path);
        if (raw === undefined) key = "missing-source";
        else {
          const source = sourceReceipt.parse(JSON.parse(raw));
          key = JSON.stringify([source.source_url, source.source_hash]);
        }
        sourceKeys.set(path, key);
      }
      code = code.replaceAll(path, key);
    }
    return digest(code);
  }
  const findings = [];
  for (const row of report.candidates.filter((row) => row.verdict === "concrete_error")) {
    const counterexamples = new Set<string>();
    const checks = [];
    for (const check of row.checks) {
      const raw = await read(check.output.path);
      if (digest(raw) !== check.output.sha256) throw new Error("Takeover check changed");
      let receipt: unknown;
      try {
        receipt = JSON.parse(raw);
      } catch {
        continue;
      }
      const parsed = z
        .object({ command: z.string(), exit_code: z.number().int().nullable() })
        .safeParse(receipt);
      if (!parsed.success) continue;
      const probes = [];
      for (const match of parsed.data.command.matchAll(
        /(?:^|[\s"])(?:\/workspace\/)?repair-probes\/([\w.-]+\.test\.ts)(?=$|[\s"])/g,
      )) {
        const name = match[1];
        if (!name) continue;
        const path = "/tmp/gh-aw/agent/probes/" + name;
        const code = await readIfPresent(read, path);
        if (code === undefined) continue;
        counterexamples.add(await probeKey(code));
        probes.push("repair-probes/" + name);
      }
      checks.push({
        kind: check.kind,
        receipt: check.output.path,
        exit_code: parsed.data.exit_code,
        probes,
      });
    }
    findings.push({
      id: row.id,
      key: digest(JSON.stringify([digest(patch), [...counterexamples].sort()])),
      expected: row.expected,
      actual: row.actual,
      reason: row.reason,
      evidence: row.evidence,
      checks,
    });
  }
  return findings;
}
