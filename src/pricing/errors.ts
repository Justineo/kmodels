export const errorCodes = [
  "INVALID_DATA",
  "UNSUPPORTED_SCHEMA",
  "INVALID_REQUEST",
  "DUPLICATE_SELECTOR",
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
