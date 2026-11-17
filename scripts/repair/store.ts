import { execFileSync } from "node:child_process";
import { z } from "zod";
import { emptyState, stateSchema, type MaintenanceState } from "./state.ts";

export const stateBranch = "catalog-maintenance";
const path = "state.json";
export function githubApi(route: string, method = "GET", body?: unknown): unknown {
  const args = ["api", route, "--method", method];
  if (body !== undefined) args.push("--input", "-");
  return JSON.parse(
    execFileSync("gh", args, {
      encoding: "utf8",
      timeout: 60000,
      maxBuffer: 12 * 1024 * 1024,
      ...(body === undefined ? {} : { input: JSON.stringify(body) }),
    }),
  );
}
export function repository(): string {
  const value = process.env.GITHUB_REPOSITORY;
  if (!value || !/^[\w.-]+\/[\w.-]+$/.test(value))
    throw new Error("Missing maintenance repository");
  return value;
}
export function readState(repo: string): { state: MaintenanceState; sha?: string } {
  // List exact branch refs to distinguish a cold start from an API/authentication failure.
  const refs = z
    .array(z.object({ ref: z.string() }))
    .parse(githubApi(`repos/${repo}/git/matching-refs/heads/${stateBranch}`));
  if (!refs.some((ref) => ref.ref === `refs/heads/${stateBranch}`)) return { state: emptyState() };
  const file = z
    .object({
      sha: z.string(),
      encoding: z.string(),
      content: z.string(),
      size: z.number().int().nonnegative(),
    })
    .parse(githubApi(`repos/${repo}/contents/${path}?ref=${stateBranch}`));
  if (file.size > 4 * 1024 * 1024) throw new Error("Maintenance state exceeds 4 MiB");
  // Contents responses omit inline content above 1 MiB; the immutable blob still carries it.
  const blob =
    file.encoding === "base64"
      ? file
      : z
          .object({ encoding: z.literal("base64"), content: z.string() })
          .parse(githubApi(`repos/${repo}/git/blobs/${file.sha}`));
  const text = Buffer.from(blob.content, "base64").toString("utf8");
  if (Buffer.byteLength(text) > 4 * 1024 * 1024) throw new Error("Maintenance state exceeds 4 MiB");
  return { state: stateSchema.parse(JSON.parse(text)), sha: file.sha };
}
export function writeState(repo: string, state: MaintenanceState, sha?: string): void {
  const content = JSON.stringify(stateSchema.parse(state));
  if (Buffer.byteLength(content) > 4 * 1024 * 1024)
    throw new Error("Maintenance state exceeds 4 MiB");
  if (sha === undefined) {
    const blob = z
      .object({ sha: z.string() })
      .parse(githubApi(`repos/${repo}/git/blobs`, "POST", { content, encoding: "utf-8" }));
    const tree = z.object({ sha: z.string() }).parse(
      githubApi(`repos/${repo}/git/trees`, "POST", {
        tree: [{ path, mode: "100644", type: "blob", sha: blob.sha }],
      }),
    );
    const commit = z.object({ sha: z.string() }).parse(
      githubApi(`repos/${repo}/git/commits`, "POST", {
        message: "Initialize trusted catalog maintenance state",
        tree: tree.sha,
        parents: [],
      }),
    );
    githubApi(`repos/${repo}/git/refs`, "POST", {
      ref: `refs/heads/${stateBranch}`,
      sha: commit.sha,
    });
  } else
    githubApi(`repos/${repo}/contents/${path}`, "PUT", {
      branch: stateBranch,
      message: "Update trusted catalog maintenance state",
      sha,
      content: Buffer.from(content).toString("base64"),
    });
}
