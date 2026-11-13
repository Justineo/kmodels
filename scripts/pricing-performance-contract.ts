export const pricingPerformanceBudgets = {
  mount_ms: 750,
  first_update_ms: 150,
  median_update_ms: 50,
  p95_update_ms: 100,
} as const;

export function timingSummary(samples: readonly number[]) {
  if (samples.length === 0 || samples.some((n) => !Number.isFinite(n) || n < 0))
    throw new Error("Performance samples must be nonempty, finite and non-negative");
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (fraction: number) => {
    const value = sorted[Math.ceil(sorted.length * fraction) - 1];
    if (value === undefined) throw new Error("Missing timing percentile");
    return value;
  };
  return { count: samples.length, median_ms: percentile(0.5), p95_ms: percentile(0.95) };
}

export function timingFailures(
  name: string,
  mounts: readonly number[],
  first: readonly number[],
  updates: ReadonlyMap<string, readonly number[]>,
): string[] {
  const failures: string[] = [];
  timingSummary(mounts);
  if (updates.size > 0 || first.length > 0) timingSummary(first);
  const check = (label: string, actual: number, limit: number) => {
    if (actual > limit)
      failures.push(`${name} ${label}: ${actual.toFixed(1)} ms exceeds ${limit} ms`);
  };
  check("cold mount", Math.max(...mounts), pricingPerformanceBudgets.mount_ms);
  if (first.length > 0)
    check("first update", Math.max(...first), pricingPerformanceBudgets.first_update_ms);
  for (const [action, samples] of updates) {
    const timing = timingSummary(samples);
    check(`${action} median`, timing.median_ms, pricingPerformanceBudgets.median_update_ms);
    check(`${action} P95`, timing.p95_ms, pricingPerformanceBudgets.p95_update_ms);
  }
  return failures;
}
