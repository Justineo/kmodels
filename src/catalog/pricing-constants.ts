export const pricingLimits = {
  applicabilityClauses: 1_024,
  applicabilityBytes: 1_048_576,
  providerApplicabilityBytes: 33_554_432,
  providerSelectorWork: 268_435_456,
  conditionsPerClause: 32,
  categoricalValuesPerCondition: 4_096,
  unitFactors: 8,
  unitFactorPower: 8,
  semanticStringBytes: 512,
  provenanceStringBytes: 4_096,
  exactIntegerDigits: 128,
  rawFactBytes: 8_192,
  booksPerProvider: 512,
  offersPerProvider: 8_192,
  termsPerProvider: 65_536,
  variantsPerProvider: 262_144,
  observationsPerProvider: 524_288,
  coreInputBytes: 134_217_728,
  pricingInputBytes: 335_544_320,
  providerPrecompactionBytes: 134_217_728,
  providerPricingBytes: 67_108_864,
  pricingCatalogBytes: 268_435_456,
} as const;

export const pricingDecimalPattern = /^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/;
const nonNegativeDecimalPattern = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export function isPricingDecimal(value: string): boolean {
  return (
    pricingDecimalPattern.test(value) &&
    value.replace(".", "").length <= pricingLimits.exactIntegerDigits
  );
}

export function assertPricingDecimal(value: string): void {
  if (!pricingDecimalPattern.test(value)) throw new Error(`Invalid pricing decimal: ${value}`);
  if (value.replace(".", "").length > pricingLimits.exactIntegerDigits)
    throw new Error("Decimal coefficient exceeds the exact-integer digit limit");
}

export function isNonNegativeDecimal(value: string): boolean {
  return nonNegativeDecimalPattern.test(value);
}
