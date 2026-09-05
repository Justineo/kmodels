export const errorCodes = [
  "INVALID_DATA",
  "UNSUPPORTED_SCHEMA",
  "INVALID_REQUEST",
  "UNKNOWN_OFFER",
  "DUPLICATE_COMPONENT",
  "DUPLICATE_SIGNAL",
  "DUPLICATE_SELECTOR",
  "CONFLICTING_QUANTITIES",
  "INCOMPATIBLE_QUANTITY",
  "ASSUMPTION_CONFLICT",
  "INVALID_COMPOSITION",
  "ARITHMETIC_LIMIT",
] as const;
export type PricingErrorCode = (typeof errorCodes)[number];
export class PricingError extends Error {
  readonly code: PricingErrorCode;
  constructor(code: PricingErrorCode, message: string) {
    super(message);
    this.name = "PricingError";
    this.code = code;
  }
}
