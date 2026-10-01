import { readFile } from "node:fs/promises";
import { expect, it } from "vite-plus/test";
import { z } from "zod";

const source = new URL("../.github/workflows/catalog-repair.md", import.meta.url);
const compiled = new URL("../.github/workflows/catalog-repair.lock.yml", import.meta.url);

function job(workflow: string, name: string): string {
  const body = workflow.match(new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  \\w+:\\n|$)`))?.[1];
  if (body === undefined) throw new Error(`Missing workflow job: ${name}`);
  return body;
}

it("keeps issue creation unavailable in both the source policy and generated workflow", async () => {
  const markdown = await readFile(source, "utf8");
  const workflow = await readFile(compiled, "utf8");
  const policy = markdown.match(/\nsafe-outputs:\n([\s\S]*?)\njobs:/)?.[1];
  if (policy === undefined) throw new Error("Missing repair output policy");
  const switches = [
    ...policy.matchAll(
      /^\s+(?:report-failure-as-issue|report-failed-jobs|report-as-issue|create-issue|fallback-as-issue): (.+)$/gm,
    ),
  ];
  expect(switches.length).toBeGreaterThan(0);
  for (const match of switches) expect(match[1], match[0]).toBe("false");
  expect(workflow).not.toMatch(/^\s+issues: (?:write|read)$/m);
  expect(job(workflow, "conclusion")).toMatch(/^\s+issues: none$/m);
  for (const match of workflow.matchAll(/^\s+GH_AW_\w*(?:REPORT_AS_ISSUE|CREATE_ISSUE): (.+)$/gm))
    expect(match[1], match[0]).toBe('"false"');
  expect(workflow).not.toMatch(
    /(?:handle_detection_runs|create_missing_data_issue|report_failed_jobs)\.cjs/,
  );
  expect(job(workflow, "detection")).toContain("Conclude threat detection");

  const encoded = workflow.match(/^\s+GH_AW_SAFE_OUTPUTS_HANDLER_CONFIG: (.+)$/m)?.[1];
  if (encoded === undefined) throw new Error("Missing compiled safe-output configuration");
  const config = z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(z.string().parse(JSON.parse(encoded))));
  expect(Object.keys(config).sort()).toEqual([
    "missing_data",
    "missing_tool",
    "noop",
    "report_incomplete",
  ]);
  expect(workflow).not.toContain('"create_pull_request"');
  expect(workflow).not.toMatch(/^\s+pull-requests: write$/m);
  expect(markdown).not.toContain("gh pr list");
});

it("gates automatic publication on exact-patch validation and threat detection", async () => {
  const workflow = await readFile(compiled, "utf8");
  const agent = job(workflow, "agent");
  const publish = job(workflow, "safe_outputs");
  const commit = job(workflow, "commit_repair");
  const delivery = job(workflow, "verify_delivery");
  expect(agent).toContain("scripts/catalog-repair-publication.ts");
  expect(agent).toContain('git show "$REPAIR_BASE_SHA:scripts/catalog-repair-publication.ts"');
  expect(agent).toContain("success() && steps.repair_outcome.outputs.outcome == 'commit_repair'");
  for (const command of [
    "vp check",
    "vp test --run",
    "vp run collect:fixtures",
    "vp run build",
    "vp run package:build",
    "vp run package:check",
  ]) {
    expect(agent).toContain(command);
    expect(commit).toContain(command);
  }
  expect(agent).toContain("validated-catalog-repair");
  expect(agent).toContain('catalog-repair-publication.ts" verify');
  expect(commit).toContain("validated-catalog-repair");
  expect(commit).toContain("needs.safe_outputs.result == 'success'");
  expect(commit).toContain("needs.detection.outputs.detection_success == 'true'");
  expect(commit).toContain("persist-credentials: false");
  expect(commit).toContain("ref: main");
  expect(commit).toContain('catalog-repair-publication.ts" apply');
  expect(commit).toContain('catalog-repair-publication.ts" commit');
  expect(commit).toContain("${{ steps.apply_repair.outputs.tree_sha }}");
  expect(commit).toContain('catalog-repair-publication.ts" push');
  expect(commit).toContain("gh workflow run void-deploy.yml --ref main");
  expect(agent).not.toMatch(/^\s+(?:contents|actions): write$/m);
  expect(publish).toContain("needs.agent.result == 'success'");
  expect(delivery).toContain("always() && needs.agent.result == 'success'");
  expect(delivery).toContain("${{ needs.safe_outputs.result }}");
  expect(delivery).toContain("${{ needs.commit_repair.result }}");
  expect(delivery).toContain("${{ needs.agent.outputs.output_types }}");
  expect(agent).toContain("output_types: ${{ steps.collect_output.outputs.output_types }}");
});
