import assert from "node:assert/strict";
import type { Page } from "playwright";
import { unconditionalApplicability } from "../../src/catalog/pricing-canonical.ts";
import { priceStates } from "../../src/catalog/pricing-vocabulary.ts";
import type { PriceStateVariant } from "../../src/catalog/pricing-schema.ts";
import type { WebsitePricingOffer } from "../../src/catalog/website-schema.ts";
import type { PricingPerformanceCase } from "./pricing-fixture.ts";

// Each operation has a different published outcome. Only one has a numeric tariff.
const labels = {
  numeric: "Metered pricing",
  included: "Included",
  free: "Free",
  externally_billed: "Externally billed",
  custom_quote: "Custom quote",
  not_published: "Price not published",
  not_supported: "Not supported",
} satisfies Record<PriceStateVariant["state"], string>;
const dimension = { namespace: "kmodels", value: "operation" } as const;
const operations = priceStates.map((state, index) => {
  const key = `operation-${index}`;
  const value = { namespace: "provider" as const, provider_id: "fixture", value: key };
  const applicability = {
    any_of: [{ all_of: [{ kind: "categorical" as const, dimension, values: [value] }] }],
  };
  return { state, label: labels[state], key, value, applicability };
});

function mixedService(metered: (typeof operations)[number]): PricingPerformanceCase {
  const offer: WebsitePricingOffer = {
    id: "a".repeat(64),
    title: "Service",
    group: "optional_service",
    state_summary: "Multiple pricing states",
    billing_mode: { label: "Usage" },
    commercial_selection: {
      observed_at: "2026-01-01T00:00:00.000Z",
      claims: [
        { dimension: "billing_mode", target: "offer", value: "usage" } as const,
        { dimension: "resource_kind", target: "book", value: "service" } as const,
      ].map(({ dimension, target, value }) => ({
        dimension,
        target,
        coverage: "complete",
        applicability: unconditionalApplicability,
        alternatives: [
          { value: { namespace: "kmodels", value }, applicability: unconditionalApplicability },
        ],
      })),
    },
    selectors: [
      {
        kind: "categorical",
        label: "Operation",
        dimension,
        key: JSON.stringify(dimension),
        values: operations.map(({ key, value }) => ({ key, value, label: key })),
      },
    ],
    states: operations.map(({ key, state, label, applicability }) => ({
      key,
      state,
      label,
      applicability,
      applicability_label: key,
    })),
    rates: [
      {
        key: "runtime",
        term_ref: "b".repeat(64),
        label: "Runtime",
        amount: "$3",
        unit: "per hour",
        accessible_text: "$3 per hour",
        applicability: metered.applicability,
        applicability_label: metered.key,
      },
    ],
    allowances: [],
    contributions: [],
    enrollment: [],
    settlement: [],
    unnormalized_count: 0,
    unnormalized: [],
  };
  return { name: "mixed-service", modelRef: "fixture/model", prices: [], offers: [offer] };
}

export async function checkServicePricing(page: Page) {
  const metered = operations.find(({ state }) => state === "numeric");
  assert(metered);
  const initial = await page.evaluate(
    (subject) => window.pricingBenchmark.mount(subject, "offer"),
    mixedService(metered),
  );
  assert.deepEqual(
    initial.controls.map(({ label }) => label),
    ["Operation"],
  );
  assert.deepEqual(initial.rates, [], "An unresolved operation must not inherit the metered price");
  const [control] = initial.controls;
  assert(control);
  assert.deepEqual(
    control.options.map(({ value }) => value).sort(),
    operations.map(({ key }) => key).sort(),
  );
  for (const operation of operations.filter(({ state }) => state !== "numeric")) {
    for (const { key, state, label } of [operation, metered]) {
      const next: typeof initial = await page.evaluate(
        ({ id, key }) => window.pricingBenchmark.select(id, key),
        {
          id: control.id,
          key,
        },
      );
      assert.deepEqual(
        next.controls.map(({ label, value }) => [label, value]),
        [["Operation", key]],
        state,
      );
      assert.deepEqual(next.rates, state === "numeric" ? ["$3"] : [], state);
      assert.deepEqual(
        await page.locator(".state-label:visible").allTextContents(),
        [label],
        state,
      );
      assert.doesNotMatch(next.text, /No rates match|Choose the options above/, state);
    }
  }
  const cleared = await page.evaluate((id) => window.pricingBenchmark.select(id, ""), control.id);
  assert.deepEqual(cleared.rates, []);
  assert.deepEqual(await page.locator(".state-label:visible").allTextContents(), []);
  assert.deepEqual(cleared.controls, initial.controls);
}
