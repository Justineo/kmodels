export async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  task: (value: T) => Promise<R>,
): Promise<R[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1)
    throw new Error("Concurrency must be a positive safe integer");

  const entries = values.map((value, index) => ({ index, value }));
  const results: ({ value: R } | undefined)[] = Array.from({ length: entries.length });
  let cursor = 0;
  let stopped = false;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, entries.length) }, async () => {
      while (!stopped) {
        const entry = entries[cursor];
        cursor += 1;
        if (entry === undefined) return;
        try {
          results[entry.index] = { value: await task(entry.value) };
        } catch (error) {
          stopped = true;
          throw error;
        }
      }
    }),
  );
  return results.map((result) => {
    if (result === undefined) throw new Error("Concurrent task did not produce a result");
    return result.value;
  });
}
