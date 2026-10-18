import { readFile } from "node:fs/promises";
import { expect, it } from "vite-plus/test";
import { z } from "zod";

const source = new URL("../.github/workflows/catalog-repair.md", import.meta.url);
const compiled = new URL("../.github/workflows/catalog-repair.lock.yml", import.meta.url);

it("routes repair and threat detection to DeepSeek without exposing the inference key to their agents", async () => {
  const workflow = await readFile(compiled, "utf8");
  for (const name of ["agent", "detection"]) {
    const phase = job(workflow, name);
    expect(phase).toContain("COPILOT_MODEL: deepseek-flash");
    expect(phase).toContain("COPILOT_PROVIDER_BASE_URL: https://api.deepseek.com");
    expect(phase).toContain("COPILOT_PROVIDER_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}");
    expect(phase).toContain("COPILOT_PROVIDER_TYPE: openai");
    expect(phase).toContain("COPILOT_PROVIDER_WIRE_API: responses");
    expect(phase).toContain("--exclude-env COPILOT_PROVIDER_API_KEY");
    expect(phase).toContain(String.raw`\"targets\":{\"copilot\":{\"host\":\"api.deepseek.com\"}}`);
    expect(phase).not.toContain("COPILOT_MODEL: gpt-5.6-luna");
  }
  expect(job(workflow, "agent")).toContain(String.raw`\"modelFallback\":{\"enabled\":false}`);
});

