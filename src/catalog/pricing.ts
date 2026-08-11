import type {
  ParsedProviderModel,
  SourceCommercialPricingFact,
  SourcePriceFact,
  SourceRawPricingFact,
} from "./pricing-source.ts";

export function scaleDecimal(value: string, places: number): string {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new Error(`Invalid decimal: ${value}`);
  const [whole = "", fraction = ""] = value.split(".");
  const digits = `${whole}${fraction}`;
  let point = whole.length + places;
  const padded =
    point <= 0
      ? `${"0".repeat(1 - point)}${digits}`
      : point >= digits.length
        ? `${digits}${"0".repeat(point - digits.length)}`
        : digits;
  if (point <= 0) point = 1;
  const integer = padded.slice(0, point).replace(/^0+(?=\d)/, "") || "0";
  const decimals = padded.slice(point).replace(/0+$/, "");
  return decimals ? `${integer}.${decimals}` : integer;
}

export function decimalsEqual(left: string, right: string): boolean {
  return scaleDecimal(left, 0) === scaleDecimal(right, 0);
}

export function multiplyDecimal(left: string, right: string): string {
  const parts = (value: string): [bigint, number] => {
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new Error(`Invalid decimal: ${value}`);
    const [whole = "", fraction = ""] = value.split(".");
    return [BigInt(`${whole}${fraction}`), fraction.length];
  };
  const [leftInteger, leftScale] = parts(left);
  const [rightInteger, rightScale] = parts(right);
  const scale = leftScale + rightScale;
  const digits = (leftInteger * rightInteger).toString().padStart(scale + 1, "0");
  if (scale === 0) return digits;
  const whole = digits.slice(0, -scale).replace(/^0+(?=\d)/, "") || "0";
  const fraction = digits.slice(-scale).replace(/0+$/, "");
  return fraction === "" ? whole : `${whole}.${fraction}`;
}

export function publishedRate(
  meter: SourcePriceFact["meter"],
  price: string,
  unit: SourcePriceFact["unit"],
  sourceId: string,
  rawUnit: string,
  conditions: SourcePriceFact["conditions"] = {},
): SourcePriceFact {
  return {
    meter,
    price,
    currency: "USD",
    unit,
    conditions,
    source_ref: sourceId,
    derived: false,
    raw_price: price,
    raw_unit: rawUnit,
  };
}

export function commercialResource(
  source_ref: string,
  book_key: string,
  book_name: string,
  resource_kind: SourceCommercialPricingFact["resource_kind"],
  resource_key: string,
  model_refs: string[],
  billing_mode: SourceCommercialPricingFact["billing_mode"],
): Pick<
  SourceCommercialPricingFact,
  | "billing_mode"
  | "book_key"
  | "book_name"
  | "model_refs"
  | "resource_key"
  | "resource_kind"
  | "source_ref"
> {
  return {
    source_ref,
    book_key,
    book_name,
    resource_kind,
    resource_key,
    model_refs,
    billing_mode,
  };
}

export function rawPricingFact(
  source_ref: string,
  term_key: string,
  impact: SourceRawPricingFact["impact"],
  reason: SourceRawPricingFact["reason"],
  raw: SourceRawPricingFact["raw"] | string,
  conditions: SourceRawPricingFact["conditions"] = {},
): SourceRawPricingFact {
  return {
    term_key,
    impact,
    reason,
    conditions,
    source_ref,
    raw: typeof raw === "string" ? { fragment: raw } : raw,
  };
}

export function attachCommercialFacts(
  models: readonly ParsedProviderModel[],
  facts: SourceCommercialPricingFact[],
): void {
  const carrier = models.reduce<ParsedProviderModel | undefined>(
    (current, model) => (current === undefined || model.uid < current.uid ? model : current),
    undefined,
  );
  if (carrier !== undefined && facts.length > 0)
    carrier.commercial_facts = [...(carrier.commercial_facts ?? []), ...facts];
}
