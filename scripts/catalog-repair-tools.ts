import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as wait } from "node:timers/promises";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { assistanceRequest } from "./repair/openai.ts";
import { readReviewEvidence, reviewHash } from "./catalog-repair-review.ts";
import { parseEvidence } from "./replay-catalog-evidence.ts";

const root = "/tmp/gh-aw/agent";
export function factChanges(
  before: unknown,
  after: unknown,
): { path: string; before: unknown; after: unknown }[] {
  const changes: { path: string; before: unknown; after: unknown }[] = [];
  function visit(left: unknown, right: unknown, path: string): void {
    if (JSON.stringify(left) === JSON.stringify(right)) return;
    if (changes.length >= 500) throw new Error("Fact diff exceeds 500 changes; narrow the input");
    if (
      left !== null &&
      right !== null &&
      typeof left === "object" &&
      typeof right === "object" &&
      !Array.isArray(left) &&
      !Array.isArray(right)
    ) {
      const l = z.record(z.string(), z.unknown()).parse(left);
      const r = z.record(z.string(), z.unknown()).parse(right);
      for (const key of [...new Set([...Object.keys(l), ...Object.keys(r)])].sort())
        visit(l[key], r[key], `${path}/${key}`);
    } else changes.push({ path, before: left ?? null, after: right ?? null });
  }
  visit(before, after, "");
  return changes;
}
async function main(): Promise<void> {
  const [command, first, second, third, ...rest] = process.argv.slice(2);
  if (command === "expert" && first && second && third) {
    const request = assistanceRequest.parse({
      id: randomUUID(),
      candidate_id: first,
      purpose: second,
      question: await readReviewEvidence(third),
      evidence: rest,
    });
    const directory = join(root, "expert");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${request.id}.request.json`), JSON.stringify(request), {
      flag: "wx",
    });
    const response = join(directory, `${request.id}.response.json`);
    const deadline = Date.now() + 210000;
    while (Date.now() < deadline) {
      const value = await readFile(response, "utf8").catch(() => undefined);
      if (value !== undefined) {
        console.log(value);
        return;
      }
      await wait(1000);
    }
    throw new Error(
      `Expert request pending: ${request.id}. Save its ID; do not submit a duplicate.`,
    );
  }
  if (command === "unpack" && first) {
    const bytes = await readFile(first);
    const body = gunzipSync(bytes, { maxOutputLength: 34 * 1024 * 1024 }).toString("utf8");
    const receipt = z
      .object({
        source_id: z.string().regex(/^[a-z0-9-]+$/),
        source_hash: z.string(),
        body: z.string(),
      })
      .parse(JSON.parse(body));
    if (reviewHash(receipt.body) !== receipt.source_hash)
      throw new Error("Captured source hash mismatch");
    const directory = join(root, "catalog-evidence");
    await mkdir(directory, { recursive: true });
    const path = join(directory, `${receipt.source_id}-${randomUUID()}.json`);
    await writeFile(path, body, { flag: "wx" });
    console.log(JSON.stringify({ path, sha256: reviewHash(body) }));
    return;
  }
  if (command === "context" && first && second) {
    const input: unknown = JSON.parse(await readReviewEvidence(second));
    const context: unknown = third ? JSON.parse(await readReviewEvidence(third)) : undefined;
    const { result } = parseEvidence(first, input, context);
    const body = JSON.stringify(result.models);
    const path = join(root, `parsed-context-${randomUUID()}.json`);
    await writeFile(path, body, { flag: "wx" });
    console.log(
      JSON.stringify({
        stage: "parse",
        path,
        sha256: reviewHash(body),
        models: result.models.length,
      }),
    );
    return;
  }
  if (command === "diff" && first && second) {
    console.log(
      JSON.stringify(
        factChanges(
          JSON.parse(await readReviewEvidence(first)),
          JSON.parse(await readReviewEvidence(second)),
        ),
        null,
        2,
      ),
    );
    return;
  }
  if (command === "record" && first && second) {
    const reviewPath = join(root, "catalog-repair-review.json");
    const review = z
      .object({ candidates: z.array(z.object({ id: z.string() }).passthrough()) })
      .passthrough()
      .parse(JSON.parse(await readReviewEvidence(reviewPath)));
    const index = review.candidates.findIndex((candidate) => candidate.id === first);
    if (index < 0) throw new Error("Cannot add a candidate outside admission");
    const update = z
      .object({ id: z.literal(first) })
      .passthrough()
      .parse(JSON.parse(await readReviewEvidence(second)));
    // Generate all reference hashes rather than asking the model to transcribe them.
    const refs = z.array(z.object({ path: z.string() }).passthrough());
    if (update.evidence)
      update.evidence = await Promise.all(
        refs
          .parse(update.evidence)
          .map(async (ref) => ({ ...ref, sha256: reviewHash(await readReviewEvidence(ref.path)) })),
      );
    review.candidates[index] = update;
    await writeFile(reviewPath, JSON.stringify(review, null, 2));
    console.log(
      "Recorded candidate; run check-repair, check-no-defect or check-incomplete before submitting.",
    );
    return;
  }
  throw new Error(
    "Expected expert CANDIDATE PURPOSE QUESTION_FILE [EVIDENCE...], unpack CAPTURE, context SOURCE EVIDENCE [CONTEXT], diff BEFORE AFTER, or record CANDIDATE JSON",
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
