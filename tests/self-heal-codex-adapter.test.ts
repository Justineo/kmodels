import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

// Allow local fake-codex subprocess and strictly loopback 127.0.0.1 proxy HTTP calls while keeping
// global fetch and node:https completely offline.
vi.unmock("node:child_process");
vi.unmock("node:http");

import {
  DEFAULT_CODEX_MODEL,
  buildCodexArgs,
  buildCodexSandboxArgs,
  calculateUsageCostUsd,
  estimateRequestReservation,
  parseSseUsage,
  resolveCodexBinary,
  resolveOpenAIRateBand,
  runCodexAdapter,
  sanitizeResponsesRequest,
  startMeteredOpenAIProxy,
  type OpenAIInferencePriceLookup,
} from "../scripts/self-heal/adapters/codex.ts";
import { runSelfHealGate } from "../scripts/self-heal/gate.ts";
import { isBuiltinCodexAdapterCommand, runGenerate } from "../scripts/self-heal/generate.ts";
import { sanitizedUntrustedEnv, selfHealPrivateBaseDir } from "../scripts/self-heal/runtime.ts";
import { sha256 } from "../src/catalog/io.ts";
import { canonicalizeApplicability } from "../src/catalog/pricing-canonical.ts";
import type { PriceApplicability, PriceCondition } from "../src/catalog/pricing-schema.ts";
import { createInferencePriceLookup, priceDataSchemaVersion } from "../src/pricing/index.ts";

interface SyntheticBand {
  readonly inputNano: number;
  readonly cacheReadNano: number;
  readonly cacheWrite30mNano?: number;
  readonly cacheWrite12hNano?: number;
  readonly outputNano: number;
}

interface SyntheticModelSpec {
  readonly modelId: string;
  readonly longContextThreshold?: number;
  readonly short: SyntheticBand;
  readonly long?: SyntheticBand;
  readonly includeDiscountedCompletionWindow?: boolean;
}

/**
 * Build a genuine Kmodels `createInferencePriceLookup` from synthetic OpenAI price data so unit
 * tests exercise the real pricing engine, selectors, and rational arithmetic without requiring
 * hydrated `data/` files on disk (live hydrated data is verified in `tests/pricing-lookup-data.test.ts`).
 */
