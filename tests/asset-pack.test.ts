import { describe, expect, it } from "vite-plus/test";
import { createAssetPack } from "../src/catalog/asset-pack.ts";
import { pricingLimits } from "../src/catalog/pricing-constants.ts";

const identity = "1".repeat(64);

describe("chunked canonical asset compression", () => {
  it.each(
    [
      [],
      ["", ""],
      ["start", "\ud83d", "", "\ude00", "€", "\ud800"],
      Array.from({ length: 80 }, (_, index) => `${index}:${"abc😀€".repeat(8_000)}`),
    ].map((sourceChunks) => ({ sourceChunks })),
  )(
    "preserves the exact encoded pack and manifest for chunked input %#",
    async ({ sourceChunks }) => {
      const whole = await createAssetPack("exports", identity, identity, [
        { fileName: "pricing/index.json", source: sourceChunks.join("") },
      ]);
      const streamed = await createAssetPack("exports", identity, identity, [
        { fileName: "pricing/index.json", sourceChunks },
      ]);
      expect(streamed).toEqual(whole);
    },
  );

  it("rejects cumulative decoded bytes across chunks and propagates stream failure", async () => {
    const chunk = "x".repeat(1_024 * 1_024);
    await expect(
      createAssetPack("ui", identity, identity, [
        {
          fileName: "ui/test.json",
          sourceChunks: [
            ...Array.from({ length: pricingLimits.coreInputBytes / chunk.length }, () => chunk),
            "x",
          ],
        },
      ]),
    ).rejects.toThrow("exceeds the decoded asset limit");
  });
});
