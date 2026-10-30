import { afterEach, expect, it, vi } from "vite-plus/test";

const { saved } = vi.hoisted(() => ({ saved: new Map<string, string>() }));
vi.mock("node:fs/promises", () => ({
  mkdir: async () => {},
  readFile: async (path: URL) =>
    JSON.stringify(
      path.pathname.endsWith("fetch-state.json")
        ? { sources: {} }
        : { generated_at: "2026-10-29T00:00:00.000Z", providers: [] },
    ),
  writeFile: async (path: string, body: string, options: { flag: string }) => {
    expect(options.flag).toBe("wx");
    if (saved.has(path)) throw new Error("Receipt would be overwritten");
    saved.set(path, body);
  },
}));
vi.mock("../src/catalog/fetch.ts", async (original) => ({
  ...(await original<typeof import("../src/catalog/fetch.ts")>()),
  fetchSource: async () => ({ body: "unchanged provider document" }),
}));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  saved.clear();
});

it("keeps previously hashed evidence immutable when the same source is fetched again", async () => {
  vi.stubGlobal("process", {
    ...process,
    argv: ["node", "fetch-catalog-evidence.ts", "openai-pricing"],
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-30T01:00:00Z"));
  await import("../scripts/fetch-catalog-evidence.ts");
  const first = [...saved.entries()][0];
  expect(first).toBeDefined();
  vi.resetModules();
  vi.setSystemTime(new Date("2026-10-30T01:05:00Z"));
  await import("../scripts/fetch-catalog-evidence.ts");
  expect(saved.size).toBe(2);
  if (first === undefined) throw new Error("Missing first receipt");
  expect(saved.get(first[0])).toBe(first[1]);
  expect([...saved.values()][1]).toContain("2026-10-30T01:05:00.000Z");
});
