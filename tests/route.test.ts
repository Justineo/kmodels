import { describe, expect, it } from "vite-plus/test";
import { formatRouteSearch, parseRouteSearch, type RouteState } from "../src/catalog/route.ts";

function defaultState(): RouteState {
  return {
    query: "",
    provider: "",
    tasks: [],
    lifecycles: ["active", "legacy", "unknown"],
    releaseStages: [],
    sort: undefined,
    modelUid: undefined,
  };
}

describe("catalog route state", () => {
  it("uses the default lifecycle selection without adding it to the URL", () => {
    const state = defaultState();
    expect(parseRouteSearch("")).toEqual(state);
    expect(formatRouteSearch(state)).toBe("");
    expect(formatRouteSearch({ ...state, lifecycles: ["unknown", "active", "legacy"] })).toBe("");
  });

  it("distinguishes no lifecycle selection from the default and from all lifecycles", () => {
    const state = defaultState();
    expect(parseRouteSearch("?l=")).toEqual({ ...state, lifecycles: [] });
    expect(formatRouteSearch({ ...state, lifecycles: [] })).toBe("?l=");
    const lifecycles = ["active", "legacy", "deprecated", "retired", "unknown"] as const;
    expect(parseRouteSearch("?l=aldru")).toEqual({ ...state, lifecycles });
    expect(formatRouteSearch({ ...state, lifecycles: [...lifecycles] })).toBe("?l=aldru");
  });

  it("round-trips compact, canonical parameters", () => {
    const state: RouteState = {
      query: "claude 4",
      provider: "anthropic",
      tasks: ["text_generation", "speech_to_speech"],
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
      ...defaultState(),
      tasks: ["text_generation"],
      lifecycles: ["active"],
      releaseStages: ["preview", "unknown"],
    });
    expect(parseRouteSearch("?l=x")).toEqual(defaultState());
  });

  it("deduplicates and orders enum selections canonically", () => {
    expect(
      formatRouteSearch({
        ...defaultState(),
        tasks: ["speech_to_speech", "text_generation", "speech_to_speech"],
        lifecycles: ["retired", "active"],
      }),
    ).toBe("?o=tS&l=ar");
  });

  it("keeps the compact date-sort code while sorting release dates", () => {
    expect(parseRouteSearch("?s=u").sort).toEqual({
      key: "released",
      direction: "ascending",
    });
    expect(
      formatRouteSearch({
        ...defaultState(),
        sort: { key: "released", direction: "descending" },
      }),
    ).toBe("?s=U");
  });
});
