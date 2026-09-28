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
    "create_pull_request",
    "missing_data",
    "missing_tool",
    "noop",
    "report_incomplete",
  ]);
  expect(config.create_pull_request).toMatchObject({
    draft: true,
    fallback_as_issue: false,
    if_no_changes: "error",
    max: 1,
  });
});

it("gates PR publication on validation and checks the delivered result", async () => {
  const workflow = await readFile(compiled, "utf8");
  const agent = job(workflow, "agent");
  const publish = job(workflow, "safe_outputs");
  const delivery = job(workflow, "verify_delivery");
  expect(agent).toContain("scripts/check-catalog-repair-outcome.ts");
  expect(agent).toContain(
    "success() && steps.repair_outcome.outputs.outcome == 'create_pull_request'",
  );
  for (const command of ["vp check", "vp test --run", "vp run collect:fixtures", "vp run build"])
    expect(agent).toContain(command);
  expect(publish).toContain("needs.agent.result == 'success'");
  expect(delivery).toContain("always() && needs.agent.result == 'success'");
  expect(delivery).toContain("${{ needs.safe_outputs.result }}");
  expect(delivery).toContain("${{ needs.safe_outputs.outputs.created_pr_url }}");
  expect(delivery).toContain("${{ needs.agent.outputs.output_types }}");
  expect(agent).toContain("output_types: ${{ steps.collect_output.outputs.output_types }}");
});
