import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import {
  createCalculator,
  PricingError,
  type Calculator,
  type CalculationEnvelope,
  type CalculationOffer,
  type CalculationRequest,
  type CalculationTerm,
} from "../src/pricing/index.ts";
import { conformanceSchema } from "./pricing-conformance.ts";

const conformance = conformanceSchema.parse(
  JSON.parse(
    readFileSync(new URL("./fixtures/calculator/conformance.json", import.meta.url), "utf8"),
  ),
);
function basePriceData(): CalculationEnvelope {
  const base = conformance.datasets["base"];
  if (base === undefined) throw new Error("Missing base vector");
  return structuredClone(base);
}
function firstOffer(envelope: CalculationEnvelope): CalculationOffer {
  const offer = envelope.providers[0]?.books[0]?.offers[0];
  if (offer === undefined) throw new Error("Missing fixture offer");
  return offer;
}
function firstRateTerm(envelope: CalculationEnvelope): Extract<CalculationTerm, { kind: "rate" }> {
  const term = firstOffer(envelope).terms[0];
  if (term?.kind !== "rate") throw new Error("Missing fixture rate");
  return term;
}
function baseCalculationRequest(): CalculationRequest {
  const vector = conformance.cases[0];
  if (vector === undefined) throw new Error("Missing request vector");
  return structuredClone(vector.request);
}
function firstComponent(input: CalculationRequest) {
  const component = input.components[0];
  if (component === undefined) throw new Error("Missing fixture component");
  return component;
}
function expectPricingError(action: () => unknown, code: PricingError["code"]): void {
  try {
    action();
    throw new Error("Expected rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(PricingError);
    if (error instanceof PricingError) expect(error.code).toBe(code);
  }
}
describe("portable conformance", () => {
  for (const vector of conformance.errors)
    it(vector.name, () =>
      expectPricingError(() => {
        const calculator = createCalculator(
          vector.data ?? conformance.datasets[vector.dataset ?? ""],
        );
        if (vector.request !== undefined) {
          calculateUnvalidatedRequest(calculator, vector.request);
        }
      }, vector.expectedCode),
    );
  for (const vector of conformance.cases)
    it(vector.name, () => {
      const result = createCalculator(conformance.datasets[vector.dataset]).calculate(
        vector.request,
      );
      expect(result.status).toBe(vector.expected.status);
      expect(result.subtotals).toEqual(vector.expected.subtotals);
      expect([...new Set(result.unresolved.map(({ code }) => code))].sort()).toEqual(
        vector.expected.unresolvedCodes.toSorted(),
      );
      expect(result.totals !== undefined).toBe(
        result.status === "calculated" || result.status === "estimated",
      );
    });
});
describe("calculator boundaries", () => {
  it("owns an isolated snapshot and allows atomic instance replacement", () => {
    const supplied = basePriceData();
    const old = createCalculator(supplied);
    const variant = firstRateTerm(supplied).variants[0];
    if (variant === undefined) throw new Error("Missing rate");
    variant.price.value = { numerator: "1", denominator: "500" };
    expect(old.calculate(baseCalculationRequest()).totals).not.toEqual(
      createCalculator(supplied).calculate(baseCalculationRequest()).totals,
    );
    const returned = old.listOffers();
    returned[0]?.offer.terms.splice(0);
    expect(old.listOffers()[0]?.offer.terms.length).toBe(3);
    expect(old.listOffers({ modelRef: "example/missing" })).toEqual([]);
  });
  it("discovers alternatives and aggregation without choosing an offer", () => {
    const calculator = createCalculator(basePriceData());
    const offers = calculator.listOffers({ modelRef: "example/model" });
    expect(offers).toHaveLength(1);
    const selected = offers[0];
    if (selected === undefined) throw new Error("Missing offer");
    const requirements = calculator.requirements({ offerRef: selected.offer.id });
    expect(requirements.aggregationBoundaries).toEqual(["request"]);
    expect(requirements.charges[0]?.alternatives).toEqual([
      [
        { namespace: "kmodels", value: "cached_input_tokens" },
        { namespace: "kmodels", value: "input_tokens" },
      ],
    ]);
  });
  it("rejects unsupported schemas, dangling links, invalid rationals and incompatible units", () => {
    expectPricingError(
      () => createCalculator({ ...basePriceData(), schemaVersion: "2.0" }),
      "UNSUPPORTED_SCHEMA",
    );
    const broken = basePriceData();
    firstOffer(broken).relations.push({
      kind: "incurs",
      target: { kind: "offers", offer_refs: ["f".repeat(64)] },
      applicability: { any_of: [{ all_of: [] }] },
      evidence: [{ source_ref: "example/source", locator: { kind: "table", value: "synthetic" } }],
    });
    expectPricingError(() => createCalculator(broken), "INVALID_DATA");
    const incompatible = basePriceData();
    const variant = firstRateTerm(incompatible).variants[0];
    if (variant === undefined) throw new Error("Missing rate");
    variant.price.per = {
      factors: [{ unit: { namespace: "kmodels", value: "second" }, power: 1 }],
    };
    expectPricingError(() => createCalculator(incompatible), "INVALID_DATA");
    variant.price.value = { numerator: "2", denominator: "4" };
    expectPricingError(() => createCalculator(incompatible), "INVALID_DATA");
  });
  it("rejects duplicate component IDs, signals, unknown signals and assumptions overriding measurements", () => {
    const calculator = createCalculator(basePriceData());
    const duplicate = baseCalculationRequest();
    duplicate.components.push(structuredClone(firstComponent(duplicate)));
    expectPricingError(() => calculator.calculate(duplicate), "DUPLICATE_COMPONENT");
    const inputs = baseCalculationRequest();
    const component = firstComponent(inputs);
    const quantity = component.quantities[0];
    if (quantity === undefined) throw new Error("Missing quantity");
    component.quantities.push(quantity);
    expectPricingError(() => calculator.calculate(inputs), "DUPLICATE_SIGNAL");
    component.quantities.pop();
    component.assumptions = [{ kind: "quantity", quantity, explanation: "Must not overwrite" }];
    expectPricingError(() => calculator.calculate(inputs), "ASSUMPTION_CONFLICT");
    component.assumptions = [];
    component.quantities.push({
      signal: { namespace: "kmodels", value: "generated_images" },
      value: { numerator: "1", denominator: "1" },
    });
    expectPricingError(() => calculator.calculate(inputs), "INCOMPATIBLE_QUANTITY");
  });
  it("does not choose between context prices until a selector is supplied", () => {
    const supplied = basePriceData();
    const term = firstRateTerm(supplied);
    const lower = term.variants[0];
    if (lower === undefined) throw new Error("Missing rate");
    const upper = structuredClone(lower);
    lower.applicability = {
      any_of: [
        {
          all_of: [
            {
              kind: "decimal_range",
              dimension: { namespace: "kmodels", value: "context_tokens" },
              unit: lower.price.per,
              upper: { value: "200000", inclusive: true },
            },
          ],
        },
      ],
    };
    upper.applicability = {
      any_of: [
        {
          all_of: [
            {
              kind: "decimal_range",
              dimension: { namespace: "kmodels", value: "context_tokens" },
              unit: upper.price.per,
              lower: { value: "200000", inclusive: false },
            },
          ],
        },
      ],
    };
    upper.price.value = { numerator: "1", denominator: "500" };
    term.variants.push(upper);
    const calculator = createCalculator(supplied);
    expect(calculator.calculate(baseCalculationRequest()).status).toBe("partial");
    const selected = baseCalculationRequest();
    firstComponent(selected).selectors = [
      {
        kind: "decimal",
        dimension: { namespace: "kmodels", value: "context_tokens" },
        unit: lower.price.per,
        value: "200000",
      },
    ];
    expect(calculator.calculate(selected).totals).toEqual(
      createCalculator(basePriceData()).calculate(baseCalculationRequest()).totals,
    );
    upper.price.value = lower.price.value;
    expect(createCalculator(supplied).calculate(baseCalculationRequest()).status).toBe(
      "calculated",
    );
  });
});

function calculateUnvalidatedRequest(calculator: Calculator, input: unknown): unknown {
  return Reflect.apply(calculator.calculate, calculator, [input]);
}
