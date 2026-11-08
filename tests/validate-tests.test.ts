import { beforeEach, expect, it, vi } from "vite-plus/test";
import { validateTests, ValidationTestTimeout } from "../scripts/validate-tests.ts";

const { files, run } = vi.hoisted(() => ({ files: new Map<string, string>(), run: vi.fn() }));
const marker = "/tmp/test-validation/timeout.txt";
vi.mock("node:child_process", () => ({ spawnSync: run }));
vi.mock("node:fs/promises", () => ({
  mkdtemp: async () => "/tmp/test-validation",
  readFile: async (path: string) => {
    const value = files.get(path);
    if (value === undefined) throw Object.assign(new Error("Missing marker"), { code: "ENOENT" });
    return value;
  },
  writeFile: async (path: string, value: string) => {
    files.set(path, value);
  },
  rm: async (path: string) => {
    files.delete(path);
  },
}));

beforeEach(() => {
  files.clear();
  run.mockReset();
});

function timeout() {
  files.set(marker, "test_timeout\n");
  return { status: 1 };
}

it("retries only a reported test-body timeout using the identical command", async () => {
  run.mockImplementationOnce(timeout).mockReturnValueOnce({ status: 0 });
  await validateTests(["--run", "--project", "unit"], "/report");
  expect(run).toHaveBeenCalledTimes(2);
  expect(run.mock.calls[0]).toEqual(run.mock.calls[1]);
  expect(files.has("/report")).toBe(false);
});

it("reports exhaustion separately and stops on an assertion or process failure", async () => {
  run.mockImplementation(timeout);
  await expect(validateTests(["--run"], "/report")).rejects.toBeInstanceOf(ValidationTestTimeout);
  expect(run).toHaveBeenCalledTimes(2);
  expect(files.get("/report")).toBe("test_timeout\n");

  for (const result of [{ status: 1 }, { status: null, signal: "SIGTERM" }]) {
    run.mockReset().mockReturnValue(result);
    await expect(validateTests(["--run"], "/report")).rejects.not.toBeInstanceOf(
      ValidationTestTimeout,
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(files.has("/report")).toBe(false);
  }
});
