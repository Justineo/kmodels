import { describe, expect, it } from "vite-plus/test";
import { unconditionalApplicability } from "../src/catalog/pricing-canonical.ts";
import {
  pricingBookId,
  pricingOfferId,
  pricingTermId,
} from "../src/catalog/pricing-identifiers.ts";
import {
  displayUnitPrice,
  evaluateApplicability,
  fixedOfferStateSelections,
  formatBillingMode,
  formatDenomination,
  formatDimension,
  formatUnitExpression,
  modelPricingView,
  projectPricingTableCell,
} from "../src/catalog/pricing-presentation.ts";
import type {
  PriceApplicability,
  PriceRateTerm,
  PricingCatalog,
  UnitPrice,
} from "../src/catalog/pricing-schema.ts";
import type { ProviderModel } from "../src/catalog/schema.ts";

const providerId = "test";
const modelRef = "test/model";
const sourceRef = "test-pricing";
const bookId = pricingBookId(providerId, "public");
const offerId = pricingOfferId(bookId, "usage");
const observedAt = "2026-07-28T00:00:00.000Z";
const source = {
  source_ref: sourceRef,
  locator: { kind: "table" as const, value: "row" },
  raw: { label: "Price" },
  establishes_applicability: unconditionalApplicability,
};

function model(): ProviderModel {
  return {
    provider_id: providerId,
    model_id: "model",
    uid: modelRef,
    id_kind: "api_id",
    name: "Model",
    aliases: [],
    tasks: ["text_generation"],
    modalities: { input: ["text"], output: ["text"] },
    capabilities: {
      reasoning: "unknown",
      tool_call: "unknown",
      structured_output: "unknown",
      streaming: "unknown",
      batch: "unknown",
      prompt_cache: "unknown",
      fine_tuning: "unknown",
      citations: "unknown",
      code_execution: "unknown",
      context_management: "unknown",
      effort_control: "unknown",
      computer_use: "unknown",
    },
    limits: {},
    status: "active",
    release_stage: "stable",
    replacement_model_ids: [],
    scope: "global_catalog",
    account_availability: "unknown",
    first_seen_at: observedAt,
    last_seen_at: observedAt,
    observed_at: observedAt,
    source_refs: [sourceRef],
  };
}

function term(
  key: string,
  meter: "input_text" | "input_audio",
  price: UnitPrice,
  applicability = unconditionalApplicability,
): PriceRateTerm {
  return {
    id: pricingTermId(offerId, key),
    term_key: key,
    kind: "rate",
    meter: { namespace: "kmodels", value: meter },
    source_refs: [sourceRef],
    variants: [
      {
        price,
        applicability,
        observations: [{ ...source, establishes_applicability: applicability }],
      },
    ],
    raw_variants: [],
  };
}

function catalog(terms: PriceRateTerm[]): PricingCatalog {
  return {
    provider_vocabularies: [{ provider_id: providerId, atoms: [] }],
    provider_snapshots: [
      { provider_id: providerId, observed_at: observedAt, publication: "fresh" },
    ],
    model_dispositions: [],
    books: [
      {
        id: bookId,
        provider_id: providerId,
        book_key: "public",
        scope: { kind: "models", model_refs: [modelRef] },
        scope_observations: [
          {
            source_ref: sourceRef,
            locator: { kind: "table", value: "heading" },
            establishes: { kind: "models", model_refs: [modelRef] },
            raw: { label: "Pricing" },
          },
        ],
        offers: [
          {
            id: offerId,
            offer_key: "usage",
            role: "base",
            billing_mode: { namespace: "kmodels", value: "usage" },
            states: [
              {
                state: "numeric",
                applicability: unconditionalApplicability,
                observations: [source],
              },
            ],
            terms,
            source_refs: [sourceRef],
          },
        ],
        source_refs: [sourceRef],
      },
    ],
  };
}

function categoricalScope(
  dimension: "region" | "service_tier",
  ...values: string[]
): PriceApplicability {
  return {
    any_of: values.map((value) => ({
      all_of: [
        {
          kind: "categorical",
          dimension: { namespace: "kmodels", value: dimension },
          values: [{ namespace: "kmodels", value }],
        },
      ],
    })),
  };
}