function createSyntheticOpenAIPricingLookup(): OpenAIInferencePriceLookup {
  const models: readonly SyntheticModelSpec[] = [
    {
      modelId: "gpt-6.2-sol",
      longContextThreshold: 272_000,
      includeDiscountedCompletionWindow: true,
      short: {
        inputNano: 2000,
        cacheReadNano: 100,
        cacheWrite30mNano: 2500,
        cacheWrite12hNano: 5000,
        outputNano: 10000,
      },
      long: {
        inputNano: 4000,
        cacheReadNano: 200,
        cacheWrite30mNano: 5000,
        cacheWrite12hNano: 10000,
        outputNano: 15000,
      },
    },
    {
      modelId: "gpt-6.2-astra",
      longContextThreshold: 272_000,
      includeDiscountedCompletionWindow: true,
      short: {
        inputNano: 8000,
        cacheReadNano: 400,
        cacheWrite30mNano: 10000,
        cacheWrite12hNano: 20000,
        outputNano: 40000,
      },
      long: {
        inputNano: 16000,
        cacheReadNano: 800,
        cacheWrite30mNano: 20000,
        cacheWrite12hNano: 40000,
        outputNano: 60000,
      },
    },
    {
      modelId: "gpt-6-luna",
      longContextThreshold: 272_000,
      includeDiscountedCompletionWindow: true,
      short: {
        inputNano: 100,
        cacheReadNano: 10,
        cacheWrite30mNano: 125,
        cacheWrite12hNano: 250,
        outputNano: 500,
      },
      long: {
        inputNano: 200,
        cacheReadNano: 20,
        cacheWrite30mNano: 250,
        cacheWrite12hNano: 500,
        outputNano: 750,
      },
    },
    {
      modelId: "gpt-5-mini",
      short: {
        inputNano: 250,
        cacheReadNano: 25,
        outputNano: 2000,
      },
    },
  ];

  const applicabilities: PriceApplicability[] = [];
  const appIndex = new Map<string, number>();
  const internApp = (predicates: PriceCondition[]): number => {
    const entry = canonicalizeApplicability({ any_of: [{ all_of: predicates }] });
    const key = JSON.stringify(entry);
    const existing = appIndex.get(key);
    if (existing !== undefined) return existing;
    const id = applicabilities.length;
    applicabilities.push(entry);
    appIndex.set(key, id);
    return id;
  };

  const tokenUnit = {
    factors: [{ unit: { namespace: "kmodels" as const, value: "token" as const }, power: 1 }],
  };
  const secondUnit = {
    factors: [{ unit: { namespace: "kmodels" as const, value: "second" as const }, power: 1 }],
  };
  const hexId = (seed: string): string => sha256(Buffer.from(seed, "utf8"));
  const evidence = [
    { source_ref: "openai-pricing", locator: { kind: "table", value: "synthetic" } },
  ];

  const makePredicates = (options: {
    contextUpper?: number;
    contextLower?: number;
    cacheTtlSeconds?: number;
    completionWindow?: "ordinary" | "8h";
  }): PriceCondition[] => {
    const predicates: PriceCondition[] = [
      {
        kind: "categorical",
        dimension: { namespace: "kmodels", value: "execution" },
        values: [{ namespace: "kmodels", value: "request" }],
      },
      {
        kind: "categorical",
        dimension: { namespace: "kmodels", value: "served_service_tier" },
        values: [{ namespace: "provider", provider_id: "openai", value: "standard" }],
      },
      {
        kind: "categorical",
        dimension: { namespace: "kmodels", value: "endpoint" },
        values: [{ namespace: "provider", provider_id: "openai", value: "v1/responses" }],
      },
      {
        kind: "categorical",
        dimension: { namespace: "kmodels", value: "deployment_scope" },
        values: [{ namespace: "provider", provider_id: "openai", value: "global_processing" }],
      },
    ];
    if (options.completionWindow !== undefined) {
      predicates.push({
        kind: "categorical",
        dimension: { namespace: "provider", provider_id: "openai", value: "completion_window" },
        values: [{ namespace: "provider", provider_id: "openai", value: options.completionWindow }],
      });
    }
    if (options.contextUpper !== undefined) {
      predicates.push({
        kind: "decimal_range",
        dimension: { namespace: "kmodels", value: "context_tokens" },
        unit: tokenUnit,
        upper: { value: String(options.contextUpper), inclusive: true },
      });
    }
    if (options.contextLower !== undefined) {
      predicates.push({
        kind: "decimal_range",
        dimension: { namespace: "kmodels", value: "context_tokens" },
        unit: tokenUnit,
        lower: { value: String(options.contextLower), inclusive: true },
      });
    }
    if (options.cacheTtlSeconds !== undefined) {
      predicates.push({
        kind: "decimal_range",
        dimension: { namespace: "kmodels", value: "cache_ttl_seconds" },
        unit: secondUnit,
        lower: { value: String(options.cacheTtlSeconds), inclusive: true },
        upper: { value: String(options.cacheTtlSeconds), inclusive: true },
      });
    }
    return predicates;
  };

  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const makeVariant = (nanoUsd: number, applicabilityId: number) => {
    const divisor = gcd(nanoUsd, 1_000_000_000);
    return {
      price: {
        value: {
          numerator: String(nanoUsd / divisor),
          denominator: String(1_000_000_000 / divisor),
        },
        denomination: { kind: "fiat", currency: "USD" },
        per: tokenUnit,
      },
      evidence,
      applicability_id: applicabilityId,
    };
  };

  const books = [];
  const rules = [];
  for (const spec of models) {
    const modelRef = `openai/${spec.modelId}`;
    const offerId = hexId(`offer:${modelRef}`);
    const bands: Array<{
      band: SyntheticBand;
      contextUpper?: number;
      contextLower?: number;
    }> =
      spec.long !== undefined && spec.longContextThreshold !== undefined
        ? [
            { band: spec.short, contextUpper: spec.longContextThreshold },
            { band: spec.long, contextLower: spec.longContextThreshold + 1 },
          ]
        : [{ band: spec.short }];

    const meterVariants = new Map<string, ReturnType<typeof makeVariant>[]>();
    const addVariant = (meter: string, nano: number, predicates: PriceCondition[]) => {
      const list = meterVariants.get(meter) ?? [];
      list.push(makeVariant(nano, internApp(predicates)));
      meterVariants.set(meter, list);
    };

    for (const entry of bands) {
      const baseOpts = {
        ...(entry.contextUpper === undefined ? {} : { contextUpper: entry.contextUpper }),
        ...(entry.contextLower === undefined ? {} : { contextLower: entry.contextLower }),
        ...(spec.includeDiscountedCompletionWindow
          ? { completionWindow: "ordinary" as const }
          : {}),
      };
      addVariant("input_text", entry.band.inputNano, makePredicates(baseOpts));
      addVariant("cache_read_text", entry.band.cacheReadNano, makePredicates(baseOpts));
      addVariant("output_text", entry.band.outputNano, makePredicates(baseOpts));
      if (entry.band.cacheWrite30mNano !== undefined) {
        addVariant(
          "cache_write_text",
          entry.band.cacheWrite30mNano,
          makePredicates({ ...baseOpts, cacheTtlSeconds: 1800 }),
        );
      }
      if (entry.band.cacheWrite12hNano !== undefined) {
        addVariant(
          "cache_write_text",
          entry.band.cacheWrite12hNano,
          makePredicates({ ...baseOpts, cacheTtlSeconds: 43200 }),
        );
      }
      if (spec.includeDiscountedCompletionWindow) {
        // Include an 8h discounted completion_window variant to verify ordinary sync selection.
        const discountedOpts = { ...baseOpts, completionWindow: "8h" as const };
        addVariant(
          "input_text",
          Math.floor((entry.band.inputNano * 6) / 10),
          makePredicates(discountedOpts),
        );
        addVariant(
          "output_text",
          Math.floor((entry.band.outputNano * 6) / 10),
          makePredicates(discountedOpts),
        );
      }
    }

    const terms = [...meterVariants.entries()].map(([meter, variants]) => ({
      id: hexId(`term:${modelRef}:${meter}`),
      term_key: `sync/${meter}`,
      kind: "rate",
      meter: { namespace: "kmodels", value: meter },
      source_refs: ["openai-pricing"],
      variants,
      raw_variants: [],
    }));

    const requestExecAppId = internApp([
      {
        kind: "categorical",
        dimension: { namespace: "kmodels", value: "execution" },
        values: [{ namespace: "kmodels", value: "request" }],
      },
    ]);
    const standardTierAppId = internApp([
      {
        kind: "categorical",
        dimension: { namespace: "kmodels", value: "served_service_tier" },
        values: [{ namespace: "provider", provider_id: "openai", value: "standard" }],
      },
    ]);
    const unconditionalAppId = internApp([]);

    books.push({
      id: hexId(`book:${modelRef}`),
      provider_id: "openai",
      book_key: spec.modelId,
      scope: { kind: "models", model_refs: [modelRef] },
      source_refs: ["openai-pricing"],
      evidence,
      offers: [
        {
          id: offerId,
          offer_key: "inference",
          billing_mode: { namespace: "kmodels", value: "usage" },
          source_refs: ["openai-pricing"],
          states: [],
          relations: [],
          selection: [
            {
              dimension: "execution",
              target: "condition",
              coverage: "complete",
              applicability_id: requestExecAppId,
              alternatives: [
                {
                  value: { namespace: "kmodels", value: "request" },
                  applicability_id: requestExecAppId,
                },
              ],
              evidence,
            },
            {
              dimension: "served_service_tier",
              target: "condition",
              coverage: "complete",
              applicability_id: unconditionalAppId,
              alternatives: [
                {
                  value: { namespace: "kmodels", value: "standard" },
                  applicability_id: standardTierAppId,
                },
              ],
              evidence,
            },
          ],
          terms,
        },
      ],
    });
    rules.push({
      provider_id: "openai",
      model_id: spec.modelId,
      model_ref: modelRef,
      offer_refs: [offerId],
      fixed_selectors: [],
      evidence,
    });
  }

  const pricingDataVersion = "a".repeat(64);
  const coreCatalogVersion = "b".repeat(64);
  const priceData = {
    schemaVersion: priceDataSchemaVersion,
    snapshot: {
      pricingDataVersion,
      coreCatalogVersion,
      generatedAt: "2026-11-25T00:00:00.000Z",
    },
    providers: [
      {
        snapshot: {
          provider_id: "openai",
          publication: "fresh",
          observed_at: "2026-11-25T00:00:00.000Z",
        },
        vocabulary: {
          provider_id: "openai",
          atoms: [
            {
              kind: "categorical_value",
              dimension: { namespace: "kmodels", value: "served_service_tier" },
              key: "standard",
              definition: "OpenAI standard service tier",
            },
            {
              kind: "categorical_value",
              dimension: { namespace: "kmodels", value: "endpoint" },
              key: "v1/responses",
              definition: "OpenAI Responses API endpoint",
            },
            {
              kind: "categorical_value",
              dimension: { namespace: "kmodels", value: "deployment_scope" },
              key: "global_processing",
              definition: "OpenAI global processing scope",
            },
            {
              kind: "dimension",
              key: "completion_window",
              resolution_phase: "request",
              definition: "OpenAI completion window",
            },
            {
              kind: "categorical_value",
              dimension: {
                namespace: "provider",
                provider_id: "openai",
                value: "completion_window",
              },
              key: "ordinary",
              definition: "Ordinary synchronous request",
            },
            {
              kind: "categorical_value",
              dimension: {
                namespace: "provider",
                provider_id: "openai",
                value: "completion_window",
              },
              key: "8h",
              definition: "Discounted 8h background completion window",
            },
          ],
        },
        applicabilities,
        models: models.map((spec) => ({
          model_ref: `openai/${spec.modelId}`,
          disposition: "offers",
        })),
        sources: [
          {
            id: "openai-pricing",
            url: "https://openai.com/api/pricing/",
            observed_at: "2026-11-25T00:00:00.000Z",
            content_hash: "c".repeat(64),
            extractor_version: "synthetic-v1",
          },
        ],
        books,
      },
    ],
  };

  return createInferencePriceLookup(priceData, {
    core_catalog_version: coreCatalogVersion,
    pricing_data_version: pricingDataVersion,
    sources: [],
    rules,
  });
}

