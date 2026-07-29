import {
  divideRationals,
  multiplyRationals,
  normalizeRational,
  rationalToFiniteDecimal,
  rationalFromDecimal,
} from "./pricing-rational.ts";
import { normalizeUnitExpression } from "./pricing-canonical.ts";
import { pricingLimits } from "./pricing-constants.ts";
import {
  type BillingUnit,
  type PriceQuantity,
  type Rational,
  type UnitExpression,
  type UnitPrice,
} from "./pricing-schema.ts";

export type FixedUnitScale = "thousand" | "million" | "millisecond" | "minute" | "hour";

export interface SourceUnitFactor {
  unit: BillingUnit;
  power: number;
  scale?: FixedUnitScale;
}

export interface CanonicalSourceUnit {
  unit: UnitExpression;
  scale: Rational;
}

const scales: Record<FixedUnitScale, Rational> = {
  thousand: { numerator: "1000", denominator: "1" },
  million: { numerator: "1000000", denominator: "1" },
  millisecond: { numerator: "1", denominator: "1000" },
  minute: { numerator: "60", denominator: "1" },
  hour: { numerator: "3600", denominator: "1" },
};

export function canonicalizeSourceUnit(factors: SourceUnitFactor[]): CanonicalSourceUnit {
  if (factors.length > pricingLimits.unitFactors)
    throw new Error("Source unit factor limit exceeded");
  let scale = normalizeRational(1n);
  const canonicalFactors: UnitExpression["factors"] = [];
  for (const factor of factors) {
    if (
      !Number.isSafeInteger(factor.power) ||
      factor.power < 1 ||
      factor.power > pricingLimits.unitFactorPower
    )
      throw new Error("Source unit factor power limit exceeded");
    if (
      factor.scale !== undefined &&
      ["millisecond", "minute", "hour"].includes(factor.scale) &&
      !(factor.unit.namespace === "kmodels" && factor.unit.value === "second")
    )
      throw new Error("Time scale requires the canonical second unit");
    canonicalFactors.push({ unit: factor.unit, power: factor.power });
    if (factor.scale !== undefined)
      scale = multiplyRationals(scale, rationalPower(scales[factor.scale], factor.power));
  }
  return {
    unit: normalizeUnitExpression({ factors: canonicalFactors }),
    scale,
  };
}

export function canonicalizeUnitPrice(
  value: Rational,
  denomination: UnitPrice["denomination"],
  source: CanonicalSourceUnit,
): UnitPrice {
  return {
    value: divideRationals(value, source.scale),
    denomination,
    per: source.unit,
  };
}

export function canonicalizeQuantity(value: Rational, source: CanonicalSourceUnit): PriceQuantity {
  return {
    value: multiplyRationals(value, source.scale),
    unit: source.unit,
  };
}

export function canonicalizeDecimalBound(value: string, source: CanonicalSourceUnit): string {
  return rationalToDecimal(multiplyRationals(rationalFromDecimal(value), source.scale));
}

function rationalPower(value: Rational, power: number): Rational {
  let result = normalizeRational(1n);
  for (let index = 0; index < power; index += 1) result = multiplyRationals(result, value);
  return result;
}

function rationalToDecimal(value: Rational): string {
  const decimal = rationalToFiniteDecimal(value);
  if (decimal === undefined) throw new Error("Canonical bound is not a finite decimal");
  return decimal;
}