function setNumericScope(data: PricingCatalog, applicability: PriceApplicability) {
  const offer = data.books[0]?.offers[0];
  const state = offer?.states[0];
  const observation = state?.observations[0];
  if (offer === undefined || state === undefined || observation === undefined)
    throw new Error("Missing test offer state");
  state.applicability = applicability;
  observation.establishes_applicability = applicability;
  return offer;
}

const tokenPrice: UnitPrice = {
  value: { numerator: "1", denominator: "500000" },
  denomination: { kind: "fiat", currency: "USD" },
  per: {
    factors: [{ unit: { namespace: "kmodels", value: "token" }, power: 1 }],
  },
};

describe("canonical pricing presentation", () => {
  it("uses concise labels for unit-bearing dimensions", () => {
    expect(formatDimension({ namespace: "kmodels", value: "cache_ttl_seconds" })).toBe("Cache TTL");
    expect(formatDimension({ namespace: "kmodels", value: "context_tokens" })).toBe("Context");
  });

  it("short-circuits partial OR selectors and reports only live missing dimensions", () => {
    const selector: PriceApplicability = {
      any_of: [
        {
          all_of: [
            {
              kind: "categorical",
              dimension: { namespace: "kmodels", value: "region" },
              values: [{ namespace: "kmodels", value: "US" }],
            },
          ],
        },
        {
          all_of: [
            {
              kind: "categorical",
              dimension: { namespace: "kmodels", value: "service_tier" },
              values: [{ namespace: "kmodels", value: "batch" }],
            },
          ],
        },
      ],
    };
    expect(
      evaluateApplicability(selector, [
        {
          kind: "categorical",
          dimension: { namespace: "kmodels", value: "region" },
          value: { namespace: "kmodels", value: "US" },
        },
      ]),
    ).toEqual({ state: "true", missing_dimensions: [] });
    expect(
      evaluateApplicability(selector, [
        {
          kind: "categorical",
          dimension: { namespace: "kmodels", value: "region" },
          value: { namespace: "kmodels", value: "EU" },
        },
      ]),
    ).toEqual({
      state: "missing",
      missing_dimensions: [{ namespace: "kmodels", value: "service_tier" }],
    });
  });

  it("rejects decimal selections outside the canonical numeric bound", () => {
    expect(() =>
      evaluateApplicability(unconditionalApplicability, [
        {
          kind: "decimal",
          dimension: { namespace: "kmodels", value: "duration_seconds" },
          value: `0.${"0".repeat(127)}1`,
          unit: { factors: [] },
        },
      ]),
    ).toThrow("exact-integer digit limit");
  });

  it("formats exact namespace-qualified values without approximation", () => {
    expect(
      formatBillingMode({
        namespace: "provider",
        provider_id: "test",
        value: "committed",
      }),
    ).toBe('provider-billing-mode("test","committed")');
    expect(
      formatDenomination({
        kind: "provider_credit",
        provider_id: "test",
        code: "credit",
      }),
    ).toBe('provider-credit("test","credit")');
    expect(formatUnitExpression({ factors: [] })).toBe("dimensionless");
    expect(
      formatUnitExpression({
        factors: [
          {
            unit: { namespace: "provider", provider_id: "test", value: "unit" },
            power: 2,
          },
        ],
      }),
    ).toBe('provider-unit("test","unit")^2');
  });

  it("projects one exact unconditional rate and scales only token power one", () => {
    const data = catalog([term("input", "input_text", tokenPrice)]);
    expect(displayUnitPrice(tokenPrice)).toEqual({
      amount: "$2",
      displayUnit: "1M tokens",
      accessibleText: "USD 2 per 1M tokens",
    });
    expect(
      displayUnitPrice({
        ...tokenPrice,
        value: { numerator: "9".repeat(128), denominator: "1" },
      }),
    ).toMatchObject({
      amount: `$${"9".repeat(128)}`,
      displayUnit: "token",
    });
    expect(modelPricingView(data, model()).outcome).toBe("offers");
    expect(projectPricingTableCell(data, model(), "input")).toMatchObject({
      meter: "input_text",
      amount: "$2",
      displayUnit: "1M tokens",
      accessibleText: "input_text: USD 2 per 1M tokens",
      showTooltip: false,
    });

    const squared = structuredClone(tokenPrice);
    squared.per.factors[0]!.power = 2;
    expect(
      projectPricingTableCell(catalog([term("squared", "input_text", squared)]), model(), "input"),
    ).toMatchObject({ amount: "$0.000002", displayUnit: "token^2" });
  });

  it("keeps token table rates comparable while details may use the source scale", () => {
    const observations = ["0.0020000000", "0.0020"].map((amount) => ({
      ...source,
      raw: {
        amount,
        denomination: "USD",
        unit: "per 1K tokens",
      },
    }));
    expect(displayUnitPrice(tokenPrice, observations)).toEqual({
      amount: "$2",
      displayUnit: "1M tokens",
      accessibleText: "USD 2 per 1M tokens",
    });
    expect(displayUnitPrice(tokenPrice, observations, { tokenDisplay: "source" })).toEqual({
      amount: "$0.002",
      displayUnit: "1K tokens",
      accessibleText: "USD 0.002 per 1K tokens",
    });
  });

  it("binds a categorical context when the offer has only one possible value", () => {
    const batch = categoricalScope("service_tier", "batch");
    const data = catalog([term("input", "input_text", tokenPrice, batch)]);
    const offer = setNumericScope(data, batch);

    expect(fixedOfferStateSelections(offer, modelRef)).toEqual([
      {
        dimension: { namespace: "kmodels", value: "service_tier" },
        kind: "categorical",
        value: { namespace: "kmodels", value: "batch" },
      },
    ]);
    expect(projectPricingTableCell(data, model(), "input")).toMatchObject({
      amount: "$2",
      displayUnit: "1M tokens",
    });
  });

  it("projects a context-qualified rate when one exact price covers the numeric offer scope", () => {
    const regional = categoricalScope("region", "US", "EU");
    const data = catalog([term("input", "input_text", tokenPrice, regional)]);
    setNumericScope(data, regional);

    expect(projectPricingTableCell(data, model(), "input")).toMatchObject({
      amount: "$2",
      displayUnit: "1M tokens",
    });
  });

  it("keeps validity-qualified uniform prices out of the representative table", () => {
    const data = catalog([term("input", "input_text", tokenPrice)]);
    const offer = data.books[0]!.offers[0]!;
    const input = offer.terms[0];
    if (input?.kind !== "rate") throw new Error("Missing input rate");
    const validity = {
      from: { value: "2026-07-01", precision: "date" as const },
    };
    offer.states[0]!.validity = validity;
    input.variants[0]!.validity = validity;

    expect(projectPricingTableCell(data, model(), "input")).toBeUndefined();
  });

  it("withholds a uniform candidate price that does not cover the numeric offer scope", () => {
    const us = categoricalScope("region", "US");
    const data = catalog([term("input", "input_text", tokenPrice, us)]);
    setNumericScope(data, categoricalScope("region", "US", "EU"));

    expect(projectPricingTableCell(data, model(), "input")).toBeUndefined();
  });

  it("withholds context-qualified variants that disagree on exact price", () => {
    const us = categoricalScope("region", "US");
    const eu = categoricalScope("region", "EU");
    const data = catalog([term("input", "input_text", tokenPrice, us)]);
    const offer = setNumericScope(data, categoricalScope("region", "US", "EU"));
    const input = offer.terms[0];
    if (input?.kind !== "rate") throw new Error("Missing input rate");
    input.variants.push({
      price: {
        ...tokenPrice,
        value: { numerator: "3", denominator: "1000000" },
      },
      applicability: eu,
      observations: [{ ...source, establishes_applicability: eu }],
    });

    expect(projectPricingTableCell(data, model(), "input")).toBeUndefined();
  });

  it("uses exact decimals and visibly marked decimal approximations", () => {
    const capacityPrice: UnitPrice = {
      value: { numerator: "99", denominator: "500" },
      denomination: { kind: "fiat", currency: "USD" },
      per: {
        factors: [
          {
            unit: {
              namespace: "provider",
              provider_id: providerId,
              value: "1k_tpm_hour",
            },
            power: 1,
          },
        ],
      },
    };
    expect(
      projectPricingTableCell(
        catalog([term("capacity", "input_text", capacityPrice)]),
        model(),
        "input",
      ),
    ).toMatchObject({
      amount: "$0.198",
      displayUnit: "1K TPM·hr",
      accessibleText: 'input_text: USD 0.198 per provider-unit("test","1k_tpm_hour")',
      showTooltip: true,
    });
    expect(
      displayUnitPrice({
        ...capacityPrice,
        value: { numerator: "3", denominator: "40" },
      }),
    ).toMatchObject({ amount: "$0.075" });
    expect(
      displayUnitPrice({
        ...capacityPrice,
        value: { numerator: "1", denominator: "3" },
      }),
    ).toMatchObject({
      amount: "$0.333333333333…",
      accessibleText: 'approximately USD 0.333333333333 per provider-unit("test","1k_tpm_hour")',
    });
  });

  it("prefers source-native fixed units and never exposes canonical fractions", () => {
    const minutePrice: UnitPrice = {
      value: { numerator: "17", denominator: "30000" },
      denomination: { kind: "fiat", currency: "USD" },
      per: {
        factors: [{ unit: { namespace: "kmodels", value: "second" }, power: 1 }],
      },
    };
    const minuteObservation = {
      ...source,
      raw: {
        amount: "0.034",
        denomination: "USD",
        unit: "Per minute",
        meter: "input_audio",
      },
    };
    expect(displayUnitPrice(minutePrice, [minuteObservation])).toEqual({
      amount: "$0.034",
      displayUnit: "minute",
      accessibleText: "USD 0.034 per minute",
    });
    expect(
      displayUnitPrice(minutePrice, [
        minuteObservation,
        {
          ...source,
          raw: { amount: "2.04", denomination: "USD", unit: "per hour" },
        },
      ]),
    ).toEqual({
      amount: "$0.034",
      displayUnit: "minute",
      accessibleText: "USD 0.034 per minute",
    });

    const data = catalog([term("audio", "input_audio", minutePrice)]);
    const audio = data.books[0]!.offers[0]!.terms[0];
    if (audio?.kind !== "rate") throw new Error("Missing audio rate");
    audio.variants[0]!.observations = [minuteObservation];
    expect(projectPricingTableCell(data, model(), "input")).toMatchObject({
      amount: "$0.034",
      displayUnit: "minute",
    });

    const storagePrice: UnitPrice = {
      value: { numerator: "1", denominator: "3600000000" },
      denomination: { kind: "fiat", currency: "USD" },
      per: {
        factors: [
          { unit: { namespace: "kmodels", value: "second" }, power: 1 },
          { unit: { namespace: "kmodels", value: "token" }, power: 1 },
        ],
      },
    };
    expect(displayUnitPrice(storagePrice)).toEqual({
      amount: "$1",
      displayUnit: "1M tokens·hour",
      accessibleText: "USD 1 per 1M tokens·hour",
    });
  });

  it("stops at a present conditional higher-priority meter", () => {
    const regional: PriceApplicability = {
      any_of: [
        {
          all_of: [
            {
              kind: "categorical",
              dimension: { namespace: "kmodels", value: "region" },
              values: [{ namespace: "kmodels", value: "US" }],
            },
          ],
        },
      ],
    };
    const data = catalog([
      term("text", "input_text", tokenPrice, regional),
      term("audio", "input_audio", {
        value: { numerator: "1", denominator: "20" },
        denomination: { kind: "fiat", currency: "USD" },
        per: {
          factors: [{ unit: { namespace: "kmodels", value: "second" }, power: 1 }],
        },
      }),
    ]);
    expect(projectPricingTableCell(data, model(), "input")).toBeUndefined();
  });

  it("gives an exact negative disposition precedence over matching books", () => {
    const data = catalog([term("input", "input_text", tokenPrice)]);
    data.model_dispositions.push({
      model_ref: modelRef,
      state: "not_applicable",
      observations: [
        {
          source_ref: sourceRef,
          locator: { kind: "table", value: "row" },
          establishes_model_ref: modelRef,
          raw: { label: "Not offered" },
        },
      ],
    });
    expect(modelPricingView(data, model())).toMatchObject({
      outcome: "not_applicable",
      books: [],
      baseOffers: [],
    });
  });
});
