import { describe, expect, it } from "vite-plus/test";
import ModelDetails from "../src/components/ModelDetails.vue";
import type { WebsiteModel, WebsiteModelDetail } from "../src/catalog/website-schema.ts";
import { unknownCapabilities } from "../src/catalog/schema.ts";
import { renderComponent } from "./render-component.ts";
import type { LimitDetailGroup } from "../src/catalog/model-limit-details.ts";

describe("model details", () => {
  it("renders qualified limits, scope, evidence and conflicts without choosing a request maximum", async () => {
    const model: WebsiteModel = {
      provider_id: "test",
      model_id: "model",
      name: "Model",
      uid: "test/model",
      aliases: [],
      tasks: [],
      status: "active",
      release_stage: "stable",
      detail_chunk: 0,
      context_tokens: 1048576,
      pricing: { outcome: "unknown" },
    };
    const scope =
      "Responses API visible text only; requires beta header. <img src=x onerror=alert(1)>";
    const groups: LimitDetailGroup[] = [
      {
        source_ref: "test-models",
        claim: "output",
        statements: [
          {
            quantity: "output_tokens",
            kind: "maximum",
            tokens: 300000,
            measurement: "per_response",
            scope,
          },
          {
            quantity: "output_tokens",
            kind: "no_separate_cap",
            measurement: "per_response",
            scope,
          },
          {
            quantity: "output_tokens",
            kind: "default",
            tokens: 65536,
            measurement: "per_interaction",
            scope: "Thinking and visible output when max_output_tokens is absent.",
          },
          {
            quantity: "output_tokens",
            kind: "maximum",
            tokens: 32768,
            measurement: "per_hop",
            scope: "Non-streaming foreground hop; not the interaction ceiling.",
          },
          {
            quantity: "context_tokens",
            kind: "maximum",
            tokens: 1048576,
            measurement: "shared_context",
            scope: "Input and output share one budget; not a separate output grant.",
          },
        ],
        evidence: [
          {
            document_url: "https://example.com/limits",
            locator: "At a glance / output",
            observed_at: "2026-11-17T12:00:00.000Z",
            content_hash: "a".repeat(64),
            excerpt: "Native output evidence <script>alert(1)</script>",
          },
        ],
      },
    ];
    const detail: WebsiteModelDetail = {
      model_ref: model.uid,
      modalities: { input: [], output: [] },
      capabilities: unknownCapabilities(),
      scope: "global_catalog",
      max_output_tokens: 131072,
      limit_details: groups,
    };
    const props = {
      model,
      providerName: "Test",
      provider: undefined,
      dataVersion: "a".repeat(64),
      detail,
      loading: false,
      error: undefined,
      pricingTarget: undefined,
    };
    const html = await renderComponent(ModelDetails, props);
    expect(html).toContain("Qualified limits");
    expect(html).toContain("Output (catalog summary)");
    expect(html).toContain("Context window (catalog summary)");
    expect(html).toContain("Maximum: 300,000 tokens");
    expect(html).toContain("Default: 65,536 tokens");
    expect(html).toContain("No separate provider output cap");
    expect(html).toContain("Per hop");
    expect(html).toContain("Per interaction");
    expect(html).toContain("Shared context budget");
    expect(html).not.toContain("Combined input, thinking and output budget");
    expect(html).toContain("Input and output share one budget; not a separate output grant.");
    expect(html).toContain("Unresolved source conflict");
    expect(html.indexOf("requires beta header")).toBeLessThan(html.indexOf("Source evidence"));
    expect(html).toContain('href="https://example.com/limits"');
    expect(html).toContain("2026-11-17T12:00:00.000Z");
    expect(html).toContain("At a glance / output");
    expect(html).toContain("a".repeat(64));
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("Unlimited");
    const { limit_details: _groups, ...legacyDetail } = detail;
    const legacy = await renderComponent(ModelDetails, { ...props, detail: legacyDetail });
    expect(legacy).toContain("Maximum output");
    expect(legacy).not.toContain("Qualified limits");
    expect(legacy).not.toContain("catalog summary");
  });
  it("keeps lifecycle and catalog scope in the content", async () => {
    const model = {
      provider_id: "test",
      model_id: "model",
      name: "Model",
      aliases: ["model-latest"],
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
      deployment_availability: [{ deployment_type: "batch", regions: ["east", "west"] }],
    } satisfies WebsiteModelDetail;

    const html = await renderComponent(ModelDetails, {
      model,
      providerName: "Test Provider",
      provider: {
        id: "test",
        name: "Test Provider",
        pricing_coverage: {
          representative_models: 0,
          offer_models: 1,
          unknown_models: 0,
          not_applicable_models: 0,
          standalone_resources: 2,
          detail_chunks: 1,
        },
      },
      dataVersion: "a".repeat(64),
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
    expect(content).toContain("Other charges &amp; services");
    expect(content).not.toContain("Test Provider services");
    expect(content).not.toContain("provider-services");

    expect(header).not.toContain("active");
    expect(header).not.toContain("regional catalog");
    expect(content).toContain('<div class="status-line"');
    expect(content).toContain("active");
    expect(content).toContain("regional catalog");
    expect(header).not.toContain(">Catalog ID<");
    expect(header).toContain("<code>model</code>");
    expect(header).toContain("Copy catalog ID model");
    expect(header).toContain("#ui-copy");
    expect(content).toContain('<details class="detail-section detail-disclosure"');
    expect(content).not.toContain("Catalog aliases");
    expect(content).not.toContain("model-latest");
    expect(content).toContain("Availability details");
    expect(content).toContain("2 observed deployments");
    expect(content).toContain("2 regions · 1 deployment type");
    expect(content).toContain("Batch");
    expect(content).toContain("east, west");
    expect(content).toContain("A region not listed here may still be available");
  });
});
