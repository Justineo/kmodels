import { describe, expect, it, vi } from "vite-plus/test";
import { mapConcurrent, mapConcurrentByKey } from "../src/catalog/concurrency.ts";

describe("bounded concurrency", () => {
  it("keeps output order while assigning the next item to the first free worker", async () => {
    let releaseFirst = () => {};
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const started: number[] = [];
    const result = mapConcurrent([0, 1, 2], 2, async (value) => {
      started.push(value);
      if (value === 0) await first;
      return value;
    });

    await vi.waitFor(() => expect(started).toEqual([0, 1, 2]));
    releaseFirst();
    await expect(result).resolves.toEqual([0, 1, 2]);
  });

  it("rejects invalid bounds", async () => {
    await expect(mapConcurrent([], 0, async () => undefined)).rejects.toThrow(
      "positive safe integer",
    );
  });

  it("preserves undefined task results", async () => {
    await expect(mapConcurrent([0, 1], 2, async () => undefined)).resolves.toEqual([
      undefined,
      undefined,
    ]);
  });

  it("runs disjoint keys together while serializing every shared key", async () => {
    let releaseFirst = () => {};
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let releaseBridge = () => {};
    const bridge = new Promise<void>((resolve) => {
      releaseBridge = resolve;
    });
    const started: number[] = [];
    const result = mapConcurrentByKey(
      [
        { id: 0, keys: ["first"] },
        { id: 1, keys: ["first", "second"] },
        { id: 2, keys: ["second"] },
        { id: 3, keys: ["independent"] },
      ],
      ({ keys }) => keys,
      async ({ id }) => {
        started.push(id);
        if (id === 0) await first;
        if (id === 1) await bridge;
        return id;
      },
    );

    await vi.waitFor(() => expect(started).toEqual([0, 3]));
    releaseFirst();
    await vi.waitFor(() => expect(started).toEqual([0, 3, 1]));
    releaseBridge();
    await expect(result).resolves.toEqual([0, 1, 2, 3]);
    expect(started).toEqual([0, 3, 1, 2]);
  });

  it("rejects empty task keys before starting work", async () => {
    const task = vi.fn(async () => undefined);
    expect(() => mapConcurrentByKey([0, 1], (value) => (value === 0 ? ["key"] : []), task)).toThrow(
      "at least one non-empty key",
    );
    expect(task).not.toHaveBeenCalled();
  });
});
