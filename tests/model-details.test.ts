import { describe, expect, it } from "vite-plus/test";
import { load } from "cheerio";
import ModelDetails from "../src/components/ModelDetails.vue";
import ModelCapabilityDetails from "../src/components/ModelCapabilityDetails.vue";
import ModelClaimEvidence from "../src/components/ModelClaimEvidence.vue";
import type { WebsiteModel, WebsiteModelDetail } from "../src/catalog/website-schema.ts";
import { unknownCapabilities } from "../src/catalog/schema.ts";
import { renderComponent } from "./render-component.ts";
import type { LimitDetailGroup } from "../src/catalog/model-limit-details.ts";
import type {
  CapabilityDetailGroup,
  CapabilityStatement,
} from "../src/catalog/model-capability-details.ts";

describe("model details", () => {
  it("renders explicit cache exclusions and native effort in their named API scope", async () => {
    const scope = "Example API <tag>";
    const group: CapabilityDetailGroup = {
      source_ref: "test-models",
      claim: "interactions",
      statements: [
        { kind: "prompt_cache", scope, mode: "implicit", supported: true },
        { kind: "prompt_cache", scope, mode: "explicit", supported: false },
        {
          kind: "reasoning_effort",
          scope,
          supported_values: ["low", "high"],
          unsupported_values: ["none", "minimal"],
          default_value: "medium",
        },
      ],
      evidence: [
        {
          document_url: "https://example.com/capabilities",
          observed_at: "2026-11-17T00:00:00.000Z",
          locator: "Interactions modes",
          content_hash: "2".repeat(64),
          excerpt: "Implicit context caching and native effort levels.",
        },
      ],
    };
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
      pricing: { outcome: "unknown" },
    };
    const props = {
      model,
      providerName: "Test",
      provider: undefined,
      dataVersion: "a".repeat(64),
      detail: {
        model_ref: model.uid,
        modalities: { input: ["text", "image"], output: ["text"] },
        capabilities: {
          ...unknownCapabilities(),
          prompt_cache: true,
          effort_control: false,
          tool_call: true,
          streaming: true,
        },
        delivery_modes: ["streaming"],
        scope: "global_catalog" as const,
        capability_details: [group],
      } satisfies WebsiteModelDetail,
      loading: false,
      error: undefined,
      pricingTarget: undefined,
    };
    const html = await renderComponent(ModelDetails, props);
    const $ = load(html);
    const settings = $(".capability-list > li > details");
    expect(
      settings
        .children("summary")
        .map((_, node) => $(node).find("span").text())
        .get(),
    ).toEqual(["Reasoning", "Prompt caching"]);
    expect($(".capability-list > li")).toHaveLength(3);
    expect($(".capability-list > li > div").text()).toBe("Tool calling");
    expect($(".modality-flow > div").first().text()).toMatch(/Input\s+text, image/);
    expect($(".modality-flow > div").last().text()).toMatch(/Output\s+text/);
    expect($(".fact-grid").text()).toContain("streaming");
    expect(settings.filter("[open]")).toHaveLength(0);
    const effort = settings.eq(0);
    const cache = settings.eq(1);
    expect(effort.children("summary").text()).toContain("Model-wide status unknown");
    expect(effort.find(".capability-effort-control").text()).toMatch(
      /Effort control\s+Unsupported model-wide/,
    );
    expect(effort.find(".capability-behavior").text()).not.toContain("Automatic");
    expect(cache.find("strong").text()).toContain("Automatic");
    expect(cache.text()).toContain("The API can reuse repeated prompt content automatically.");
    expect(cache.find("strong").text()).toContain("Caller-defined");
    expect(cache.find(".capability-behavior").text()).not.toContain("Documented levels");
    expect(effort.find("details a").attr("href")).toBe("https://example.com/capabilities");
    const evidence = cache.find("details");
    expect(evidence.children("summary").text()).toContain("1 source");
    expect(evidence.find("a").attr("href")).toBe("https://example.com/capabilities");
    expect(evidence.find("button time").attr("datetime")).toBe("2026-11-17T00:00:00.000Z");
    expect(settings.text()).not.toContain("2026-11-17");
    expect(html).toContain(">Unsupported<");
    expect(
      effort
        .find(".effort-values dt")
        .map((_, el) => $(el).text())
        .get(),
    ).toEqual(["Documented levels", "Default", "Unsupported values"]);
    expect(
      effort
        .find(".effort-values code")
        .map((_, el) => $(el).text())
        .get(),
    ).toEqual(["low, high", "medium", '"none", "minimal"']);
    expect(html).toContain("Example API &lt;tag&gt;");
    expect(settings.text()).not.toContain("https://example.com/capabilities");
    expect(html).toContain('href="https://example.com/capabilities"');
    expect(html).not.toContain("Unresolved source conflict");
    const scoped = load(
      await renderComponent(ModelDetails, {
        ...props,
        detail: {
          ...props.detail,
          capabilities: { ...unknownCapabilities(), fine_tuning: false },
          capability_details: [
            {
              ...group,
              statements: group.statements.filter(({ kind }) => kind === "prompt_cache"),
            },
            { ...group, claim: "withdrawn", statements: [] },
          ],
        },
      }),
    );
    expect(scoped(".capability-list > li")).toHaveLength(2);
    expect(scoped(".capability-list > li > details > summary").text()).toMatch(
      /Prompt caching\s*API-specific/,
    );
    expect(scoped(".capability-list > li > div").text()).toMatch(/Fine-tuning\s*Unsupported/);
    expect(scoped(".capability-list").text()).not.toContain("Reasoning");
    const flags = load(
      await renderComponent(ModelDetails, {
        ...props,
        detail: {
          ...props.detail,
          capabilities: {
            ...unknownCapabilities(),
            reasoning: true,
            tool_call: true,
            effort_control: true,
          },
          capability_details: [{ ...group, statements: [] }],
        },
      }),
    );
    expect(
      flags(".capability-list > li > div")
        .map((_, el) => flags(el).find("span").text())
        .get(),
    ).toEqual(["Reasoning", "Tool calling"]);
    expect(flags(".capability-list > li").first().text()).toContain("Effort control supported");
    expect(flags(".capability-list details")).toHaveLength(0);
    const empty = await renderComponent(ModelDetails, {
      ...props,
      detail: { ...props.detail, capabilities: unknownCapabilities(), capability_details: [] },
    });
    expect(empty).toContain("No capability information published");
    const loading = await renderComponent(ModelDetails, {
      ...props,
      detail: undefined,
      loading: true,
    });
    expect(loading).toContain("Loading details");
    expect(loading).not.toContain("No capability information published");
    const conflict = load(
      await renderComponent(ModelDetails, {
        ...props,
        detail: {
          ...props.detail,
          capability_details: [
            group,
            {
              ...group,
              claim: "alternate",
              statements: [{ kind: "prompt_cache", scope, mode: "explicit", supported: true }],
            },
          ],
        },
      }),
    );
    const conflictingRow = conflict(".capability-list > li > details").last();
    expect(conflictingRow.attr("open")).toBeUndefined();
    expect(conflictingRow.children("summary").text()).toContain("Unresolved source conflict");
    expect(conflictingRow.find(".claim-sources")).toHaveLength(2);
    expect(conflict(".capability-list > li > details").first().text()).not.toContain(
      "Unresolved source conflict",
    );
  });
  it("groups only the same structured effort conclusion within its owning claim", async () => {
    const rejection: CapabilityStatement = {
      kind: "reasoning_effort",
      scope: "Example Chat. Request field settings.effort.",
      unsupported_values: ["none"],
      applicability: { interface: "Example Chat", parameter: "settings.effort" },
    };
    const group: CapabilityDetailGroup = {
      source_ref: "example-docs",
      claim: "effort",
      evidence: [
        {
          document_url: "https://docs.example.net/effort",
          locator: "Request options",
          observed_at: "2026-11-17T00:00:00.000Z",
          content_hash: "1".repeat(64),
          excerpt: "Some request options reject none.",
        },
      ],
      statements: [
        rejection,
        {
          ...rejection,
          scope: "Example Generate. Request field level.",
          applicability: { interface: "Example Generate", parameter: "level" },
        },
        {
          ...rejection,
          scope: "Example Generate, Canada only. Request field level.",
          applicability: {
            interface: "Example Generate",
            parameter: "level",
            condition: "Canada only",
          },
        },
        {
          kind: "reasoning_effort",
          scope: "Example Generate, Japan. Default in adaptive mode.",
          applicability: {
            interface: "Example Generate",
            parameter: "level",
            condition: "Japan, in adaptive mode",
          },
          default_value: "XHigh",
        },
      ],
    };
    const cache: CapabilityDetailGroup = {
      ...group,
      claim: "cache_modes",
      statements: [
        {
          kind: "prompt_cache",
          mode: "implicit",
          supported: true,
          scope: "Example Generate. Eligible messages.",
          applicability: { interface: "Example Generate", condition: "Eligible messages" },
        },
        {
          kind: "prompt_cache",
          mode: "explicit",
          supported: true,
          scope: "Example Generate (cache.mode). Marked prefixes.",
          applicability: {
            interface: "Example Generate",
            parameter: "cache.mode",
            condition: "Marked prefixes",
          },
        },
      ],
    };
    const $ = load(
      await renderComponent(ModelCapabilityDetails, {
        capabilities: {
          ...unknownCapabilities(),
          reasoning: false,
          effort_control: true,
          prompt_cache: true,
        },
        groups: [group, { ...group, claim: "separate", statements: [rejection] }, cache],
      }),
    );
    expect($(".capability-row").first().text()).toMatch(/Reasoning\s*Model-wide unsupported/);
    expect($(".capability-effort-control").text()).toMatch(/Effort control\s+Supported model-wide/);
    const behaviors = $(".capability-group").first().children(".capability-behavior");
    expect(behaviors).toHaveLength(3);
    expect(behaviors.first().find("dt").text()).toBe("Unsupported values");
    expect(
      behaviors
        .first()
        .find(".capability-bindings li")
        .map((_, el) => `${$(el).find("span").text()} ${$(el).find("code").text()}`)
        .get(),
    ).toEqual(["Example Chat settings.effort", "Example Generate level"]);
    expect(behaviors.eq(1).text()).toContain("Canada only");
    expect(behaviors.eq(2).text()).toContain("Japan, in adaptive mode");
    expect(behaviors.eq(2).find(".effort-values code").text()).toBe("XHigh");
    expect($(".capability-list > li").first().find(".claim-sources")).toHaveLength(2);
    const caching = $(".capability-list > li").last();
    expect(caching.find(".capability-interface").text()).toBe("Example Generate");
    expect(caching.find(".capability-bindings").first().text()).toBe("Eligible messages");
    expect(caching.find(".capability-bindings").last().find("code").text()).toBe("cache.mode");
    expect(caching.find(".capability-bindings").last().find("span").text()).toBe("Marked prefixes");
    expect(caching.find(".claim-sources")).toHaveLength(1);
  });
  it("counts source documents, stacks distinct sites and preserves every citation", async () => {
    const urls = [
      "https://models.example.net:8443/model",
      "https://models.example.net:8443/guide?q=api#limits",
      "http://docs.example.org/reference",
    ] as const;
    const documents = [...urls, urls[0]].map((document_url, index) => ({
      document_url,
      locator: `Section ${index + 1}`,
      excerpt: "Quoted evidence <script>alert(1)</script>",
      content_hash: "a".repeat(64),
      observed_at: "2026-11-19T05:03:39.290Z",
    }));
    const $ = load(await renderComponent(ModelClaimEvidence, { documents }));
    expect($("summary").text()).toContain("3 sources");
    expect($("summary .source-mark")).toHaveLength(2);
    expect($("summary img")).toHaveLength(1);
    expect($("summary img").attr("src")).toBe("https://models.example.net:8443/favicon.ico");
    expect($("summary .source-mark").last().text()).toBe("D");
    expect(
      $("a")
        .map((_, el) => $(el).attr("href"))
        .get(),
    ).toEqual([...urls, urls[0]]);
    expect($("a").text()).toContain("Section 4");
    expect($(".claim-evidence").text()).toContain("Quoted evidence <script>alert(1)</script>");
    expect($("script")).toHaveLength(0);
    expect($("body").text()).not.toContain("https://");
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
    expect(html.indexOf("requires beta header")).toBeLessThan(html.indexOf("1 source"));
    expect(html).toContain('href="https://example.com/limits"');
    expect(html).toContain("2026-11-17T12:00:00.000Z");
    expect(html).toContain("At a glance / output");
    expect(html).toContain("a".repeat(64));
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
