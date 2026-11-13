import { isStandardUnit } from "./pricing-commercial-assembly.ts";
import type { PriceApplicability } from "./pricing-schema.ts";

/** A usage-field mapping is valid only when every branch establishes the same exact TTL. */
export function exactCacheTtl(scope: PriceApplicability): number | undefined {
  let ttl: number | undefined;
  for (const { all_of } of scope.any_of) {
    const condition = all_of.find(
      ({ dimension }) =>
        dimension.namespace === "kmodels" && dimension.value === "cache_ttl_seconds",
    );
    if (
      condition?.kind !== "decimal_range" ||
      !isStandardUnit(condition.unit, "second") ||
      condition.lower?.inclusive !== true ||
      condition.upper?.inclusive !== true ||
      condition.lower.value !== condition.upper.value
    )
      return;
    const value = Number(condition.lower.value);
    if (!Number.isSafeInteger(value) || value <= 0 || (ttl !== undefined && ttl !== value)) return;
    ttl = value;
  }
  return ttl;
}
