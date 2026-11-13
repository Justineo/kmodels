import { expect, it, vi } from "vite-plus/test";
import { matchInferencePrices } from "../src/pricing/inference-matching.ts";
import * as selection from "../src/pricing/selection.ts";
import {
  pricingPerformanceFixture,
  commercialChoice,
  fixtureInstant,
} from "./performance/pricing-fixture.ts";

it.each([24, 48])("bounds full matcher row work for %i regional tariffs", (regions) => {
  const data = pricingPerformanceFixture(regions).prices[0]?.matching;
  if (data === undefined) throw new Error("Missing fixture matching data");
  const rows = data.offers.flatMap((offer) => offer.terms.flatMap((term) => term.variants)).length;
  const validate = vi.spyOn(selection, "validateSelectors");
  try {
    for (const tier of ["priority", "standard", "flex", "priority"]) {
      validate.mockClear();
      const result = matchInferencePrices(data, [], fixtureInstant, undefined, undefined, [
        commercialChoice("service_tier", tier),
      ]);
      expect(result.candidates.length).toBeGreaterThan(0);
      expect(result.unresolved_choices).toEqual([]);
      const visits = validate.mock.calls.reduce((sum, [, scopes]) => sum + scopes.length, 0);
      // Standard also probes both speeds; regional claim count must not add more passes.
      const passes = tier === "standard" ? 8 : 6;
      const states = data.offers.reduce((sum, offer) => sum + offer.states.length, 0);
      expect(visits).toBeLessThanOrEqual((rows + states) * passes);
    }
  } finally {
    validate.mockRestore();
  }
});
