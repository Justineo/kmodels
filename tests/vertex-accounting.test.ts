import { readFile } from "node:fs/promises";
import { expect, it } from "vite-plus/test";
import { extractVertexPricingInputs } from "../src/catalog/vertex-accounting.ts";
import { reviewedPublicSource } from "../src/catalog/public-evidence.ts";

it("recovers Veo request fields from the linked parameter type without inventing result fields", async () => {
  const source = reviewedPublicSource("vertex-pricing");
  const document = source.linkedDocuments?.documents?.find(({ id }) => id === "video-api");
  if (document === undefined) throw new Error("Missing Veo companion");
  expect(document.url).toBe(
    "https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/rest/Shared.Types/VideoGenerationModelParams",
  );
  const body = await readFile(
    new URL("./fixtures/vertex/accounting-video-parameters.html", import.meta.url),
    "utf8",
  );
  const facts = extractVertexPricingInputs([{ url: document.url, body }], source.id);
  expect(
    facts.filter(({ key }) => key.startsWith("video.")).map(({ key, locator }) => [key, locator]),
  ).toEqual([
    [
      "video.request.duration_seconds",
      { kind: "json_pointer", value: "/parameters/durationSeconds" },
    ],
    ["video.request.generate_audio", { kind: "json_pointer", value: "/parameters/generateAudio" }],
    ["video.request.resolution", { kind: "json_pointer", value: "/parameters/resolution" }],
    ["video.request.videos", { kind: "json_pointer", value: "/parameters/sampleCount" }],
  ]);
  const partial = extractVertexPricingInputs(
    [{ url: document.url, body: body.replaceAll("generateAudio", "unreviewedAudio") }],
    source.id,
  );
  expect(partial.filter(({ key }) => key.startsWith("video.")).map(({ key }) => key)).toEqual([
    "video.request.duration_seconds",
    "video.request.resolution",
    "video.request.videos",
  ]);
});
