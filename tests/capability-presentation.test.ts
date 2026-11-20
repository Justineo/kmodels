import { describe, expect, it } from "vite-plus/test";
import { capabilityRows } from "../src/catalog/capability-presentation.ts";
import type {
  CapabilityStatement,
  WebsiteCapabilityDetailGroup,
} from "../src/catalog/model-capability-details.ts";
import { unknownCapabilities } from "../src/catalog/schema.ts";

const source = (document_url: string) => ({
  document_url,
  locator: "Request options",
  observed_at: "2026-11-17T00:00:00.000Z",
});
const group = (
  statements: CapabilityStatement[],
  url = "https://docs.example.net/models",
): WebsiteCapabilityDetailGroup => ({
  source_ref: "docs",
  claim: statements.map(({ scope }) => scope).join("+"),
  evidence: [source(url)],
  statements,
});
const effort = (
  endpoint: string,
  supported_values: string[],
  default_value?: string,
): CapabilityStatement => ({
  kind: "reasoning_effort",
  scope: `Example ${endpoint}`,
  applicability: { interface: `Example ${endpoint}`, endpoint },
  supported_values,
  ...(default_value === undefined ? {} : { default_value }),
});
const endpoints = new Set(["/chat", "/responses"]);

describe("capability rows", () => {
  it("lists supported capabilities only and collapses values every API shares", () => {
    const rows = capabilityRows(
      { ...unknownCapabilities(), tool_call: true, fine_tuning: false },
      [
        group([effort("/chat", ["low", "high"], "high")], "https://docs.example.net/chat"),
        group([effort("/responses", ["low", "high"], "high")], "https://docs.example.org/api"),
        group([{ kind: "prompt_cache", scope: "Chat", mode: "implicit" }]),
      ],
      endpoints,
    );
    expect(rows.map(({ label }) => label)).toEqual([
      "Reasoning effort",
      "Tool calling",
      "Prompt caching",
    ]);
    expect(rows[0]).toMatchObject({
      values: [{ value: "low" }, { value: "high", isDefault: true }],
      byEndpoint: new Map(),
      unplaced: [],
      conflict: false,
    });
    expect(rows[0]?.sources.map(({ document_url }) => document_url)).toEqual([
      "https://docs.example.net/chat",
      "https://docs.example.org/api",
    ]);
    expect(rows[1]).not.toHaveProperty("values");
    expect(rows[2]?.values).toEqual([{ value: "automatic" }]);
  });

  it("treats an unstated default as unknown rather than a different value", () => {
    const [row] = capabilityRows(
      unknownCapabilities(),
      [group([effort("/chat", ["low", "high"], "high"), effort("/responses", ["low", "high"])])],
      endpoints,
    );
    expect(row?.values).toEqual([
      { value: "low" },
      { value: "high", isDefault: true, partialDefault: true },
    ]);
  });

  it("places differing values on published endpoints and labels the rest by interface", () => {
    const [row] = capabilityRows(
      unknownCapabilities(),
      [
        group([
          effort("/chat", ["low", "high"]),
          effort("/responses", ["none", "low", "high"], "none"),
          effort("/legacy", ["low"]),
        ]),
      ],
      endpoints,
    );
    expect(row).not.toHaveProperty("values");
    expect(row?.byEndpoint).toEqual(
      new Map([
        ["/chat", [{ value: "low" }, { value: "high" }]],
        ["/responses", [{ value: "none", isDefault: true }, { value: "low" }, { value: "high" }]],
      ]),
    );
    expect(row?.unplaced).toEqual([{ label: "Example /legacy", values: [{ value: "low" }] }]);
  });

  it("omits unsupported and unknown flags and flags same-scope disagreement", () => {
    expect(capabilityRows({ ...unknownCapabilities(), fine_tuning: false }, [])).toEqual([]);
    const [row] = capabilityRows(unknownCapabilities(), [
      group([effort("/chat", ["low", "high"], "high")]),
      { ...group([effort("/chat", ["low", "high"], "low")]), claim: "other" },
    ]);
    expect(row?.conflict).toBe(true);
    // A disputed default stays unknown; the options both sources share remain.
    expect(row?.values).toEqual([{ value: "low" }, { value: "high" }]);
  });
});
