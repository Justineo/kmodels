import { createSSRApp, type Component } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vite-plus/test";
import ModelPriceCell from "../src/components/ModelPriceCell.vue";

function ssrComponent(value: unknown): Component {
  if (typeof value !== "object" || value === null || !("ssrRender" in value))
    throw new Error("Vapor component is missing its SSR renderer");
  return value;
}

describe("model price cell", () => {
  it("shows complete exact prices without a tooltip", async () => {
    const html = await renderToString(
      createSSRApp(ssrComponent(ModelPriceCell), {
        price: {
          amount: "$0.08",
          displayUnit: "video",
          accessibleText: "video_generation: USD 0.08 per video",
          showTooltip: true,
        },
      }),
    );

    expect(html).toContain('aria-label="video_generation: USD 0.08 per video"');
    expect(html).toContain("$0.08");
    expect(html).toContain("/ video");
    expect(html).not.toContain("ui-tooltip-trigger");
    expect(html).not.toContain('tabindex="0"');
  });
});
