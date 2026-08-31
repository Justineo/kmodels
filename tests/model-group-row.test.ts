import { load } from "cheerio";
import { describe, expect, it } from "vite-plus/test";
import type { ModelGroup } from "../src/catalog/model-groups.ts";
import type { WebsiteModel } from "../src/catalog/website-schema.ts";
import ModelGroupRow from "../src/components/ModelGroupRow.vue";
import { renderComponent } from "./render-component.ts";

function price(amount: string, accessibleText: string) {
  return { amount, accessibleText, displayUnit: "1M tokens" };
}

const sharedCachePrice = price("$0.50", "cache_read: USD 0.50 per 1M tokens");

const models = [
  {
    provider_id: "example",
    model_id: "model-a",
    uid: "example/model-a@1",
    version: "1",
    name: "Model A One",
    aliases: [],
    tasks: ["text_generation"],
    release_date: "2026-01-01",
    status: "active",
    release_stage: "stable",
    context_tokens: 128_000,
    detail_chunk: 0,
    pricing: {
      outcome: "offers",
      input: price("$1", "input: USD 1 per 1M tokens"),
      cache: sharedCachePrice,
      output: price("$2", "output: USD 2 per 1M tokens"),
    },
  },
  {
    provider_id: "example",
    model_id: "model-a",
    uid: "example/model-a@2",
    version: "2",
    name: "Model A Two",
    aliases: [],
    tasks: ["image_generation"],
    release_date: "2026-02-02",
    status: "deprecated",
    release_stage: "unknown",
    context_tokens: 256_000,
    detail_chunk: 0,
    pricing: {
      outcome: "offers",
      input: price("$1.50", "input: USD 1.50 per 1M tokens"),
      cache: sharedCachePrice,
      output: price("$3", "output: USD 3 per 1M tokens"),
    },
  },
] satisfies WebsiteModel[];

const group = {
  key: '["example","model-a"]',
  provider_id: "example",
  model_id: "model-a",
  models,
} satisfies ModelGroup<WebsiteModel>;

async function renderGroupRow(
  value: ModelGroup<WebsiteModel> = group,
): Promise<ReturnType<typeof load>> {
  const html = await renderComponent(ModelGroupRow, {
    group: value,
    modelName: "Model A One",
    providerName: "Example",
    rowIndex: 2,
    alternate: false,
    expanded: false,
  });
  return load(html, undefined, false);
}

describe("model group row", () => {
  it("makes the version-count badge an expansion control", async () => {
    const $ = await renderGroupRow();
    const badge = $(".version-count-badge");

    expect(badge.is("button")).toBe(true);
    expect(badge.attr("aria-expanded")).toBe("false");
    expect(badge.attr("aria-label")).toBe("Expand model-a, 2 versions");
    expect(badge.text().trim()).toBe("2 versions");
  });

  it("uses tooltip-backed expansion controls for every non-identity varying field", async () => {
    const $ = await renderGroupRow();
    const variesActions = $(".group-varies-trigger");

    expect(variesActions).toHaveLength(6);
    expect(variesActions.filter("[aria-expanded='false']")).toHaveLength(6);
    expect($("button.model-identity strong").text()).toBe("Model A One");
    expect($("button.model-identity").text()).not.toContain("Varies");
    expect($(".cached-col").text()).toContain("$0.50");
    expect($(".cached-col").text()).not.toContain("Varies");
    expect($("[aria-label*='Name varies by version']")).toHaveLength(0);
    expect($("[aria-label*='Tasks vary by version']")).toHaveLength(1);
    expect($("[aria-label*='Status varies by version']")).toHaveLength(1);
    expect($("[aria-label*='Context varies by version']")).toHaveLength(1);
    expect($("[aria-label*='Input price varies by version']")).toHaveLength(1);
    expect($("[aria-label*='Output price varies by version']")).toHaveLength(1);
    expect($("[aria-label*='Release date varies by version']")).toHaveLength(1);
  });

  it("makes a varying group-wide pricing status a tooltip-backed expansion control", async () => {
    const statusModels = models.map(
      (model, index): WebsiteModel => ({
        ...model,
        pricing: {
          outcome: index === 0 ? "offers" : "unknown",
          status:
            index === 0
              ? { label: "Free", description: "The provider publishes this offer as free." }
              : { label: "Unknown", description: "No published pricing was found." },
        },
      }),
    );
    const $ = await renderGroupRow({ ...group, models: statusModels });
    const pricingStatus = $(".price-status-cell .group-varies-trigger");

    expect($(".price-status-cell").attr("colspan")).toBe("3");
    expect(pricingStatus.is("button")).toBe(true);
    expect(pricingStatus.attr("aria-expanded")).toBe("false");
    expect(pricingStatus.attr("aria-label")).toContain("Pricing status varies by version");
    expect(pricingStatus.attr("aria-label")).toContain("Free");
    expect(pricingStatus.attr("aria-label")).toContain("Unknown");
  });

  it("discloses when only some versions publish a representative rate", async () => {
    const partialModels = models.map(
      (model, index): WebsiteModel =>
        index === 0
          ? model
          : {
              ...model,
              pricing: { outcome: "unknown" },
            },
    );
    const $ = await renderGroupRow({ ...group, models: partialModels });
    const inputPrice = $(".input-col .group-varies-trigger");

    expect($(".price-status-cell")).toHaveLength(0);
    expect(inputPrice.attr("aria-label")).toContain("input: USD 1 per 1M tokens");
    expect(inputPrice.attr("aria-label")).toContain("Not published");
  });
});
