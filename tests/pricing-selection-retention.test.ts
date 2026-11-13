import { expect, it } from "vite-plus/test";
import {
  retainCommercialChoices,
  retainPricingInputs,
  commercialControlChoices,
} from "../src/catalog/pricing-selector-input.ts";
import type { CommercialChoice } from "../src/catalog/pricing-schema.ts";
import type { WebsitePricingSelector } from "../src/catalog/website-schema.ts";

const choice = (dimension: CommercialChoice["dimension"], value: string): CommercialChoice => ({
  dimension,
  value: { namespace: "kmodels", value },
});

it.each(["execution", "account_plan", "speed", "service_tier"] as const)(
  "preserves compatible choices when editing %s without a field-specific reset policy",
  (dimension) => {
    const billing = choice("billing_mode", "usage");
    const edited = choice(dimension, "after");
    const previous = [choice(dimension, "before"), billing];
    expect(retainCommercialChoices(previous, [billing, edited], () => true)).toEqual([
      edited,
      billing,
    ]);
    expect(retainCommercialChoices(previous, [billing], () => true)).toEqual([billing]);
  },
);

it("keeps an explicit choice editable while hiding unrelated dimensions", () => {
  const request = { ...choice("execution", "request"), offer_refs: ["offer"] };
  const batch = { ...choice("execution", "batch"), offer_refs: ["offer"] };
  const fast = { ...choice("speed", "fast"), offer_refs: ["offer"] };
  expect(commercialControlChoices([request, batch, fast], [batch], [batch])).toEqual([
    request,
    batch,
  ]);
  expect(commercialControlChoices([request, batch, fast], [request, fast], [fast])).toEqual([
    request,
    fast,
  ]);
});

it("prioritizes the edited choice and removes only incompatible previous choices", () => {
  const mode = choice("execution", "request");
  const speed = choice("speed", "fast");
  const billing = choice("billing_mode", "usage");
  const batch = choice("execution", "batch");
  expect(
    retainCommercialChoices(
      [mode, speed, billing],
      [speed, billing, batch],
      (choices) =>
        !(
          choices.some(({ value }) => value.value === "batch") &&
          choices.some(({ value }) => value.value === "fast")
        ),
    ),
  ).toEqual([batch, billing]);
});

it("retains TTL and geography across a rate change and drops only an invalid value", () => {
  const ttl: WebsitePricingSelector = {
    key: "ttl",
    label: "Cache TTL",
    dimension: { namespace: "kmodels", value: "cache_ttl_seconds" },
    kind: "decimal_values",
    values: ["300", "3600"],
    unit: { factors: [{ unit: { namespace: "kmodels", value: "second" }, power: 1 }] },
  };
  const geo: WebsitePricingSelector = {
    key: "geo",
    label: "Inference geo",
    dimension: { namespace: "kmodels", value: "inference_geo" },
    kind: "categorical",
    values: ["global", "us"].map((value) => ({
      key: value,
      label: value,
      value: { namespace: "provider", provider_id: "example", value },
    })),
  };
  const inputs = { ttl: "3600", geo: "us" };
  expect(retainPricingInputs([ttl, geo], [ttl, { ...geo, key: "new-geo" }], inputs)).toEqual({
    ttl: "3600",
    "new-geo": "us",
  });
  expect(retainPricingInputs([ttl, geo], [{ ...ttl, values: ["300"] }, geo], inputs)).toEqual({
    geo: "us",
  });
  const changedMeaning = {
    ...geo,
    values: [
      {
        key: "us",
        label: "EU",
        value: { namespace: "provider" as const, provider_id: "example", value: "eu" },
      },
    ],
  };
  expect(retainPricingInputs([ttl, geo], [ttl, changedMeaning], inputs)).toEqual({ ttl: "3600" });
});
