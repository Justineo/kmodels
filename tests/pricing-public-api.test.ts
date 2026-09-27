import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import {
  createCalculator,
  validatePriceData,
  type CalculationEnvelope,
} from "../src/pricing/index.ts";
import { conformanceSchema } from "./pricing-conformance.ts";

const suite = conformanceSchema.parse(
  JSON.parse(
    readFileSync(new URL("./fixtures/calculator/conformance.json", import.meta.url), "utf8"),
  ),
);
function dataset(name: string) {
  return validatePriceData(suite.datasets[name]);
}
function offer(data: CalculationEnvelope) {
  const value = data.providers[0]?.books[0]?.offers[0];
  if (value === undefined) throw new Error("Missing fixture offer");
  return value;
}
function rate(data: CalculationEnvelope) {
  const term = offer(data).terms[0];
  if (term?.kind !== "rate" || term.variants[0] === undefined)
    throw new Error("Missing fixture rate");
  return term.variants[0];
}
function request(name: string) {
  const value = suite.cases.find((entry) => entry.dataset === name)?.request;
  if (value === undefined) throw new Error("Missing fixture request");
  return structuredClone(value);
}
function mappedTier() {
  const data = dataset("tier");
  const variant = rate(data);
  const condition = variant.applicability.any_of[0]?.all_of[0];
  if (condition?.kind !== "categorical" || condition.values[0] === undefined)
    throw new Error("Missing tier condition");
  const entry = { source_value: "standard", value: condition.values[0] };
  const source = {
    dimension: condition.dimension,
    channel: "response" as const,
    locator: { kind: "json_pointer" as const, value: "/served_tier" },
    availability: "terminal_only" as const,
    absent_value: condition.values[0],
    normalization: {
      kind: "categorical_map" as const,
      entries: [entry],
    },
    evidence: structuredClone(variant.evidence),
  };
  variant.selector_sources = [source];
  return { data, variant, source, entry };
}

