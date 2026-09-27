import { expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import {
  auditModel,
  auditAnswerSchema,
  auditSemanticCoverage,
  auditSnapshot,
  prepareSemanticAudit,
  semanticAuditFindings,
  semanticRepairCandidates,
  type AuditCache,
} from "../src/catalog/semantic-audit.ts";
import { reviewedPublicSource } from "../src/catalog/public-evidence.ts";
import {
  changedMeaning,
  observedAt,
  searchUrl,
  semanticFixture,
  tools,
} from "./semantic-audit-fixtures.ts";

function answer(choice: "supported" | "contradicted" | "not_established") {
  return {
    type: "choice",
    choice,
    probabilities: {
      supported: choice === "supported" ? 0.98 : 0.01,
      contradicted: choice === "contradicted" ? 0.98 : 0.01,
      not_established: choice === "not_established" ? 0.98 : 0.01,
    },
    confidence: 0.97,
  };
}
function response(choice: "supported" | "contradicted" | "not_established") {
  return {
    model: auditModel,
    answers: { meaning: answer(choice) },
    usage: { input_tokens: 100, output_tokens: 45 },
  };
}
const mockFetch = (choice: "supported" | "contradicted" | "not_established") =>
  vi.fn<typeof fetch>(async () => Response.json(response(choice)));

it("independently judges raw source meaning, without giving Jev parser output or diagnostics", async () => {
  const snapshot = await semanticFixture();
  const fetch = mockFetch("supported");
  const report = await auditSemanticCoverage(snapshot, { apiKey: "test", fetch });
  expect(fetch).toHaveBeenCalledTimes(1);
  const request = fetch.mock.calls[0]?.[1]?.body;
  if (typeof request !== "string") throw new Error("Expected serialized request");
  const body = z
    .object({
      state: z.strictObject({
        claim: z.string(),
        document: z.object({ url: z.url(), body: z.string() }),
      }),
    })
    .parse(JSON.parse(request));
  expect(Object.keys(body.state).toSorted()).toEqual(["claim", "document"]);
  expect(body.state.document).toEqual(snapshot.documents[0]);
  expect(report.status).toBe("partial"); // Three other contracts were not supplied.
  expect(report.missing_documents).toHaveLength(3);
  expect(prepareSemanticAudit(snapshot).records).toHaveLength(4);
  expect(semanticAuditFindings(report)).toEqual([]);
});

it("finds marker-preserving meaning drift that passes the deterministic parser", async () => {
  const snapshot = await semanticFixture(changedMeaning);
  const baseline = prepareSemanticAudit(await semanticFixture());
  expect(prepareSemanticAudit(snapshot).records).toEqual(baseline.records);
  const report = await auditSemanticCoverage(snapshot, {
    apiKey: "test",
    fetch: mockFetch("contradicted"),
  });
  expect(semanticAuditFindings(report)).toEqual([
    expect.objectContaining({ relation: "emitted_but_contradicted" }),
  ]);
  expect(semanticRepairCandidates(report, snapshot, [], new Date(observedAt))).toEqual([
    expect.objectContaining({ trigger: "semantic_coverage_review", source_id: "vercel-models" }),
  ]);
});

it("routes a known parser gap directly to repair without paying Jev to classify it", async () => {
  const snapshot = await semanticFixture(
    `${tools}\nThe final response's gatewayToolCalls records only completed successful searches, separately for each tool.`,
  );
  expect(prepareSemanticAudit(snapshot).records).toEqual([]);
  const fetch = mockFetch("supported");
  const report = await auditSemanticCoverage(snapshot, { apiKey: "test", fetch });
  expect(fetch).not.toHaveBeenCalled();
  expect(report.judgments[0]?.status).toBe("parser_gap");
  expect(semanticAuditFindings(report)).toEqual([]);
  expect(semanticRepairCandidates(report, snapshot, [], new Date(observedAt))[0]?.trigger).toBe(
    "source_pricing_structure",
  );
});

it("retains model abstention without interpreting uncertainty as a contradiction", async () => {
  const report = await auditSemanticCoverage(await semanticFixture(), {
    apiKey: "test",
    fetch: mockFetch("not_established"),
  });
  expect(report.judgments[0]?.answer?.choice).toBe("not_established");
  expect(semanticAuditFindings(report)).toEqual([]);
});

it("reuses exact source judgments while replaying current extraction and invalidates changed text", async () => {
  const cache: AuditCache = {};
  const fetch = mockFetch("supported");
  const first = await auditSemanticCoverage(await semanticFixture(), {
    apiKey: "test",
    fetch,
    cache,
  });
  const second = await auditSemanticCoverage(await semanticFixture(), {
    apiKey: "test",
    fetch,
    cache,
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(second.judgments[0]).toMatchObject({ cached: true, usage: { input_tokens: 0 } });
  expect(second.output_hash).toBe(first.output_hash);
  await auditSemanticCoverage(await semanticFixture(changedMeaning), {
    apiKey: "test",
    fetch,
    cache,
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("rejects stale, modified or duplicate evidence and exact dismissals expire with changed facts", async () => {
  const snapshot = await semanticFixture(changedMeaning);
  const report = await auditSemanticCoverage(snapshot, {
    apiKey: "test",
    fetch: mockFetch("contradicted"),
  });
  const finding = semanticAuditFindings(report)[0];
  if (!finding) throw new Error("Missing fixture finding");
  expect(
    semanticRepairCandidates(
      report,
      snapshot,
      [
        {
          finding_id: finding.finding_id,
          disposition: "source_conflict",
          rationale:
            "Reviewed exact contradictory source evidence; investigation remains documented.",
        },
      ],
      new Date(observedAt),
    ),
  ).toEqual([]);
  expect(() =>
    semanticRepairCandidates(report, snapshot, [], new Date("2026-09-21T00:00:00Z")),
  ).toThrow("Stale");
  expect(() =>
    semanticRepairCandidates(
      { ...report, output_hash: "0".repeat(64) },
      snapshot,
      [],
      new Date(observedAt),
    ),
  ).toThrow();
  expect(() =>
    semanticRepairCandidates({ ...report, judgments: [] }, snapshot, [], new Date(observedAt)),
  ).toThrow("Incomplete");
  expect(() =>
    semanticRepairCandidates(
      { ...report, judgments: report.judgments.map((j) => ({ ...j, missing_keys: ["forged"] })) },
      snapshot,
      [],
      new Date(observedAt),
    ),
  ).toThrow("mismatch");
  expect(() =>
    prepareSemanticAudit({ ...snapshot, documents: [{ url: searchUrl, body: "changed" }] }),
  ).toThrow("hash");
});

it("isolates HTTP failure, malformed distributions, unexpected models and oversized responses", async () => {
  const snapshot = await semanticFixture();
  const responses = [
    new Response("denied", { status: 429 }),
    new Response("x".repeat(17_000)),
    Response.json({ ...response("supported"), model: "jev-next" }),
    Response.json({
      ...response("supported"),
      answers: {
        meaning: {
          ...answer("supported"),
          probabilities: { supported: 0.99, contradicted: 0.9, not_established: 0.1 },
        },
      },
    }),
  ];
  for (const response of responses) {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response);
    const report = await auditSemanticCoverage(snapshot, { apiKey: "test", fetch });
    expect(report.status).toBe("partial");
    expect(semanticAuditFindings(report)).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1); // No retry amplification.
  }
  expect(
    auditAnswerSchema.safeParse({
      ...answer("supported"),
      probabilities: { supported: 0.8, contradicted: 0.11, not_established: 0.1 },
    }).success,
  ).toBe(true);
});

it("bounds documents and refuses unreviewed URLs, authenticated sources and inherited crawls", () => {
  expect(() => auditSnapshot([{ url: searchUrl, body: "x".repeat(64_001) }], observedAt)).toThrow();
  expect(() => auditSnapshot([{ url: "https://example.org/", body: "x" }], observedAt)).toThrow();
  expect(() =>
    auditSnapshot(
      [
        { url: searchUrl, body: "a" },
        { url: searchUrl, body: "b" },
      ],
      observedAt,
    ),
  ).toThrow();
  expect(() => reviewedPublicSource("mistral-api")).toThrow();
  expect(() => reviewedPublicSource("vercel-models", "https://vercel.com/not-reviewed")).toThrow();
  const source = reviewedPublicSource("vercel-models", searchUrl);
  expect(source.url).toBe(searchUrl);
  expect(source.transport).toBeUndefined();
  expect(source.linkedDocuments).toBeUndefined();
  expect(source.auth).toBeUndefined();
});
