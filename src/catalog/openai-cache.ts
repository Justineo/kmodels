import { canonicalizeApplicability } from "./pricing-canonical.ts";
import type { PriceApplicability } from "./pricing-schema.ts";

export function openAiCacheLifetime(scope: PriceApplicability): "30m" | "12h" | undefined {
  const lifetimes = scope.any_of.map(({ all_of }) => {
    const ttl = all_of.find(
      ({ dimension }) =>
        dimension.namespace === "kmodels" && dimension.value === "cache_ttl_seconds",
    );
    if (
      ttl?.kind !== "decimal_range" ||
      ttl.lower?.inclusive !== true ||
      ttl.upper?.inclusive !== true ||
      ttl.lower.value !== ttl.upper.value
    )
      return;
    return ttl.lower.value === "1800" ? "30m" : ttl.lower.value === "43200" ? "12h" : undefined;
  });
  const first = lifetimes[0];
  return first !== undefined && lifetimes.every((value) => value === first) ? first : undefined;
}

export function withoutOpenAiCacheLifetime(scope: PriceApplicability): PriceApplicability {
  return canonicalizeApplicability({
    any_of: scope.any_of.map(({ all_of }) => ({
      all_of: all_of.filter(
        ({ dimension }) =>
          dimension.namespace !== "kmodels" || dimension.value !== "cache_ttl_seconds",
      ),
    })),
  });
}
