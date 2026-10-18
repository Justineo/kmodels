import { expect, it } from "vite-plus/test";
import { z } from "zod";
import { parseSourceJson, recognizeValue } from "../src/catalog/source-contract.ts";
import {
  dependencyFailureSchema,
  maxDependencyFailures,
  sourceErrorMessage,
  sourceFailure,
  SourceFetchError,
  summarizeDependencyFailures,
  type DependencyFailure,
} from "../src/catalog/source-failure.ts";

it("preserves HTTP evidence through dependency context without classifying prose as a status", () => {
  const failure = sourceFailure(
    new Error("Required companion failed", { cause: new SourceFetchError("HTTP 404 prose", 503) }),
  );
  expect(failure).toEqual({
    outcome: "fetch_failed",
    message: "Required companion failed",
    http_status: 503,
  });
  expect(sourceFailure(new Error("HTTP 404"))).not.toHaveProperty("http_status");
});

it("preserves source-contract evidence through an acquisition wrapper without copying rejected input", () => {
  const rejected = '{"access_token":"private-token", invalid';
  try {
    parseSourceJson(rejected);
    expect.unreachable("Expected invalid source JSON");
  } catch (cause) {
    const failure = sourceFailure(new Error("Required document failed", { cause }));
    expect(failure).toMatchObject({
      outcome: "parse_failed",
      contract_findings: [{ diagnostics: [{ kind: "invalid_json" }] }],
    });
    expect(JSON.stringify(failure)).not.toContain("private-token");
  }
  try {
    recognizeValue("Catalog response", z.object({ models: z.array(z.unknown()) }), {
      models: "not an array",
    });
    expect.unreachable("Expected rejected catalog shape");
  } catch (error) {
    expect(sourceFailure(error)).toMatchObject({
      outcome: "parse_failed",
      contract_findings: [{ diagnostics: [{ kind: "type_mismatch", path: "/models" }] }],
    });
  }
});

it("bounds failure evidence deterministically while retaining each dependency's own history", () => {
  const failures: DependencyFailure[] = Array.from(
    { length: maxDependencyFailures + 2 },
    (_, index) => ({
      dependency_id: `source/document-${index}`,
      impact: "claim",
      outcome: "fetch_failed",
      message: "HTTP 404",
      http_status: 404,
      consecutive_failures: index + 1,
    }),
  );
  failures.push({
    dependency_id: "source/structure",
    impact: "bundle",
    outcome: "parse_failed",
    message: "Response schema changed",
  });
  const summary = summarizeDependencyFailures(failures);
  expect(summary).toEqual(summarizeDependencyFailures(failures.toReversed()));
  expect(summary.dependency_failures).toHaveLength(maxDependencyFailures);
  expect(summary.dependency_failures_omitted).toBe(3);
  expect(summary.dependency_failures?.[0]?.outcome).toBe("parse_failed");
  for (const failure of summary.dependency_failures ?? [])
    expect(dependencyFailureSchema.parse(failure)).toEqual(failure);
  expect(summarizeDependencyFailures([])).toEqual({});
});

it("keeps emitted error messages bounded, single-line and free of common credential/account identifiers", () => {
  const message = sourceErrorMessage(
    new Error(
      "https://example.test/private user@example.test 123456789012 Authorization: Bearer private-token\n::error::" +
        "x".repeat(1200),
    ),
  );
  expect(message).toHaveLength(1024);
  for (const value of ["private-token", "user@example.test", "123456789012", "\n", "https://"])
    expect(message).not.toContain(value);
  const cyclic = new Error("Cyclic acquisition context");
  cyclic.cause = cyclic;
  expect(sourceFailure(cyclic)).toEqual({ outcome: "fetch_failed", message: cyclic.message });
});
