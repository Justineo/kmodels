import { describe, expect, it } from "vite-plus/test";
import ModelDetails from "../src/components/ModelDetails.vue";
import type { WebsiteModel, WebsiteModelDetail } from "../src/catalog/website-schema.ts";
import { unknownCapabilities } from "../src/catalog/schema.ts";
import { renderComponent } from "./render-component.ts";

describe("model details", () => {
  it("keeps lifecycle and catalog scope in the content", async () => {
    const model = {
      provider_id: "test",
      model_id: "model",
      name: "Model",
      tasks: [],
      status: "active",
      release_stage: "unknown",
      detail_chunk: 0,
      uid: "test/model",
      pricing: { outcome: "offers" },
    } satisfies WebsiteModel;
    const detail = {
      model_ref: model.uid,
      modalities: { input: [], output: [] },
      capabilities: unknownCapabilities(),
      scope: "regional_catalog",
    } satisfies WebsiteModelDetail;

    const html = await renderComponent(ModelDetails, {
      model,
      providerName: "Test Provider",
      detail,
      loading: false,
      error: undefined,
      pricingTarget: undefined,
    });
    const header = html.slice(
      html.indexOf('<header class="details-header"'),
      html.indexOf("</header>"),
    );
    const content = html.slice(html.indexOf('<div class="details-content"'));

    expect(header).not.toContain("active");
    expect(header).not.toContain("regional catalog");
    expect(content).toContain('<div class="status-line"');
    expect(content).toContain("active");
    expect(content).toContain("regional catalog");
  });
});
