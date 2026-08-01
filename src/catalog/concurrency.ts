export async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  task: (value: T) => Promise<R>,
): Promise<R[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1)
    throw new Error("Concurrency must be a positive safe integer");

  const entries = values.map((value, index) => ({ index, value }));
  const results = new Map<number, R>();
  let cursor = 0;
  let stopped = false;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, entries.length) }, async () => {
      while (!stopped) {
        const entry = entries[cursor];
        cursor += 1;
        if (entry === undefined) return;
        try {
          results.set(entry.index, await task(entry.value));
        } catch (error) {
          stopped = true;
          throw error;
        }
      }
    }),
  );
  return [...results.entries()].sort(([left], [right]) => left - right).map(([, value]) => value);
}