const syntheticLookup = createSyntheticOpenAIPricingLookup();

function postLoopback(
  url: string,
  headers: Record<string, string>,
  body: string,
): Promise<{ status: number; text: string }> {
  const parsed = new URL(url);
  if (parsed.hostname !== "127.0.0.1") {
    throw new Error(`Refusing non-loopback test HTTP request to ${parsed.hostname}`);
  }
  return new Promise((resolvePromise, rejectPromise) => {
    const req = httpRequest(
      {
        hostname: parsed.hostname,
        port: Number(parsed.port),
        path: parsed.pathname,
        method: "POST",
        headers: {
          ...headers,
          "content-length": String(Buffer.byteLength(body, "utf8")),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer | string) =>
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk),
        );
        res.on("end", () =>
          resolvePromise({
            status: res.statusCode ?? 0,
            text: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", rejectPromise);
    req.end(body, "utf8");
  });
}

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  }
});

function buildCompletedSse(options: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  cacheWriteTokens?: number;
  ttl30mTokens?: number;
  ttl12hTokens?: number;
}): string {
  const details: Record<string, unknown> = {};
  if (options.cachedTokens !== undefined) details.cached_tokens = options.cachedTokens;
  if (options.cacheWriteTokens !== undefined) details.cache_write_tokens = options.cacheWriteTokens;
  if (options.ttl30mTokens !== undefined || options.ttl12hTokens !== undefined) {
    details.cache_write_tokens_details = {
      ttl_30m_tokens: options.ttl30mTokens ?? 0,
      ttl_12h_tokens: options.ttl12hTokens ?? 0,
    };
  }
  const completed = {
    type: "response.completed",
    response: {
      id: "resp_test",
      model: options.model,
      status: "completed",
      usage: {
        input_tokens: options.inputTokens,
        output_tokens: options.outputTokens,
        total_tokens: options.inputTokens + options.outputTokens,
        ...(Object.keys(details).length > 0 ? { input_tokens_details: details } : {}),
      },
    },
  };
  return `event: response.completed\ndata: ${JSON.stringify(completed)}\n\ndata: [DONE]\n\n`;
}

