import { describe, expect, it } from "vite-plus/test";
import { load } from "cheerio";
import ModelDetails from "../src/components/ModelDetails.vue";
import ModelClaimEvidence from "../src/components/ModelClaimEvidence.vue";
import type { WebsiteModel, WebsiteModelDetail } from "../src/catalog/website-schema.ts";
import { unknownCapabilities } from "../src/catalog/schema.ts";
import { renderComponent } from "./render-component.ts";
import type { LimitDetailGroup } from "../src/catalog/model-limit-details.ts";
import type { CapabilityStatement } from "../src/catalog/model-capability-details.ts";

describe("model details", () => {
  const sourceOf = (document_url: string) => ({
    document_url,
    observed_at: "2026-11-17T00:00:00.000Z",
    locator: "Request options",
  });
  const effortOn = (
    endpoint: string,
    supported_values: string[],
    default_value?: string,
  ): CapabilityStatement => ({
    kind: "reasoning_effort",
    scope: `Example API <tag> ${endpoint}`,
    applicability: { interface: "Example API", endpoint },
    supported_values,
    ...(default_value === undefined ? {} : { default_value }),
  });
  const inspectorModel: WebsiteModel = {
    provider_id: "test",
    model_id: "model",
    name: "Model",
    uid: "test/model",
    aliases: [],
    tasks: [],
    status: "active",
    release_stage: "stable",
    detail_chunk: 0,
    pricing: { outcome: "unknown" },
  };
  function inspector(detail: Partial<WebsiteModelDetail>) {
    return renderComponent(ModelDetails, {
      model: inspectorModel,
      providerName: "Test",
      provider: undefined,
      dataVersion: "a".repeat(64),
      detail: {
        model_ref: inspectorModel.uid,
        modalities: { input: ["text", "image"], output: ["text"] },
        capabilities: unknownCapabilities(),
        scope: "global_catalog",
        api_endpoints: [
          { name: "Chat", path: "/chat" },
          { name: "Responses", path: "/responses" },
        ],
        ...detail,
      } satisfies WebsiteModelDetail,
      loading: false,
      error: undefined,
      pricingTarget: undefined,
    });
  }
  const texts = ($: ReturnType<typeof load>, selector: string) =>
    $(selector)
      .map((_, el) => $(el).text().trim())
      .get();

  it("lists supported capabilities with structured values and leaves unsupported ones out", async () => {
    const html = await inspector({
      capabilities: {
        ...unknownCapabilities(),
        tool_call: true,
        prompt_cache: true,
        fine_tuning: false,
        streaming: true,
      },
      delivery_modes: ["streaming"],
      capability_details: [
        {
          source_ref: "test-models",
          claim: "effort",
          statements: [
            effortOn("/chat", ["low", "high"], "high"),
            effortOn("/responses", ["low", "high"], "high"),
          ],
          evidence: [sourceOf("https://example.com/effort")],
        },
        {
          source_ref: "test-models",
          claim: "cache",
          statements: [{ kind: "prompt_cache", scope: "Example API", mode: "implicit" }],
          evidence: [sourceOf("https://example.com/cache")],
        },
      ],
    });
    const $ = load(html);
    expect(texts($, ".modality-flow > div:first-child .tag")).toEqual(["text", "image"]);
    expect(texts($, ".modality-flow > div:last-child .tag")).toEqual(["text"]);
    expect($(".fact-grid").text()).toContain("streaming");
    expect(texts($, ".capability-tags .tag")).toEqual(["Tool calling"]);
    expect(texts($, ".capability-details > div > dt")).toEqual([
      "Reasoning effort",
      "Prompt caching",
    ]);
    const effort = $(".capability-details > div").first();
    expect(texts($, ".capability-details > div:first-child .capability-value")).toEqual([
      "low",
      "high",
    ]);
    const defaultValue = effort.find("[data-default]");
    expect(defaultValue.text()).toBe("high");
    expect(defaultValue.attr("aria-label")).toBe("high (default)");
    expect(texts($, ".capability-details > div:last-child .capability-value")).toEqual([
      "automatic",
    ]);
    expect(effort.find(".claim-sources a").attr("href")).toBe("https://example.com/effort");
    expect(effort.find(".source-label")).toHaveLength(0);
    for (const hidden of ["Example API", "caller-defined", "Unsupported", "Fine-tuning", "Varies"])
      expect(html).not.toContain(hidden);
    expect($(".endpoint-capabilities")).toHaveLength(0);
    expect($(".conflict-mark")).toHaveLength(0);

    const empty = await inspector({ capability_details: [] });
    expect(empty).toContain("No capability information published");
    const loading = await renderComponent(ModelDetails, {
      model: inspectorModel,
      providerName: "Test",
      provider: undefined,
      dataVersion: "a".repeat(64),
      detail: undefined,
      loading: true,
      error: undefined,
      pricingTarget: undefined,
    });
    expect(loading).toContain("Loading details");
    expect(loading).not.toContain("No capability information published");
  });

  it("shows values that differ by API on their published endpoint", async () => {
    const $ = load(
      await inspector({
        capability_details: [
          {
            source_ref: "test-models",
            claim: "effort",
            statements: [
              effortOn("/chat", ["low", "high"], "high"),
              effortOn("/responses", ["none", "low", "high"], "none"),
            ],
            evidence: [sourceOf("https://example.com/effort")],
          },
          {
            source_ref: "test-models",
            claim: "disputed",
            statements: [effortOn("/chat", ["low", "high"], "low")],
            evidence: [sourceOf("https://example.com/other")],
          },
        ],
      }),
    );
    expect($(".capability-details .varies").text()).toBe("Varies by endpoint");
    expect($(".conflict-mark").attr("aria-label")).toBe("Sources disagree");
    const [chat, responses] = [0, 1].map((index) => $(".endpoint-list > li").eq(index));
    expect(chat?.find(".endpoint-capabilities dt").text()).toBe("Reasoning effort");
    expect(
      chat
        ?.find(".capability-value")
        .map((_, el) => $(el).text())
        .get(),
    ).toEqual(["low", "high"]);
    // The disputed /chat default stays unknown.
    expect(chat?.find("[data-default]")).toHaveLength(0);
    expect(responses?.find("[data-default]").text()).toBe("none");
  });
  it("cites each document once with its locators and latest check", async () => {
    const urls = [
      "https://models.example.net:8443/model",
      "https://models.example.net:8443/guide?q=api#limits",
      "http://docs.example.org/reference",
    ] as const;
    // Canonical evidence may still carry audit fields; the citation renders none of them.
    const documents = [...urls, urls[0]].map((document_url, index) => ({
      document_url,
      locator: `Section ${index + 1}`,
      excerpt: "Quoted evidence <script>alert(1)</script>",
      content_hash: "a".repeat(64),
      observed_at: `2026-11-1${index}T05:03:39.290Z`,
    }));
    const html = await renderComponent(ModelClaimEvidence, { documents });
    const $ = load(html);
    const links = $(".claim-sources a");
    expect(links.map((_, el) => $(el).attr("href")).get()).toEqual(urls);
    expect(
      links
        .find(".source-label")
        .map((_, el) => $(el).text())
        .get(),
    ).toEqual([
      "models.example.net:8443/model",
      "models.example.net:8443/guide",
      "docs.example.org",
    ]);
    expect(links.first().attr("aria-label")).toMatch(
      /^models\.example\.net:8443\/model: Section 1; Section 4 · Checked /,
    );
    expect($("img")).toHaveLength(2);
    expect($("img").first().attr("src")).toBe("https://models.example.net:8443/favicon.ico");
    expect($(".source-mark").last().text()).toBe("D");
    expect(html).not.toContain("Quoted evidence");
    expect(html).not.toContain("a".repeat(64));
    expect($("script")).toHaveLength(0);
  });
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
    expect(html.indexOf("requires beta header")).toBeLessThan(html.indexOf("claim-sources"));
    expect(html).toContain('href="https://example.com/limits"');
    expect(html).not.toContain("Native output evidence");
    expect(html).toContain("At a glance / output");
    expect(html).not.toContain("a".repeat(64));
    expect(html).toContain("&lt;img");
    expect(load(html)('img[src="x"], [onerror]')).toHaveLength(0);
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
