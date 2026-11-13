export const pricingLimits = {
  applicabilityClauses: 1_024,
  applicabilityBytes: 1_048_576,
  providerApplicabilityBytes: 134_217_728,
  providerSelectorWork: 268_435_456,
  conditionsPerClause: 32,
  categoricalValuesPerCondition: 4_096,
  dailyTimeWindows: 16,
  unitFactors: 8,
  unitFactorPower: 8,
  quantityCalculationNodes: 64,
  semanticStringBytes: 512,
  provenanceStringBytes: 4_096,
  exactIntegerDigits: 128,
  rawFactBytes: 8_192,
  // One book per published model plus service books, with headroom above the largest declared ceiling.
  booksPerProvider: 2_048,
  offersPerProvider: 8_192,
  termsPerProvider: 65_536,
  variantsPerProvider: 262_144,
  observationsPerProvider: 524_288,
  coreInputBytes: 134_217_728,
  pricingInputBytes: 436_207_616,
  // The atomic pre-compaction projection repeats each variant's applicability and observation, so a
  // large provider's input is routinely bigger than its compacted partition. It still needs a bound
  // of its own, but must leave room above the publication budget so compactable input is assembled
  // rather than rejected before compaction. It stays below the complete catalog budget.
  providerPrecompactionBytes: 268_435_456,
  providerPricingBytes: 134_217_728,
  // Scoped commercial claims add evidence and native bindings to the accepted price catalog.
  pricingCatalogBytes: 402_653_184,
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
