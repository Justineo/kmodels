import { expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { manifests } from "../src/catalog/manifests.ts";
import type { SourceContractEvidence } from "../src/catalog/source-contract.ts";

const manifest = manifests.find(({ provider }) => provider.id === "cohere");
const source = manifest?.sources.find(({ id }) => id === "cohere-api");
if (!manifest || !source) throw new Error("Missing Cohere API source");
const provider = { ...manifest.provider, source_ids: [source.id] };
function parse(features: unknown) {
  if (!source) throw new Error("Missing API source");
  const findings: SourceContractEvidence[] = [];
  const models = parseSource({
    provider,
    source,
    observedAt: "2026-11-15T00:00:00.000Z",
    body: JSON.stringify({
      models: [
        { name: "command-a-plus-05-2026", endpoints: ["chat"], context_length: 256000, features },
      ],
    }),
    onContractFinding: (finding) => findings.push(finding),
  }).models;
  const model = models[0];
  if (!model) throw new Error("Missing model");
  return { model, findings };
}

it("reads positive native features independently from price and endpoint metadata", () => {
  const { model, findings } = parse([
    "logprobs",
    "json_mode",
    "json_schema",
    "strict_tools",
    "safety_modes",
    "tools",
    "reasoning",
    "vision",
    "tool_images",
    "citations",
  ]);
  expect(model.capabilities).toMatchObject({
    tool_call: true,
    structured_output: true,
    reasoning: true,
    citations: true,
    streaming: "unknown",
    batch: "unknown",
  });
  expect(model.modalities).toEqual({ input: ["image"], output: [] });
  expect(model.limits).toEqual({ context_tokens: 256000 });
  expect(model.price_facts).toEqual([]);
  expect(findings).toEqual([]);
});

it.each([undefined, null, [], ["future_feature"]])(
  "does not infer unsupported capabilities from feature omission (%s)",
  (features) => {
    const { model, findings } = parse(features);
    expect(model.capabilities.tool_call).toBe("unknown");
    expect(model.capabilities.structured_output).toBe("unknown");
    expect(model.capabilities.reasoning).toBe("unknown");
    expect(model.modalities.input).toEqual([]);
    expect(model.limits.context_tokens).toBe(256000);
    expect(findings).toEqual([]);
  },
);

it("isolates malformed feature values and retains valid positive siblings", () => {
  const mixed = parse(["tools", 42, "citations"]);
  expect(mixed.model.capabilities).toMatchObject({ tool_call: true, citations: true });
  expect(mixed.findings).toHaveLength(1);
  const malformed = parse({ tools: true });
  expect(malformed.model.capabilities.tool_call).toBe("unknown");
  expect(malformed.model.tasks).toEqual(["text_generation"]);
  expect(malformed.model.limits.context_tokens).toBe(256000);
  expect(malformed.findings).toHaveLength(1);
});
