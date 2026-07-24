import { describe, expect, it } from "vite-plus/test";
import { formatRouteSearch, parseRouteSearch, type RouteState } from "../src/catalog/route.ts";

function emptyState(): RouteState {
  return {
    query: "",
    provider: "",
    operations: [],
    lifecycles: [],
    releaseStages: [],
    sort: undefined,
    modelUid: undefined,
  };
}

describe("catalog route state", () => {
  it("omits default state", () => {
    expect(formatRouteSearch(emptyState())).toBe("");
  });

  it("round-trips compact, canonical parameters", () => {
    const state: RouteState = {
      query: "claude 4",
      provider: "anthropic",
      operations: ["text_generation", "speech_to_speech"],
      lifecycles: ["active", "retired"],
      releaseStages: ["stable", "experimental"],
      sort: { key: "name", direction: "descending" },
      modelUid: "anthropic/claude-sonnet@2026-07-01",
    };

    const search = formatRouteSearch(state);
    expect(search).toBe(
      "?q=claude+4&p=anthropic&o=tS&l=ar&r=se&s=N&m=anthropic%2Fclaude-sonnet%402026-07-01",
    );
    expect(parseRouteSearch(search)).toEqual(state);
  });

  it("ignores unknown codes and parameters", () => {
    expect(parseRouteSearch("?o=t!&l=ax&r=pu&s=x&m=&extra=value")).toEqual({
      ...emptyState(),
      operations: ["text_generation"],
      lifecycles: ["active"],
      releaseStages: ["preview", "unknown"],
    });
  });

  it("deduplicates and orders enum selections canonically", () => {
    expect(
      formatRouteSearch({
        ...emptyState(),
        operations: ["speech_to_speech", "text_generation", "speech_to_speech"],
        lifecycles: ["retired", "active"],
      }),
    ).toBe("?o=tS&l=ar");
  });
});
