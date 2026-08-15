import { createSSRApp, type Component } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vite-plus/test";
import ModelDetails from "../src/components/ModelDetails.vue";
import type { WebsiteModel, WebsiteModelDetail } from "../src/catalog/website-schema.ts";
import { unknownCapabilities } from "../src/catalog/schema.ts";

function ssrComponent(value: unknown): Component {
  if (typeof value !== "object" || value === null || !("ssrRender" in value))
    throw new Error("Vapor component is missing its SSR renderer");
  return value;
}

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

    const html = await renderToString(
      createSSRApp(ssrComponent(ModelDetails), {
        model,
        providerName: "Test Provider",
        detail,
        loading: false,
        error: undefined,
        pricingTarget: undefined,
      }),
    );
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
