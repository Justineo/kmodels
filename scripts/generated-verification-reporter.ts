import { writeFile } from "node:fs/promises";
import type { Reporter } from "vite-plus/test/node";

export default class GeneratedVerificationReporter implements Reporter {
  onTestRunEnd: NonNullable<Reporter["onTestRunEnd"]> = async (modules, unhandled, reason) => {
    const path = process.env.KMODELS_GENERATED_VERIFICATION_PATH;
    if (path === undefined || reason !== "failed" || unhandled.length > 0) return;

    let sawTimeout = false;
    for (const module of modules) {
      if (module.errors().length > 0) return;
      for (const suite of module.children.allSuites()) {
        if (suite.errors().length > 0) return;
      }
      for (const test of module.children.allTests()) {
        const result = test.result();
        if (result.state === "pending") return;
        if (result.state !== "failed") continue;
        if (
          result.errors.length === 0 ||
          result.errors.some(
            ({ name, message }) =>
              name !== "Error" ||
              !/^Test timed out in \d+ms(?:\.| while waiting for )/u.test(message),
          )
        )
          return;
        sawTimeout = true;
      }
    }
    if (sawTimeout) await writeFile(path, "test_timeout\n");
  };
}
