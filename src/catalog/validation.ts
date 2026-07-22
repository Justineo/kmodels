import { providerModelSchema, type PriceRate, type ProviderModel } from "./schema.ts";

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

function priceKey(rate: PriceRate): string {
  return `${rate.meter}:${rate.currency}:${rate.unit}:${JSON.stringify(rate.conditions)}`;
}

function decimalParts(value: string): [bigint, number] {
  const [whole = "0", fraction = ""] = value.split(".");
  return [BigInt(`${whole}${fraction}`), fraction.length];
}

function scaled(value: bigint, from: number, to: number): bigint {
  return value * 10n ** BigInt(to - from);
}

function changedOverHalf(previous: string, next: string): boolean {
  const [previousValue, previousScale] = decimalParts(previous);
  const [nextValue, nextScale] = decimalParts(next);
  const scale = Math.max(previousScale, nextScale);
  const left = scaled(previousValue, previousScale, scale);
  const right = scaled(nextValue, nextScale, scale);
  if (left === 0n) return right !== 0n;
  const difference = left > right ? left - right : right - left;
  return difference * 2n > left;
}

function countRates(models: ProviderModel[]): number {
  return models.reduce((total, model) => total + model.pricing.length, 0);
}

export function validateProvider(
  models: ProviderModel[],
  previous: ProviderModel[],
): ValidationResult {
  if (models.length === 0) return { ok: false, reason: "candidate catalog is empty" };
  const uids = new Set<string>();
  for (const model of models) {
    const parsed = providerModelSchema.safeParse(model);
    if (!parsed.success) return { ok: false, reason: `schema validation failed for ${model.uid}` };
    if (model.uid !== `${model.provider_id}/${model.model_id}`)
      return { ok: false, reason: `UID mismatch for ${model.model_id}` };
    if (uids.has(model.uid)) return { ok: false, reason: `duplicate model ${model.uid}` };
    uids.add(model.uid);
    const rates = new Set<string>();
    for (const rate of model.pricing) {
      const key = priceKey(rate);
      if (rates.has(key))
        return { ok: false, reason: `duplicate conditional rate for ${model.uid}` };
      rates.add(key);
    }
  }

  if (previous.length > 0 && models.length < previous.length * 0.9)
    return { ok: false, reason: "model count dropped by more than 10%" };
  const previousRates = countRates(previous);
  if (previousRates > 0 && countRates(models) < previousRates * 0.8)
    return { ok: false, reason: "price-rate count dropped by more than 20%" };

  const previousByUid = new Map(previous.map((model) => [model.uid, model]));
  for (const model of models) {
    const old = previousByUid.get(model.uid);
    if (old === undefined) continue;
    const oldPrices = new Map(old.pricing.map((rate) => [priceKey(rate), rate]));
    for (const rate of model.pricing) {
      const oldRate = oldPrices.get(priceKey(rate));
      if (
        oldRate !== undefined &&
        rate.conditions.promotion !== true &&
        oldRate.conditions.promotion !== true &&
        changedOverHalf(oldRate.price, rate.price)
      )
        return { ok: false, reason: `non-promotional price changed over 50% for ${model.uid}` };
    }
  }
  return { ok: true };
}

export function preserveMissing(
  candidate: ProviderModel[],
  previous: ProviderModel[],
): ProviderModel[] {
  const candidateByUid = new Map(candidate.map((model) => [model.uid, model]));
  const previousByUid = new Map(previous.map((model) => [model.uid, model]));
  const observed = candidate.map((model) => {
    const old = previousByUid.get(model.uid);
    return old === undefined ? model : { ...model, first_seen_at: old.first_seen_at };
  });
  const missing = previous.filter((model) => !candidateByUid.has(model.uid));
  return [...observed, ...missing].sort((left, right) => left.uid.localeCompare(right.uid));
}