describe("self-heal Codex adapter pricing and SSE settlement", () => {
  it("calculates exact short-context and long-context gpt-6.2-sol charges via Kmodels pricing lookup", () => {
    const shortUsd = calculateUsageCostUsd(
      "gpt-6.2-sol",
      {
        input_tokens: 1000,
        output_tokens: 50,
        total_tokens: 1050,
        input_tokens_details: {
          cached_tokens: 200,
          cache_write_tokens: 300,
          cache_write_tokens_details: {
            ttl_30m_tokens: 200,
            ttl_12h_tokens: 100,
          },
        },
      },
      syntheticLookup,
    );
    // 500*2000 + 200*100 + 200*2500 + 100*5000 + 50*10000 = 2,520,000 nano-USD
    expect(shortUsd).toBe(0.00252);

    const longUsd = calculateUsageCostUsd(
      "gpt-6.2-sol",
      {
        input_tokens: 300_000,
        output_tokens: 1000,
        total_tokens: 301_000,
        input_tokens_details: {
          cached_tokens: 200_000,
          cache_write_tokens: 0,
        },
      },
      syntheticLookup,
    );
    // 100k*4000 + 200k*200 + 1k*15000 = 455,000,000 nano-USD
    expect(longUsd).toBe(0.455);

    // Direct lookup of an uncatalogued dated snapshot MUST fail closed (never borrow base rates).
    expect(() => resolveOpenAIRateBand("gpt-6.2-sol-2026-11-01", 10_000, syntheticLookup)).toThrow(
      /Unsupported SELF_HEAL_MODEL/,
    );
    expect(() => resolveOpenAIRateBand("gpt-5-mini-2025-08-07", 10_000, syntheticLookup)).toThrow(
      /Unsupported SELF_HEAL_MODEL/,
    );

    // When OpenAI resolves a requested catalogued undated alias (`gpt-6.2-sol`) to a dated snapshot
    // in SSE (`gpt-6.2-sol-2026-11-01`), SSE settlement bills under the requested catalogued alias.
    const datedAliasSse = buildCompletedSse({
      model: "gpt-6.2-sol-2026-11-01",
      inputTokens: 300_000,
      outputTokens: 1000,
      cachedTokens: 200_000,
      cacheWriteTokens: 0,
    });
    expect(parseSseUsage(datedAliasSse, "gpt-6.2-sol", syntheticLookup)).toEqual({
      model: "gpt-6.2-sol-2026-11-01",
      input_tokens: 300_000,
      output_tokens: 1000,
      cost_usd: 0.455,
    });
  });

  it("uses exact Kmodels rates for astra and luna, fails closed on unknown models or unpriced cache writes, and rejects mismatched response models", () => {
    // 10,000 short-context output tokens on gpt-6.2-astra at $40/1M = $0.40 (never under-billed).
    expect(
      calculateUsageCostUsd(
        "gpt-6.2-astra",
        {
          input_tokens: 0,
          output_tokens: 10_000,
          total_tokens: 10_000,
          input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
        },
        syntheticLookup,
      ),
    ).toBe(0.4);

    // gpt-6-luna short-context standard rates: $0.10/1M input + $0.50/1M output.
    // 10,000 ordinary input + 1,000 output = $0.0010 + $0.0005 = $0.00150.
    expect(
      calculateUsageCostUsd(
        "gpt-6-luna",
        {
          input_tokens: 10_000,
          output_tokens: 1_000,
          total_tokens: 11_000,
          input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
        },
        syntheticLookup,
      ),
    ).toBe(0.0015);

    // gpt-6-luna long-context (>272k): $0.20/1M input, $0.02/1M cache read, $0.75/1M output.
    // 100k*200 + 200k*20 + 1k*750 = 24,750,000 nano-USD = $0.02475.
    expect(
      calculateUsageCostUsd(
        "gpt-6-luna",
        {
          input_tokens: 300_000,
          output_tokens: 1_000,
          total_tokens: 301_000,
          input_tokens_details: { cached_tokens: 200_000, cache_write_tokens: 0 },
        },
        syntheticLookup,
      ),
    ).toBe(0.02475);

    // Unknown model fails closed.
    expect(() => resolveOpenAIRateBand("gpt-9-custom", 10_000, syntheticLookup)).toThrow(
      /Unsupported SELF_HEAL_MODEL/,
    );

    // Unpriced cache_write_tokens on a model without a cache_write_text meter fails closed.
    expect(() =>
      calculateUsageCostUsd(
        "gpt-5-mini",
        {
          input_tokens: 1000,
          output_tokens: 100,
          total_tokens: 1100,
          input_tokens_details: { cached_tokens: 0, cache_write_tokens: 500 },
        },
        syntheticLookup,
      ),
    ).toThrow(/Unpriced cache write tokens/);

    const sse = buildCompletedSse({
      model: "gpt-5-mini",
      inputTokens: 100,
      outputTokens: 20,
      cachedTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(() => parseSseUsage(sse, "gpt-6.2-sol", syntheticLookup)).toThrow(
      /Unexpected response model/,
    );
  });

  it("rejects inconsistent token breakdown sums", () => {
    expect(() =>
      calculateUsageCostUsd(
        "gpt-6.2-sol",
        {
          input_tokens: 100,
          output_tokens: 10,
          input_tokens_details: {
            cached_tokens: 80,
            cache_write_tokens: 30,
          },
        },
        syntheticLookup,
      ),
    ).toThrow(/Inconsistent OpenAI Responses usage/);
  });
});

describe("self-heal Codex request sanitizer", () => {
  it("normalizes responses options, strips null handles, and blocks hosted tools or media", () => {
    const sanitized = sanitizeResponsesRequest(
      {
        model: "wrong-model",
        input: [{ role: "user", content: "fix parser" }],
        tools: [{ type: "function", name: "shell" }],
        max_output_tokens: 99_999,
        previous_response_id: null,
        conversation: null,
        store: true,
      },
      DEFAULT_CODEX_MODEL,
    );
    const parsed = JSON.parse(sanitized.body) as Record<string, unknown>;
    expect(parsed.model).toBe(DEFAULT_CODEX_MODEL);
    expect(parsed.stream).toBe(true);
    expect(parsed.store).toBe(false);
    expect(parsed.background).toBe(false);
    expect(parsed.service_tier).toBe("default");
    expect(parsed.max_output_tokens).toBe(8_192);
    expect("previous_response_id" in parsed).toBe(false);
    expect("conversation" in parsed).toBe(false);

    expect(() =>
      sanitizeResponsesRequest(
        {
          input: [{ role: "user", content: "hi" }],
          previous_response_id: "resp_123",
        },
        DEFAULT_CODEX_MODEL,
      ),
    ).toThrow();

    expect(() =>
      sanitizeResponsesRequest(
        {
          input: [{ role: "user", content: "hi" }],
          tools: [{ type: "web_search" }],
        },
        DEFAULT_CODEX_MODEL,
      ),
    ).toThrow();

    expect(() =>
      sanitizeResponsesRequest(
        {
          input: [{ role: "user", content: [{ type: "input_image", image_url: "https://x" }] }],
        },
        DEFAULT_CODEX_MODEL,
      ),
    ).toThrow(/text-only payload limit/);
  });
});

describe("self-heal metered OpenAI proxy", () => {
  it("enforces pre-request USD/token caps before forwarding and persists exact settled usage", async () => {
    const dir = await makeTempDir("self-heal-proxy-");
    const usageFile = join(dir, "usage.json");
    let upstreamCalls = 0;
    let lastUpstreamAuth = "";

    const reservation = estimateRequestReservation("gpt-6.2-sol", 256, 200, syntheticLookup);
    // Allow exactly 1 request whose conservative reservation fits, then block turn 2 pre-request.
    const maxRunUsd = Number((reservation.reserved_usd + 0.005).toFixed(6));

    const proxy = await startMeteredOpenAIProxy({
      apiKey: "sk-real-secret",
      model: "gpt-6.2-sol",
      maxRunUsd,
      maxRunTokens: 100_000,
      usageFile,
      pricingLookup: syntheticLookup,
      fetcher: async (_url, init) => {
        upstreamCalls += 1;
        const headers = init?.headers as Record<string, string>;
        lastUpstreamAuth = headers.authorization ?? "";
        return new Response(
          buildCompletedSse({
            model: "gpt-6.2-sol",
            inputTokens: 1000,
            outputTokens: 600,
            cachedTokens: 0,
            cacheWriteTokens: 0,
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      },
    });

    try {
      // Unauthorized call rejected before touching upstream.
      const unauth = await postLoopback(
        `${proxy.baseUrl}/responses`,
        { "content-type": "application/json" },
        JSON.stringify({ input: [], max_output_tokens: 200 }),
      );
      expect(unauth.status).toBe(401);
      expect(upstreamCalls).toBe(0);

      // Turn 1 succeeds and records exact usage ($0.008000 = 1000*2000 + 600*10000 nano-USD).
      const turn1 = await postLoopback(
        `${proxy.baseUrl}/responses`,
        {
          authorization: `Bearer ${proxy.proxyToken}`,
          "content-type": "application/json",
        },
        JSON.stringify({ input: [{ role: "user", content: "turn 1" }], max_output_tokens: 200 }),
      );
      expect(turn1.status).toBe(200);
      expect(upstreamCalls).toBe(1);
      expect(lastUpstreamAuth).toBe("Bearer sk-real-secret");
      expect(proxy.usage()).toEqual({
        input_tokens: 1000,
        output_tokens: 600,
        estimated_usd: 0.008,
      });

      const persisted = JSON.parse(await readFile(usageFile, "utf8")) as Record<string, unknown>;
      expect(persisted).toEqual(proxy.usage());

      // Turn 2 exceeds remaining USD budget ($0.008 + reservation > maxRunUsd) and is blocked BEFORE upstream call.
      const turn2 = await postLoopback(
        `${proxy.baseUrl}/responses`,
        {
          authorization: `Bearer ${proxy.proxyToken}`,
          "content-type": "application/json",
        },
        JSON.stringify({ input: [{ role: "user", content: "turn 2" }], max_output_tokens: 200 }),
      );
      expect(turn2.status).toBe(429);
      expect(proxy.budgetExceeded()).toBe(true);
      expect(upstreamCalls).toBe(1);
    } finally {
      await proxy.close();
    }
  });

  it("marks estimated_usd as null when an upstream 200 SSE stream omits terminal usage", async () => {
    const dir = await makeTempDir("self-heal-incomplete-");
    const usageFile = join(dir, "usage.json");
    let upstreamCalls = 0;

    const proxy = await startMeteredOpenAIProxy({
      apiKey: "sk-real-secret",
      model: "gpt-6.2-sol",
      maxRunUsd: 2.0,
      maxRunTokens: 500_000,
      usageFile,
      pricingLookup: syntheticLookup,
      fetcher: async () => {
        upstreamCalls += 1;
        return new Response('event: response.created\ndata: {"type":"response.created"}\n\n', {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      },
    });

    try {
      const res1 = await postLoopback(
        `${proxy.baseUrl}/responses`,
        {
          authorization: `Bearer ${proxy.proxyToken}`,
          "content-type": "application/json",
        },
        JSON.stringify({ input: [], max_output_tokens: 100 }),
      );
      expect(res1.status).toBe(200);
      expect(proxy.usage()).toEqual({
        input_tokens: 0,
        output_tokens: 0,
        estimated_usd: null,
      });

      // Subsequent calls are blocked once usage is incomplete so spend cannot run blind.
      const res2 = await postLoopback(
        `${proxy.baseUrl}/responses`,
        {
          authorization: `Bearer ${proxy.proxyToken}`,
          "content-type": "application/json",
        },
        JSON.stringify({ input: [], max_output_tokens: 100 }),
      );
      expect(res2.status).toBe(429);
      expect(upstreamCalls).toBe(1);
    } finally {
      await proxy.close();
    }
  });

  it("blocks dense lockfile payloads whose real BPE token count exceeds maxRunTokens before forwarding", async () => {
    const lockPrefix = (await readFile(resolve("pnpm-lock.yaml"), "utf8")).slice(0, 120_000);
    let upstreamCalls = 0;

    const proxy = await startMeteredOpenAIProxy({
      apiKey: "sk-real-secret",
      model: "gpt-5-mini",
      maxRunUsd: 2.0,
      maxRunTokens: 48_000,
      pricingLookup: syntheticLookup,
      fetcher: async () => {
        upstreamCalls += 1;
        return new Response(
          buildCompletedSse({ model: "gpt-5-mini", inputTokens: 58_953, outputTokens: 100 }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      },
    });

    try {
      const res = await postLoopback(
        `${proxy.baseUrl}/responses`,
        {
          authorization: `Bearer ${proxy.proxyToken}`,
          "content-type": "application/json",
        },
        JSON.stringify({
          input: [{ role: "user", content: lockPrefix }],
          max_output_tokens: 1024,
        }),
      );
      expect(res.status).toBe(429);
      expect(proxy.budgetExceeded()).toBe(true);
      expect(upstreamCalls).toBe(0);
    } finally {
      await proxy.close();
    }
  });

  it("persists unsettled null spend before upstream POST and blocks follow-up calls on pre-header disconnect", async () => {
    const dir = await makeTempDir("self-heal-disconnect-");
    const usageFile = join(dir, "usage.json");
    let upstreamCalls = 0;
    let inFlightDiskUsage: Record<string, unknown> | undefined;

    const proxy = await startMeteredOpenAIProxy({
      apiKey: "sk-real-secret",
      model: "gpt-6.2-sol",
      maxRunUsd: 2.0,
      maxRunTokens: 500_000,
      usageFile,
      pricingLookup: syntheticLookup,
      fetcher: async () => {
        upstreamCalls += 1;
        inFlightDiskUsage = JSON.parse(await readFile(usageFile, "utf8")) as Record<
          string,
          unknown
        >;
        throw new Error("socket hang up (ECONNRESET before response headers)");
      },
    });

    try {
      const res1 = await postLoopback(
        `${proxy.baseUrl}/responses`,
        {
          authorization: `Bearer ${proxy.proxyToken}`,
          "content-type": "application/json",
        },
        JSON.stringify({ input: [{ role: "user", content: "turn 1" }], max_output_tokens: 128 }),
      );
      expect(res1.status).toBe(502);
      expect(inFlightDiskUsage).toEqual({
        input_tokens: 0,
        output_tokens: 0,
        estimated_usd: null,
      });
      expect(proxy.usage()).toEqual({
        input_tokens: 0,
        output_tokens: 0,
        estimated_usd: null,
      });
      expect(JSON.parse(await readFile(usageFile, "utf8"))).toEqual({
        input_tokens: 0,
        output_tokens: 0,
        estimated_usd: null,
      });

      // Next request MUST be blocked because the previous upstream POST outcome is unknown.
      const res2 = await postLoopback(
        `${proxy.baseUrl}/responses`,
        {
          authorization: `Bearer ${proxy.proxyToken}`,
          "content-type": "application/json",
        },
        JSON.stringify({ input: [{ role: "user", content: "turn 2" }], max_output_tokens: 128 }),
      );
      expect(res2.status).toBe(429);
      expect(upstreamCalls).toBe(1);
    } finally {
      await proxy.close();
    }
  });

  it("keeps estimated_usd null and blocks retries on upstream 504/502 gateway errors", async () => {
    for (const status of [504, 502] as const) {
      const dir = await makeTempDir(`self-heal-${status}-`);
      const usageFile = join(dir, "usage.json");
      let upstreamCalls = 0;

      const proxy = await startMeteredOpenAIProxy({
        apiKey: "sk-real-secret",
        model: "gpt-6.2-sol",
        maxRunUsd: 2.0,
        maxRunTokens: 500_000,
        usageFile,
        pricingLookup: syntheticLookup,
        fetcher: async () => {
          upstreamCalls += 1;
          return new Response(JSON.stringify({ error: { message: "Gateway error" } }), {
            status,
            headers: { "content-type": "application/json" },
          });
        },
      });

      try {
        const res1 = await postLoopback(
          `${proxy.baseUrl}/responses`,
          {
            authorization: `Bearer ${proxy.proxyToken}`,
            "content-type": "application/json",
          },
          JSON.stringify({ input: [{ role: "user", content: "turn 1" }], max_output_tokens: 100 }),
        );
        expect(res1.status).toBe(status);
        expect(proxy.usage()).toEqual({
          input_tokens: 0,
          output_tokens: 0,
          estimated_usd: null,
        });
        expect(JSON.parse(await readFile(usageFile, "utf8"))).toEqual({
          input_tokens: 0,
          output_tokens: 0,
          estimated_usd: null,
        });

        const res2 = await postLoopback(
          `${proxy.baseUrl}/responses`,
          {
            authorization: `Bearer ${proxy.proxyToken}`,
            "content-type": "application/json",
          },
          JSON.stringify({ input: [{ role: "user", content: "turn 2" }], max_output_tokens: 100 }),
        );
        expect(res2.status).toBe(429);
        expect(proxy.budgetExceeded()).toBe(true);
        expect(upstreamCalls).toBe(1);
      } finally {
        await proxy.close();
      }
    }
  });

  it("clears pending unsettled status back to known spend on pre-execution 400 rejection", async () => {
    const dir = await makeTempDir("self-heal-4xx-");
    const usageFile = join(dir, "usage.json");

    const proxy = await startMeteredOpenAIProxy({
      apiKey: "sk-real-secret",
      model: "gpt-6.2-sol",
      maxRunUsd: 2.0,
      maxRunTokens: 500_000,
      usageFile,
      pricingLookup: syntheticLookup,
      fetcher: async () =>
        new Response(JSON.stringify({ error: { message: "Bad request" } }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
    });

    try {
      const res = await postLoopback(
        `${proxy.baseUrl}/responses`,
        {
          authorization: `Bearer ${proxy.proxyToken}`,
          "content-type": "application/json",
        },
        JSON.stringify({ input: [], max_output_tokens: 100 }),
      );
      expect(res.status).toBe(400);
      expect(proxy.usage()).toEqual({
        input_tokens: 0,
        output_tokens: 0,
        estimated_usd: 0,
      });
      expect(JSON.parse(await readFile(usageFile, "utf8"))).toEqual({
        input_tokens: 0,
        output_tokens: 0,
        estimated_usd: 0,
      });
    } finally {
      await proxy.close();
    }
  });
});

describe("self-heal Codex adapter end-to-end isolation", () => {
  it("strips real API/GitHub secrets from the Codex subprocess and settles usage via the loopback proxy", async () => {
    const dir = await makeTempDir("self-heal-codex-e2e-");
    const promptFile = join(dir, "prompt.md");
    const usageFile = join(dir, "usage.json");
    const envDumpFile = join(dir, "child-env.json");
    const fakeCodex = join(dir, "fake-codex.mjs");

    await writeFile(promptFile, "Repair provider parser drift.\n", "utf8");
    await writeFile(
      fakeCodex,
      [
        "#!/usr/bin/env node",
        "import { readFileSync, writeFileSync } from 'node:fs';",
        `const envDump = ${JSON.stringify(envDumpFile)};`,
        "const stdin = readFileSync(0, 'utf8');",
        "const providerArg = process.argv.find((a) => a.startsWith('model_providers.self_heal='));",
        'const baseUrl = providerArg?.match(/base_url="([^"]+)"/)?.[1];',
        "writeFileSync(envDump, JSON.stringify({",
        "  stdin,",
        "  hasSelfHealApiKey: 'SELF_HEAL_API_KEY' in process.env,",
        "  hasOpenAiApiKey: 'OPENAI_API_KEY' in process.env,",
        "  hasGhToken: 'GH_TOKEN' in process.env,",
        "  hasGithubToken: 'GITHUB_TOKEN' in process.env,",
        "  hasRunnerTemp: 'RUNNER_TEMP' in process.env,",
        "  codexHome: process.env.CODEX_HOME ?? null,",
        "  tmpdir: process.env.TMPDIR ?? null,",
        "  modelCatalog: process.argv.find((a) => a.startsWith('model_catalog_json=')) ?? null,",
        "  codexApiKey: process.env.CODEX_API_KEY ?? null,",
        "  baseUrl,",
        "}));",
        "const res = await fetch(`${baseUrl}/responses`, {",
        "  method: 'POST',",
        "  headers: { authorization: `Bearer ${process.env.CODEX_API_KEY}`, 'content-type': 'application/json' },",
        "  body: JSON.stringify({ input: [{ role: 'user', content: stdin }], max_output_tokens: 128 }),",
        "});",
        "if (!res.ok) process.exit(2);",
        "await res.text();",
      ].join("\n"),
      "utf8",
    );
    await chmod(fakeCodex, 0o755);

    const prevOpenAi = process.env.OPENAI_API_KEY;
    const prevGh = process.env.GH_TOKEN;
    process.env.OPENAI_API_KEY = "sk-parent-should-not-leak";
    process.env.GH_TOKEN = "ghp_parent_should_not_leak";

    try {
      const result = await runCodexAdapter({
        cwd: dir,
        apiKey: "sk-real-self-heal-key",
        promptFile,
        usageFile,
        codexBin: fakeCodex,
        pricingLookup: syntheticLookup,
        fetcher: async (_url, init) => {
          const headers = init?.headers as Record<string, string>;
          expect(headers.authorization).toBe("Bearer sk-real-self-heal-key");
          return new Response(
            buildCompletedSse({
              model: DEFAULT_CODEX_MODEL,
              inputTokens: 500,
              outputTokens: 100,
              cachedTokens: 0,
              cacheWriteTokens: 0,
            }),
            { status: 200, headers: { "content-type": "text/event-stream" } },
          );
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.budgetExceeded).toBe(false);
      expect(result.usage).toEqual({
        input_tokens: 500,
        output_tokens: 100,
        estimated_usd: 0.002,
      });

      const childEnv = JSON.parse(await readFile(envDumpFile, "utf8")) as Record<string, unknown>;
      expect(childEnv.hasSelfHealApiKey).toBe(false);
      expect(childEnv.hasOpenAiApiKey).toBe(false);
      expect(childEnv.hasGhToken).toBe(false);
      expect(childEnv.hasGithubToken).toBe(false);
      expect(childEnv.hasRunnerTemp).toBe(false);
      expect(childEnv.codexApiKey).not.toBe("sk-real-self-heal-key");
      // Codex TMPDIR is isolated inside runPrivateDir/tmp, distinct from CODEX_HOME, /tmp, and model catalog.
      const childTmp = String(childEnv.tmpdir);
      const childHome = String(childEnv.codexHome);
      expect(childTmp.endsWith("/tmp")).toBe(true);
      expect(childHome.endsWith("/home")).toBe(true);
      expect(dirname(childTmp)).toBe(dirname(childHome));
      expect(childTmp.startsWith("/tmp/")).toBe(false);
      expect(String(childEnv.modelCatalog)).toContain(`${dirname(childTmp)}/codex-model.json`);
      expect(String(childEnv.stdin)).toContain("Repair provider parser drift.");
    } finally {
      if (prevOpenAi === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevOpenAi;
      if (prevGh === undefined) delete process.env.GH_TOKEN;
      else process.env.GH_TOKEN = prevGh;
    }
  });

  it("rejects a tampered Linux x64 Codex archive when SHA-256 verification fails", async () => {
    const dir = await makeTempDir("self-heal-codex-sha-");
    const cacheRoot = join(dir, "codex-cache");
    const prevPath = process.env.PATH;
    process.env.PATH = "";
    try {
      await expect(
        resolveCodexBinary({
          cacheRoot,
          platform: "linux",
          arch: "x64",
          fetcher: async () => new Response("tampered-bytes", { status: 200 }),
        }),
      ).rejects.toThrow(/SHA-256 mismatch/);
    } finally {
      process.env.PATH = prevPath;
    }
  });

  it("builds isolated Codex exec and read-only sandbox arguments", () => {
    const args = buildCodexArgs({
      baseUrl: "http://127.0.0.1:4321/v1",
      model: DEFAULT_CODEX_MODEL,
      cwd: "/workspace",
      modelCatalogPath: "/private/codex-model.json",
    });
    expect(args).toContain('web_search="disabled"');
    expect(args).toContain("features.multi_agent=false");
    expect(args).toContain("--ignore-user-config");
    expect(args).toContain("--ephemeral");
    expect(args).toContain("workspace-write");
    expect(args).toContain('model_catalog_json="/private/codex-model.json"');

    const sandboxArgs = buildCodexSandboxArgs({
      cwd: "/workspace",
      command: ["vp", "node", "scripts/replay-catalog-evidence.ts", "openai-pricing"],
    });
    expect(sandboxArgs).toEqual([
      "sandbox",
      "-c",
      'permissions.ro.filesystem={":root"="read"}',
      "-c",
      "permissions.ro.network={enabled=false}",
      "-P",
      "ro",
      "-C",
      "/workspace",
      "--",
      "vp",
      "node",
      "scripts/replay-catalog-evidence.ts",
      "openai-pricing",
    ]);
  });

  it("feeds sandboxed candidate replay failures from attempt 1 into attempt 2 while keeping secrets and host files isolated", async () => {
    // 1. Unit checks on sanitizedUntrustedEnv, selfHealPrivateBaseDir, and isBuiltinCodexAdapterCommand.
    const clean = sanitizedUntrustedEnv({
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      GITHUB_ACTIONS: "true",
      SELF_HEAL_API_KEY: "sk-secret",
      OPENAI_API_KEY: "sk-openai",
      GH_TOKEN: "ghp_secret",
      GITHUB_TOKEN: "ghs_secret",
      AWS_ACCESS_KEY_ID: "AKIA...",
      AWS_SECRET_ACCESS_KEY: "aws-secret",
      GOOGLE_SERVICE_ACCOUNT_JSON: "{}",
    });
    expect(clean).toEqual({ PATH: "/usr/bin", HOME: "/tmp/home", GITHUB_ACTIONS: "true" });
    expect(isBuiltinCodexAdapterCommand("vp node scripts/self-heal/adapters/codex.ts")).toBe(true);
    expect(isBuiltinCodexAdapterCommand("node ./scripts/self-heal/adapters/codex.ts")).toBe(true);
    expect(isBuiltinCodexAdapterCommand("node scripts/self-heal/adapters/other.ts")).toBe(false);
    expect(selfHealPrivateBaseDir("runs").startsWith("/tmp/")).toBe(false);

    // 2. End-to-end check:
    //    - Attempt 1 produces a statically valid edit (only touching allowed `src/catalog/openai.ts`,
    //      leaving the parser broken!) and tampers with gitignored `node_modules/zod/index.js`.
    //    - `generate.ts` runs candidate replay inside `codex sandbox` (read-only, network-disabled,
    //      zero `SELF_HEAL_API_KEY`). Attempt 1's replay fails, so `generate.ts` does NOT emit
    //      `patch_ready` on attempt 1 and feeds the exact replay failure into attempt 2's prompt.
    //    - Attempt 2 runs in-process (never reloading tampered `node_modules/zod/index.js`), reads the
    //      replay failure feedback, fixes `src/catalog/openai.ts`, passes sandboxed replay, and emits
    //      `patch_ready` on attempt 2.
    const root = await makeTempDir("self-heal-isolation-");
    const repo = join(root, "repo");
    const ext = join(root, "ext");
    const replayEnvDump = join(ext, "replay-env.json");
    const sandboxInvocations = join(ext, "sandbox-invocations.jsonl");
    const promptAttempt2Dump = join(ext, "prompt-attempt-2.txt");
    const attemptCounter = join(ext, "codex-attempts.txt");
    const fakeCodexBin = join(ext, "fake-codex-bin.mjs");
    await mkdir(join(repo, "scripts/self-heal/adapters"), { recursive: true });
    await mkdir(join(repo, "node_modules/zod"), { recursive: true });
    await mkdir(join(repo, "src/catalog"), { recursive: true });
    await mkdir(join(ext, "evidence"), { recursive: true });

    await writeFile(
      join(repo, "scripts/replay-catalog-evidence.ts"),
      [
        "import { readFileSync, writeFileSync } from 'node:fs';",
        "import { join } from 'node:path';",
        `writeFileSync(${JSON.stringify(replayEnvDump)}, JSON.stringify({ hasKey: 'SELF_HEAL_API_KEY' in process.env }));`,
        "const parser = readFileSync(join(process.cwd(), 'src/catalog/openai.ts'), 'utf8');",
        "if (!parser.includes('FIXED_PARSER')) {",
        "  console.error('Simulated parse error on attempt 1');",
        "  process.exit(1);",
        "}",
        "console.log(JSON.stringify({ schema_version: 1, stage: 'parse', source_id: 'openai-pricing', models: [] }));",
      ].join("\n"),
      "utf8",
    );
    await writeFile(join(repo, ".gitignore"), "node_modules/\n", "utf8");
    await writeFile(join(repo, "src/catalog/openai.ts"), "export const v = 1;\n", "utf8");
    await writeFile(join(repo, "node_modules/zod/index.js"), "export const stub = true;\n", "utf8");

    await writeFile(
      fakeCodexBin,
      [
        "#!/usr/bin/env node",
        "import { spawnSync } from 'node:child_process';",
        "import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';",
        "import { join } from 'node:path';",
        `const counterPath = ${JSON.stringify(attemptCounter)};`,
        `const sandboxLog = ${JSON.stringify(sandboxInvocations)};`,
        `const prompt2Path = ${JSON.stringify(promptAttempt2Dump)};`,
        "if ('SELF_HEAL_API_KEY' in process.env) process.exit(91);",
        "if (process.argv[2] === 'sandbox') {",
        "  const sep = process.argv.indexOf('--');",
        "  const sandboxFlags = process.argv.slice(2, sep);",
        "  const cmd = process.argv.slice(sep + 1);",
        "  appendFileSync(sandboxLog, JSON.stringify({",
        "    flags: sandboxFlags,",
        "    cmd,",
        "    hasSelfHealApiKey: 'SELF_HEAL_API_KEY' in process.env,",
        "    hasRunnerTemp: 'RUNNER_TEMP' in process.env,",
        "    codexHome: process.env.CODEX_HOME ?? null,",
        "  }) + '\\n');",
        "  const child = spawnSync(cmd[0], cmd.slice(1), { stdio: 'inherit', env: process.env });",
        "  process.exit(child.status ?? 1);",
        "}",
        "const stdin = readFileSync(0, 'utf8');",
        "appendFileSync(counterPath, '1\\n');",
        "const attempt = readFileSync(counterPath, 'utf8').trim().split('\\n').length;",
        "const providerArg = process.argv.find((a) => a.startsWith('model_providers.self_heal='));",
        'const baseUrl = providerArg?.match(/base_url="([^"]+)"/)?.[1];',
        "const res = await fetch(`${baseUrl}/responses`, {",
        "  method: 'POST',",
        "  headers: { authorization: `Bearer ${process.env.CODEX_API_KEY}`, 'content-type': 'application/json' },",
        "  body: JSON.stringify({ input: [{ role: 'user', content: `attempt ${attempt}` }], max_output_tokens: 64 }),",
        "});",
        "if (!res.ok) process.exit(92);",
        "await res.text();",
        "if (attempt === 1) {",
        "  writeFileSync(join(process.cwd(), 'src/catalog/openai.ts'), 'export const v = 2; // still broken\\n');",
        "  writeFileSync(join(process.cwd(), 'node_modules/zod/index.js'), 'throw new Error(\"TAMPERED_ZOD\");\\n');",
        "} else {",
        "  writeFileSync(prompt2Path, stdin, 'utf8');",
        "  writeFileSync(join(process.cwd(), 'src/catalog/openai.ts'), 'export const v = 3; // FIXED_PARSER\\n');",
        "}",
      ].join("\n"),
      "utf8",
    );
    await chmod(fakeCodexBin, 0o755);

    const runGitIn = (args: string[]) => {
      const res = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
      if (res.status !== 0) throw new Error(res.stderr);
      return res.stdout.trim();
    };
    runGitIn(["init", "-q"]);
    runGitIn(["config", "user.email", "test@example.com"]);
    runGitIn(["config", "user.name", "Test"]);
    runGitIn(["add", "."]);
    runGitIn(["commit", "-q", "-m", "base"]);
    const baseSha = runGitIn(["rev-parse", "HEAD"]);

    const evidenceBytes = Buffer.from(JSON.stringify({ source_id: "openai-pricing" }), "utf8");
    const evidenceRel = "openai-pricing.json";
    const contextBytes = Buffer.from(JSON.stringify({ schema_version: 1, models: [] }), "utf8");
    const contextRel = "openai-pricing.context.json";
    await writeFile(join(ext, "evidence", evidenceRel), evidenceBytes);
    await writeFile(join(ext, "evidence", contextRel), contextBytes);
    const triageFile = join(ext, "target.json");
    await writeFile(
      triageFile,
      JSON.stringify({
        status: "actionable",
        target: {
          provider_id: "openai",
          quarantined: false,
          candidates: [
            {
              provider_id: "openai",
              scope: "source",
              subject_id: "openai-pricing",
              source_id: "openai-pricing",
              trigger: "source_contract_change",
              message: "drift",
              diagnostics: [],
            },
          ],
          evidence_files: [
            {
              source_id: "openai-pricing",
              relative_path: evidenceRel,
              source_hash: "a".repeat(64),
              sha256: sha256(evidenceBytes),
              context_relative_path: contextRel,
              context_sha256: sha256(contextBytes),
            },
          ],
        },
      }),
      "utf8",
    );

    const prevKey = process.env.SELF_HEAL_API_KEY;
    const prevCodexBin = process.env.SELF_HEAL_CODEX_BIN;
    process.env.SELF_HEAL_API_KEY = "sk-top-secret-must-never-leak-to-replay";
    process.env.SELF_HEAL_CODEX_BIN = fakeCodexBin;
    try {
      const genResult = await runGenerate({
        cwd: repo,
        triageFile,
        evidenceRoot: join(ext, "evidence"),
        outputDir: join(ext, "out"),
        agentCommand: "vp node scripts/self-heal/adapters/codex.ts",
        codexPricingLookup: syntheticLookup,
        codexFetcher: async () =>
          new Response(
            buildCompletedSse({
              model: DEFAULT_CODEX_MODEL,
              inputTokens: 100,
              outputTokens: 50,
              cachedTokens: 0,
              cacheWriteTokens: 0,
            }),
            { status: 200, headers: { "content-type": "text/event-stream" } },
          ),
      });
      expect(genResult.usage.error).toBeUndefined();
      expect(genResult.hasPatch).toBe(true);
      expect(genResult.usage.attempts).toBe(2);
      expect(genResult.usage.usage_known).toBe(true);
      expect(genResult.usage.input_tokens).toBe(200);
      expect(genResult.usage.output_tokens).toBe(100);

      // Verify attempt 2 received the exact sandboxed replay failure from attempt 1.
      const attempt2Prompt = await readFile(promptAttempt2Dump, "utf8");
      expect(attempt2Prompt).toContain(
        "Evidence replay failed for openai-pricing: Simulated parse error on attempt 1",
      );

      // Verify both replay runs went through read-only, network-disabled, secret-free `codex sandbox`.
      const sandboxCalls = (await readFile(sandboxInvocations, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(sandboxCalls).toHaveLength(2);
      for (const call of sandboxCalls) {
        expect(call.hasSelfHealApiKey).toBe(false);
        expect(call.hasRunnerTemp).toBe(false);
        expect(call.flags).toContain('permissions.ro.filesystem={":root"="read"}');
        expect(call.flags).toContain("permissions.ro.network={enabled=false}");
        expect(call.flags).toContain("ro");
      }

      // Verify direct runSelfHealGate (used in verify) also strips SELF_HEAL_API_KEY.
      runSelfHealGate({
        cwd: repo,
        base: baseSha,
        targetProvider: "openai",
        evidenceRoot: join(ext, "evidence"),
        evidenceFiles: [
          {
            source_id: "openai-pricing",
            relative_path: evidenceRel,
            source_hash: "a".repeat(64),
            sha256: sha256(evidenceBytes),
            context_relative_path: contextRel,
            context_sha256: sha256(contextBytes),
          },
        ],
        requireEvidenceReplay: true,
        skipValidation: true,
      });
      expect(JSON.parse(await readFile(replayEnvDump, "utf8"))).toEqual({ hasKey: false });

      // Verify pre-call config errors (missing SELF_HEAL_API_KEY and unsupported SELF_HEAL_MODEL)
      // emit verified $0 / attempts: 0 deferred usage receipts before any paid call so `publish`
      // never consumes paid budget or starts provider cooldown.
      const prevModel = process.env.SELF_HEAL_MODEL;
      try {
        delete process.env.SELF_HEAL_API_KEY;
        const missingKeyOut = join(ext, "out-missing-key");
        await expect(
          runGenerate({
            cwd: repo,
            triageFile,
            evidenceRoot: join(ext, "evidence"),
            outputDir: missingKeyOut,
            agentCommand: "vp node scripts/self-heal/adapters/codex.ts",
            codexPricingLookup: syntheticLookup,
          }),
        ).rejects.toThrow(/Missing SELF_HEAL_API_KEY/);
        expect(JSON.parse(await readFile(join(missingKeyOut, "usage.json"), "utf8"))).toMatchObject(
          {
            status: "deferred",
            usage_known: true,
            input_tokens: 0,
            output_tokens: 0,
            estimated_usd: 0,
            attempts: 0,
          },
        );

        process.env.SELF_HEAL_API_KEY = "sk-top-secret-must-never-leak-to-replay";
        process.env.SELF_HEAL_MODEL = "gpt-5-mini-2025-08-07";
        const badModelOut = join(ext, "out-bad-model");
        await expect(
          runGenerate({
            cwd: repo,
            triageFile,
            evidenceRoot: join(ext, "evidence"),
            outputDir: badModelOut,
            agentCommand: "vp node scripts/self-heal/adapters/codex.ts",
            codexPricingLookup: syntheticLookup,
          }),
        ).rejects.toThrow(/Unsupported SELF_HEAL_MODEL/);
        expect(JSON.parse(await readFile(join(badModelOut, "usage.json"), "utf8"))).toMatchObject({
          status: "deferred",
          usage_known: true,
          input_tokens: 0,
          output_tokens: 0,
          estimated_usd: 0,
          attempts: 0,
        });
      } finally {
        if (prevModel === undefined) delete process.env.SELF_HEAL_MODEL;
        else process.env.SELF_HEAL_MODEL = prevModel;
      }
    } finally {
      if (prevKey === undefined) delete process.env.SELF_HEAL_API_KEY;
      else process.env.SELF_HEAL_API_KEY = prevKey;
      if (prevCodexBin === undefined) delete process.env.SELF_HEAL_CODEX_BIN;
      else process.env.SELF_HEAL_CODEX_BIN = prevCodexBin;
    }
  });
});
