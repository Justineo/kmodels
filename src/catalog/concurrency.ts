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

export function mapConcurrentByKey<T, R>(
  values: readonly T[],
  keys: (value: T) => readonly string[],
  task: (value: T) => Promise<R>,
): Promise<R[]> {
  const entries = values.map((value) => {
    const taskKeys = [...new Set(keys(value))];
    if (taskKeys.length === 0 || taskKeys.some((key) => key.length === 0))
      throw new Error("Concurrent tasks require at least one non-empty key");
    return { value, keys: taskKeys };
  });
  const tails = new Map<string, Promise<void>>();
  const tasks = entries.map(({ value, keys: taskKeys }) => {
    const blockers = taskKeys.flatMap((key) => {
      const tail = tails.get(key);
      return tail === undefined ? [] : [tail];
    });
    const result = Promise.all(blockers).then(() => task(value));
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    for (const key of taskKeys) tails.set(key, tail);
    return result;
  });
  return Promise.all(tasks);
}
