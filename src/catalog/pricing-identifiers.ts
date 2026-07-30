import { canonicalJsonHash } from "./canonical-json.ts";

export function pricingBookId(providerId: string, bookKey: string): string {
  return canonicalJsonHash(["kmodels.pricing.book.v1", providerId, bookKey]);
}

export function pricingOfferId(bookId: string, offerKey: string): string {
  return canonicalJsonHash(["kmodels.pricing.offer.v1", bookId, offerKey]);
}

export function pricingTermId(offerId: string, termKey: string): string {
  return canonicalJsonHash(["kmodels.pricing.term.v1", offerId, termKey]);
}