it("supplies DeepSeek pricing to both proxies with per-token units and a cache-read discount", async () => {
  const workflow = await readFile(compiled, "utf8");
  const encoded = workflow.match(/^\s+GH_AW_INFO_MODEL_COSTS: '(.*)'$/m)?.[1];
  if (encoded === undefined) throw new Error("Missing BYOK model pricing overlay");
  const raw = z.record(z.string(), z.unknown()).parse(JSON.parse(encoded));
  const price = z.string().transform(Number).pipe(z.number().nonnegative());
  const overlay = z
    .object({
      providers: z.object({
        "github-copilot": z.object({
          models: z.object({
            "deepseek-flash": z.object({
              cost: z.object({
                input: price,
                output: price,
                cache_read: price,
                cache_write: price,
              }),
            }),
          }),
        }),
      }),
    })
    .parse(raw);
  const cost = overlay.providers["github-copilot"].models["deepseek-flash"].cost;
  expect((cost.input + cost.cache_read + cost.output) * 1_000_000).toBeCloseTo(1.506, 12);
  expect(cost.cache_read / cost.input).toBeCloseTo(0.02, 12);
  expect(cost.cache_write).toBe(0);
  expect(job(workflow, "activation")).toContain("/tmp/gh-aw/models.json");
  const proxyPricing = JSON.stringify(raw.providers).replaceAll('"', '\\"');
  for (const name of ["agent", "detection"]) {
    const phase = job(workflow, name);
    expect(phase).toContain(`${String.raw`\"providers\":`}${proxyPricing}`);
    expect(phase).toContain('export GH_AW_MODELS_JSON_PATH="/tmp/gh-aw/models.json"');
  }
});

it("exercises the same isolated repair bootstrap in CI, preparation, and publication", async () => {
  const workflow = await readFile(compiled, "utf8");
  const ci = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const setup = "uses: ./.github/actions/setup-repair-toolchain";
  expect(job(workflow, "agent")).toContain(setup);
  expect(job(workflow, "commit_repair")).toContain(setup);
  const smoke = job(ci, "repair-toolchain");
  expect(smoke).toContain("VP_HOME: /tmp/kmodels-vite-plus");
  expect(smoke).toContain(setup);
  expect(smoke.indexOf("vp env doctor")).toBeGreaterThan(smoke.indexOf(setup));
  expect(smoke).not.toContain("COPILOT_GITHUB_TOKEN");
});

function job(workflow: string, name: string): string {
  const body = workflow.match(new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  \\w+:\\n|$)`))?.[1];
  if (body === undefined) throw new Error(`Missing workflow job: ${name}`);
  return body;
}

it("loads completed refresh evidence before selecting repair work", async () => {
  const workflow = await readFile(compiled, "utf8");
  const agent = job(workflow, "agent");
  expect(agent).toContain("actions: read");
  expect(agent.indexOf("scripts/catalog-repair-evidence.ts")).toBeGreaterThan(0);
  expect(agent.indexOf("scripts/catalog-repair-evidence.ts")).toBeLessThan(
    agent.indexOf("Check whether repair work is needed"),
  );
  expect(agent).toContain("id: repair_context");
  expect(agent).toContain('scripts/catalog-repair.ts --github-output "$GITHUB_OUTPUT"');
  expect(agent).toContain("REPAIR_REQUIRED: ${{ steps.repair_context.outputs.repairable }}");
});

it("reserves execution time for validation retries and skips outcome capture after engine failure", async () => {
  const workflow = await readFile(compiled, "utf8");
  const agent = job(workflow, "agent");
  expect(agent).toMatch(/^    timeout-minutes: 60$/m);
  const execution = agent.match(
    /- name: Execute GitHub Copilot CLI\n([\s\S]*?)(?=\n      - )/,
  )?.[1];
  expect(execution).toBeDefined();
  expect(execution).toMatch(/^        timeout-minutes: 45$/m);
  const capture = agent.split(/\n      - /).find((step) => step.includes("id: repair_outcome\n"));
  expect(capture).toBeDefined();
  expect(capture).toContain("if: success()");
});

it("checks candidate coverage using trusted code before admitting an outcome and retains failed investigations", async () => {
  const workflow = await readFile(compiled, "utf8");
  const agent = job(workflow, "agent");
  expect(agent).toContain(
    "KMODELS_REPAIR_ADMISSION: ${{ runner.temp }}/gh-aw/repair-admission.json",
  );
  expect(agent).toContain('git show "$REPAIR_BASE_SHA:scripts/catalog-repair-review.ts"');
  const steps = agent.split(/\n      - /);
  const review = steps.find((step) =>
    step.includes("name: Check investigation completion evidence\n"),
  );
  expect(review).toContain("if: success() && steps.repair_context.outputs.repairable == 'true'");
  expect(review).toContain('catalog-repair-review.ts" terminal');
  expect(agent.indexOf("Check investigation completion evidence")).toBeLessThan(
    agent.indexOf("Capture and admit the repair outcome"),
  );
  const artifact = steps.find((step) => step.includes("name: Preserve investigation evidence\n"));
  expect(artifact).toContain("if: always() && steps.repair_context.outputs.repairable == 'true'");
  expect(artifact).toContain("/tmp/gh-aw/agent/");
  expect(artifact).toContain("${{ runner.temp }}/gh-aw/repair-admission.json");
});

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
  expect(agent).toContain('catalog-repair-publication.ts" validate');
  expect(commit).toContain('catalog-repair-publication.ts" validate');
  expect(agent.indexOf("Check repair infrastructure before inference")).toBeLessThan(
    agent.indexOf("Execute GitHub Copilot CLI"),
  );
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
  expect(commit).toContain('catalog-repair-publication.ts" retry-apply');
  expect(commit).toContain("${{ steps.retry_repair.outputs.tree_sha }}");
  expect(commit.match(/REPAIR_RETRY_ON_RACE:/g)).toHaveLength(1);
  const retry = commit.slice(commit.indexOf("- name: Reapply after a concurrent main update"));
  expect(retry.indexOf('catalog-repair-publication.ts" validate')).toBeLessThan(
    retry.indexOf('catalog-repair-publication.ts" commit'),
  );
  expect(retry.indexOf('catalog-repair-publication.ts" commit')).toBeLessThan(
    retry.indexOf('catalog-repair-publication.ts" push'),
  );
  expect(retry.slice(0, retry.indexOf("- name: Publish the revalidated repair"))).not.toContain(
    "GH_TOKEN",
  );
  expect(commit).toContain("gh workflow run void-deploy.yml --ref main");
  expect(agent).not.toMatch(/^\s+(?:contents|actions): write$/m);
  expect(publish).toContain("needs.agent.result == 'success'");
  expect(delivery).toContain("always() && needs.agent.result == 'success'");
  expect(delivery).toContain("${{ needs.safe_outputs.result }}");
  expect(delivery).toContain("${{ needs.commit_repair.result }}");
  expect(delivery).toContain("${{ needs.agent.outputs.output_types }}");
  expect(agent).toContain("output_types: ${{ steps.collect_output.outputs.output_types }}");
});
