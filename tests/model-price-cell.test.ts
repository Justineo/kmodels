import { describe, expect, it } from "vite-plus/test";
import ModelPriceCell from "../src/components/ModelPriceCell.vue";
import { renderComponent } from "./render-component.ts";

describe("model price cell", () => {
  it("shows complete exact prices without a tooltip", async () => {
    const html = await renderComponent(ModelPriceCell, {
      price: {
        amount: "$0.08",
        displayUnit: "video",
        accessibleText: "video_generation: USD 0.08 per video",
        showTooltip: true,
      },
    });

    expect(html).toContain('aria-label="video_generation: USD 0.08 per video"');
    expect(html).toContain("$0.08");
    expect(html).toContain("/ video");
    expect(html).not.toContain("ui-tooltip-trigger");
    expect(html).not.toContain('tabindex="0"');
  });
});
