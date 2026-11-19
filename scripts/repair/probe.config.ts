import { join } from "node:path";
import { tmpdir } from "node:os";
import { defineConfig } from "vite-plus";

// Independent probes run against the candidate and its hydrated snapshot, offline.
export default defineConfig({
  root: process.cwd(),
  cacheDir: join(tmpdir(), "catalog-repair-probe-cache"),
  test: {
    include: ["repair-probes/**/*.test.ts"],
    setupFiles: [join(process.cwd(), "tests/setup.ts")],
    fileParallelism: false,
  },
});
