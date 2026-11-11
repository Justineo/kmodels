import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { extractVertexPricingInputs } from "../src/catalog/vertex-accounting.ts";
import type { PricingReconciliationItem } from "../src/catalog/pricing-reconciliation.ts";
import { reviewedPublicSource } from "../src/catalog/public-evidence.ts";

const discoveryUrl = "https://aiplatform.googleapis.com/$discovery/rest?version=v1beta1";
const responsesUrl =
  "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/grok/responses";

async function discoverySource(
  mutate: (schemas: Record<string, { properties: Record<string, unknown> }>) => void = () => {},
): Promise<{ url: string; body: string }> {
  const fixture = JSON.parse(
    await readFile(new URL("./fixtures/vertex/discovery.json", import.meta.url), "utf8"),
  ) as { schemas: Record<string, { properties: Record<string, unknown> }> };
  mutate(fixture.schemas);
  return { url: discoveryUrl, body: JSON.stringify(fixture) };
}

function inputs(documents: readonly { url: string; body: string }[]) {
  const reconciliation: PricingReconciliationItem[] = [];
  const facts = extractVertexPricingInputs(
    documents,
    reviewedPublicSource("vertex-pricing").id,
    undefined,
    (item) => reconciliation.push(item),
  );
  return { facts, reconciliation };
}

function expectedOf(reconciliation: readonly PricingReconciliationItem[]): number {
  const sample = reconciliation.find(({ sample }) =>
    sample?.includes("Agent Platform pricing inputs"),
  )?.sample;
  const denominator = sample?.split("/")[1]?.split(" ")[0];
  if (denominator === undefined) throw new Error("Missing pricing-input reconciliation");
  return Number(denominator);
}

describe("Agent Platform pricing-input document contracts", () => {
  it("binds grounding results to the current GroundingChunk detail schemas", async () => {
    const current = inputs([await discoverySource()]).facts;
    const unique = new Map<string, string>();
    for (const { key, locator } of current)
      if (key.startsWith("generate.grounding.") && !unique.has(key)) unique.set(key, locator.value);
    expect([...unique].sort(([left], [right]) => left.localeCompare(right))).toEqual([
      [
        "generate.grounding.agent_search_result",
        "GenerateContentResponse.candidates[*].groundingMetadata.groundingChunks[*].retrievedContext.uri",
      ],
      [
        "generate.grounding.google_image_search_queries",
        "GenerateContentResponse.candidates[*].groundingMetadata.imageSearchQueries[*]",
      ],
      [
        "generate.grounding.google_maps_result",
        "GenerateContentResponse.candidates[*].groundingMetadata.groundingChunks[*].maps.placeId",
      ],
      [
        "generate.grounding.google_search_queries",
        "GenerateContentResponse.candidates[*].groundingMetadata.webSearchQueries[*]",
      ],
      [
        "generate.grounding.google_search_result",
        "GenerateContentResponse.candidates[*].groundingMetadata.groundingChunks[*].web.uri",
      ],
    ]);

    const retiredSiblings = inputs([
      await discoverySource((schemas) => {
        for (const name of ["Web", "Maps", "RetrievedContext"]) {
          schemas[`GoogleCloudAiplatformV1beta1${name}`] = schemas[
            `GoogleCloudAiplatformV1beta1GroundingChunk${name}`
          ] ?? { properties: {} };
          delete schemas[`GoogleCloudAiplatformV1beta1GroundingChunk${name}`];
        }
      }),
    ]);
    expect(retiredSiblings.facts.filter(({ key }) => key.endsWith("_result"))).toEqual([]);
  });

  it("reads the documented video result field from the discovery response schema", async () => {
    const documented = inputs([await discoverySource()]).facts;
    expect(documented.find(({ key }) => key === "video.result.videos")).toEqual(
      expect.objectContaining({
        channel: "result",
        locator: { kind: "provider_field", value: "GenerateVideoResponse.videos[*]" },
        reduction: { kind: "array_length" },
        absent_value: "zero",
      }),
    );

    const undocumented = inputs([
      await discoverySource((schemas) => {
        delete schemas.GoogleCloudAiplatformV1beta1GenerateVideoResponse;
      }),
    ]);
    expect(undocumented.facts.some(({ key }) => key === "video.result.videos")).toBe(false);
    expect(expectedOf(undocumented.reconciliation)).toBe(
      expectedOf(inputs([await discoverySource()]).reconciliation) - 1,
    );
  });

  it("shrinks the documented contract when a streaming usage channel is withdrawn", async () => {
    const withStream = inputs([
      await discoverySource(),
      { url: responsesUrl, body: "ResponseCompletedEvent response.completed usage input_tokens" },
    ]);
    const withoutStream = inputs([
      await discoverySource(),
      { url: responsesUrl, body: "response.output_text.delta usage input_tokens" },
    ]);
    const streamed = withStream.facts.filter(({ key }) => key.startsWith("responses."));
    const plain = withoutStream.facts.filter(({ key }) => key.startsWith("responses."));
    expect(streamed.map(({ channel }) => channel)).toContain("stream_event");
    expect(plain.map(({ channel }) => channel)).not.toContain("stream_event");
    expect(expectedOf(withStream.reconciliation) - expectedOf(withoutStream.reconciliation)).toBe(
      7,
    );
  });
});