describe("public pricing contracts", () => {
  it("preserves scoped selector acquisition contracts and isolates discovery copies", () => {
    const { data, variant, source } = mappedTier();
    const calc = createCalculator(data);
    const requirements = calc.requirements({ offerRef: offer(data).id });
    const found = requirements.charges.find(
      (charge) => charge.kind === "rate" && charge.selectorSources.length > 0,
    );
    if (found?.kind !== "rate") throw new Error("Missing selector contract");
    expect(found.selectorSources).toEqual([source]);
    expect(found.applicability).toEqual(variant.applicability);
    found.selectorSources.splice(0);
    expect(calc.requirements({ offerRef: offer(data).id }).charges).toContainEqual(
      expect.objectContaining({ kind: "rate", selectorSources: [source] }),
    );
  });

  it("keeps referenced rate mappings qualified within contribution requirements", () => {
    const { data: tier, variant } = mappedTier();
    const data = dataset("contribution");
    const provider = data.providers[0];
    const tierProvider = tier.providers[0];
    const target = provider?.books[0]?.offers[1]?.terms[0];
    if (provider === undefined || tierProvider === undefined || target?.kind !== "rate")
      throw new Error("Missing referenced rate");
    provider.vocabulary = tierProvider.vocabulary;
    target.variants = [variant];
    const found = createCalculator(data)
      .requirements({ offerRef: offer(data).id })
      .charges.find((charge) => charge.kind === "contribution");
    if (found?.kind !== "contribution") throw new Error("Missing contribution requirements");
    expect(found.referencedRates).toEqual([
      {
        rateTermRef: target.id,
        applicability: variant.applicability,
        selectorSources: variant.selector_sources,
      },
    ]);
  });

  it("exposes allowance semantics and known unsupported resets before collecting usage", () => {
    const data = dataset("monthly-allowance");
    const requirements = createCalculator(data).requirements({ offerRef: offer(data).id });
    const term = offer(data).terms.find((term) => term.kind === "allowance");
    const variant = term?.variants[0];
    if (term === undefined || variant === undefined) throw new Error("Missing allowance");
    expect(requirements.charges).toContainEqual(
      expect.objectContaining({
        kind: "allowance",
        reset: variant.reset,
        benefit: variant.benefit,
        target: variant.target,
      }),
    );
    expect(requirements.gaps).toContainEqual(
      expect.objectContaining({ termRef: term.id, code: "unsupported_aggregation" }),
    );
  });

  it("reports unsupported rate substitution during discovery", () => {
    const data = dataset("quantity-allowance");
    const terms = offer(data).terms;
    const allowance = terms.find((term) => term.kind === "allowance")?.variants[0];
    const input = terms[0];
    const output = terms[2];
    if (allowance === undefined || input === undefined || output === undefined)
      throw new Error("Missing terms");
    allowance.benefit = {
      kind: "rate_substitution",
      replaced_term_refs: [input.id],
      replacement_term_refs: [output.id],
    };
    expect(createCalculator(data).requirements({ offerRef: offer(data).id }).gaps).toContainEqual(
      expect.objectContaining({ code: "unsupported_structure" }),
    );
  });

  const invalidMappings: Array<[string, (fixture: ReturnType<typeof mappedTier>) => void]> = [
    [
      "foreign mapped value",
      ({ entry }) => {
        entry.value = { namespace: "provider", provider_id: "foreign", value: "standard" };
      },
    ],
    [
      "unregistered mapped value",
      ({ entry }) => {
        entry.value = { namespace: "provider", provider_id: "example", value: "unregistered" };
      },
    ],
    [
      "value outside variant scope",
      ({ entry }) => {
        entry.value = { namespace: "provider", provider_id: "example", value: "priority" };
      },
    ],
    [
      "foreign absent value",
      ({ source }) => {
        source.absent_value = { namespace: "provider", provider_id: "foreign", value: "standard" };
      },
    ],
    [
      "unrelated dimension",
      ({ source }) => {
        source.dimension = { namespace: "kmodels", value: "region" };
      },
    ],
    [
      "duplicate source input",
      ({ source, entry }) => {
        source.normalization.entries.push(structuredClone(entry));
      },
    ],
  ];
  it.each(invalidMappings)("rejects %s at initialization", (_name, change) => {
    const fixture = mappedTier();
    change(fixture);
    expect(() => createCalculator(fixture.data)).toThrowError(
      expect.objectContaining({ code: "INVALID_DATA" }),
    );
  });

  it("itemizes the applied price, binding and contribution evidence without changing amounts", () => {
    const data = dataset("contribution");
    const term = offer(data).terms.find((term) => term.kind === "contribution");
    const contribution = term?.variants[0];
    const binding = contribution?.charge_bindings[0];
    const target = data.providers[0]?.books[0]?.offers[1]?.terms[0];
    if (
      term === undefined ||
      contribution === undefined ||
      binding === undefined ||
      target?.kind !== "rate" ||
      target.variants[0] === undefined
    )
      throw new Error("Missing contribution");
    const evidence = (value: string) => [
      { source_ref: "example/source", locator: { kind: "table" as const, value } },
    ];
    contribution.evidence = evidence("contribution");
    binding.evidence = evidence("binding");
    target.variants[0].evidence = evidence("rate");
    const calc = createCalculator(data);
    const result = calc.calculate(request("contribution"));
    const charge = result.charges.find((charge) => charge.termRef === term.id);
    if (charge === undefined) throw new Error("Missing contribution charge");
    expect(charge.evidence.map(({ locator }) => locator.value).sort()).toEqual([
      "binding",
      "contribution",
      "rate",
    ]);
    expect(charge.unitPrice).toEqual(target.variants[0].price);
    expect(charge.binding).toEqual(binding);
    expect(result.totals).toEqual(
      createCalculator(dataset("contribution")).calculate(request("contribution")).totals,
    );
    charge.unitPrice.value.numerator = "999";
    charge.binding.quantity_methods = [];
    expect(calc.calculate(request("contribution")).totals).toEqual(result.totals);
  });
});
