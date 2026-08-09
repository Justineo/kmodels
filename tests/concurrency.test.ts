import { describe, expect, it, vi } from "vite-plus/test";
import { mapConcurrent } from "../src/catalog/concurrency.ts";

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
});
