// Reduced recognizer fixture for the reviewed first-party currency module.
export const USD_TO_EUR = 0.85;
export const MAX_DECIMALS = { usd: 5, eur: 7 };
export function convertUsdPrice(priceUsd: number, currency: string): number {
  return currency === "eur" ? priceUsd * USD_TO_EUR : priceUsd;
}
