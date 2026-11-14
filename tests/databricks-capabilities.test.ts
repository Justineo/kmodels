import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { parseSource } from "../src/catalog/adapters.ts";
import { manifests } from "../src/catalog/manifests.ts";
import type { SourceContractEvidence } from "../src/catalog/source-contract.ts";
import { databricksInferenceFixture } from "./databricks-inference-fixture.ts";
const manifest = manifests.find((m) => m.provider.id === "databricks");
const catalog = manifest?.sources.find((s) => s.id === "databricks-models");
const api = manifest?.sources.find((s) => s.id === "databricks-api");
const observedAt = "2026-11-14T00:00:00.000Z";
const guide = await readFile(
  new URL("./fixtures/databricks-function-calling.html", import.meta.url),
  "utf8",
);
const native = z
  .object({
    endpoints: z.array(
      z.object({
        name: z.string(),
        task: z.string(),
        endpoint_type: z.string(),
        capabilities: z.record(z.string(), z.unknown()),
      }),
    ),
  })
  .parse(
    JSON.parse(
      await readFile(new URL("./fixtures/databricks-capabilities.json", import.meta.url), "utf8"),
    ),
  );
async function publicModels(body = guide, findings: SourceContractEvidence[] = []) {
  if (!manifest || !catalog) throw new Error("Missing catalog source");
  const bundle = await databricksInferenceFixture();
  bundle.documents.push({
    url: "https://docs.databricks.com/aws/en/machine-learning/model-serving/function-calling",
    body,
  });
  return parseSource({
    provider: { ...manifest.provider, source_ids: [catalog.id] },
    source: catalog,
    observedAt,
    body: JSON.stringify(bundle),
    onContractFinding: (f) => findings.push(f),
  });
}
function inventory(endpoints: unknown, findings: SourceContractEvidence[] = []) {
  if (!manifest || !api) throw new Error("Missing API source");
  return parseSource({
    provider: { ...manifest.provider, source_ids: [api.id] },
    source: api,
    observedAt,
    body: JSON.stringify({ endpoints }),
    onContractFinding: (f) => findings.push(f),
  });
}
describe("Databricks first-party capabilities", () => {
  it("reads exact model-launch entries without treating other feature dates as releases", async () => {
    if (!manifest || !catalog) throw new Error("Missing source");
    const body = await readFile(
      new URL("./fixtures/databricks-unity-releases.html", import.meta.url),
      "utf8",
    );
    const bundle = await databricksInferenceFixture();
    const parse = (release: string) =>
      parseSource({
        provider: { ...manifest.provider, source_ids: [catalog.id] },
        source: catalog,
        observedAt,
        body: JSON.stringify({
          ...bundle,
          documents: [
            ...bundle.documents,
            {
              url: "https://docs.databricks.com/aws/en/release-notes/unity-gateway/",
              body: release,
            },
          ],
        }),
      });
    const good = parse(body);
    expect(good.models.find((m) => m.model_id === "databricks-gpt-6-1-sol")?.release_date).toBe(
      "2026-09-29",
    );
    expect(good.models.find((m) => m.model_id === "databricks-gpt-6-1-terra")?.release_date).toBe(
      "2026-10-27",
    );
    const unrelated = parse(
      body.replaceAll("is now available on Unity Gateway", "supports a new optional feature"),
    );
    expect(
      unrelated.models.find((m) => m.model_id === "databricks-gpt-6-1-sol")?.release_date,
    ).toBeUndefined();
  });
  it("uses only the owned Foundation Model API support rows", async () => {
    const parsed = await publicModels();
    expect(parsed.models).toHaveLength(69);
    for (const id of ["databricks-gpt-6-astra", "databricks-gemma-3-12b"])
      expect(parsed.models.find((m) => m.model_id === id)?.capabilities.tool_call, id).toBe(true);
    expect(parsed.models.some((m) => m.model_id === "gpt-4o")).toBe(false);
    const modified = await publicModels(
      guide.replaceAll(
        "Supported on pay-per-token endpoints.",
        "Supported on provisioned throughput endpoints.",
      ),
    );
    expect(
      modified.models.find((m) => m.model_id === "databricks-gpt-6-astra")?.capabilities.tool_call,
    ).toBe("unknown");
  });
  it.each(["consistent", "conflicting"])(
    "handles %s expanded-view table copies",
    async (change) => {
      const table = guide.match(/<table>[\s\S]*?<\/table>/)?.[0];
      if (!table) throw new Error("Missing native support table");
      const copy =
        change === "consistent" ? table : table.replaceAll("GPT-6 Astra", "Unlisted model");
      const findings: SourceContractEvidence[] = [];
      const parsed = await publicModels(guide.replace("</table>", `</table>${copy}`), findings);
      expect(
        parsed.models.find((m) => m.model_id === "databricks-gpt-6-astra")?.capabilities.tool_call,
      ).toBe(change === "consistent" ? true : "unknown");
      expect(findings.length).toBe(change === "consistent" ? 0 : 1);
    },
  );
  it("isolates an unowned support table from identity and prices", async () => {
    const findings: SourceContractEvidence[] = [];
    const parsed = await publicModels(
      guide.replace("supported-models", "unowned-models"),
      findings,
    );
    expect(parsed.models).toHaveLength(69);
    expect(
      parsed.models.find((m) => m.model_id === "databricks-gpt-6-astra")?.capabilities.tool_call,
    ).toBe("unknown");
    expect(parsed.models.flatMap((m) => m.price_facts).length).toBeGreaterThan(900);
    expect(findings).toHaveLength(1);
  });
  it("projects reviewed positive API flags without retaining account metadata", () => {
    const parsed = inventory(
      native.endpoints.map((e) => ({
        ...e,
        creator: "PRIVATE_CREATOR",
        config: { token: "PRIVATE_TOKEN" },
      })),
    );
    expect(parsed.models[0]).toMatchObject({
      capabilities: { tool_call: true },
      modalities: { input: ["text", "image"], output: ["text"] },
      scope: "runtime_observation",
      limits: {},
    });
    expect(JSON.stringify(parsed)).not.toContain("PRIVATE_");
    expect(parsed.commercial_facts).toBeUndefined();
  });
  it.each(["missing type", "custom endpoint", "false flags", "malformed container"])(
    "withholds unsupported API capability claims: %s",
    (change) => {
      const row = native.endpoints[0];
      if (!row) throw new Error("Missing native endpoint");
      const endpoint = {
        ...row,
        endpoint_type:
          change === "missing type"
            ? undefined
            : change === "custom endpoint"
              ? "CUSTOM_MODEL"
              : row.endpoint_type,
        capabilities:
          change === "false flags"
            ? { function_calling: false, image_input: false, image_output: false }
            : change === "malformed container"
              ? "invalid"
              : row.capabilities,
      };
      const parsed = inventory([endpoint]);
      expect(parsed.models[0]).toMatchObject({
        tasks: ["text_generation"],
        capabilities: { tool_call: "unknown" },
        modalities: { input: ["text"], output: ["text"] },
      });
    },
  );
  it("withholds a malformed capability while preserving a known image flag", () => {
    const row = native.endpoints[0];
    if (!row) throw new Error("Missing native endpoint");
    const findings: SourceContractEvidence[] = [];
    const parsed = inventory(
      [{ ...row, capabilities: { ...row.capabilities, function_calling: "enabled" } }],
      findings,
    );
    expect(parsed.models[0]).toMatchObject({
      capabilities: { tool_call: "unknown" },
      modalities: { input: ["text", "image"] },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.diagnostics[0]?.path).toBe("/endpoints/0/capabilities/function_calling");
  });
});
