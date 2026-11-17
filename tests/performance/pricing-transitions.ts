import type { PricingPerformanceCase } from "./pricing-fixture.ts";
import { commercialChoiceSchema } from "../../src/catalog/pricing-schema.ts";
import { pricingSelection } from "../../src/catalog/pricing-selector-input.ts";
import { matchInferencePrices } from "../../src/pricing/inference-matching.ts";
import { canonicalJson } from "../../src/catalog/canonical-value.ts";

type Benchmark = Pick<Window["pricingBenchmark"], "mount" | "select">;
type State = Awaited<ReturnType<Benchmark["mount"]>>;
type Action = { label: string; value: string };
const labels = ["region", "service tier", "speed"];
const orders = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

/** Exhaust every initial ordering, then every enabled edit/clear from every reachable UI state. */
export async function pricingTransitionAudit(
  benchmark: Benchmark,
  subject: PricingPerformanceCase,
  mode: "inference" | "offer",
) {
  const mount = () => benchmark.mount(subject, mode);
  const initial = await mount();
  const control = (state: State, label: string) =>
    state.controls.find((item) => item.label.toLowerCase() === label);
  const domains = labels.map((label) => control(initial, label)?.options ?? []);
  if (domains.some((domain) => domain.length === 0))
    throw new Error("Missing regional audit domain");
  const price = subject.prices[0];
  const matching = price?.matching;
  const regionOption = price?.pricing_options?.find(
    ({ dimension }) => dimension.value === "region",
  );
  if (matching === undefined || regionOption === undefined)
    throw new Error("Missing regional audit matching data");
  const queryData = { matching, regionOption };
  const queue: Action[][] = [];
  const seen = new Set<string>();
  let paths = 0;
  let transitions = 0;
  let blocked = 0;
  function accept(state: State, path: Action[]) {
    if (/No applicable prices|No rates match the selected context/.test(state.text))
      throw new Error(`Selectable path has no rates: ${JSON.stringify({ path, state })}`);
    if (state.text.includes("Applicable prices") && state.rates.length === 0)
      throw new Error(`Matched context has no rendered rates: ${JSON.stringify(path)}`);
    if (state.rates.length === 0 && !state.controls.some(({ value }) => value === ""))
      throw new Error(
        `Completed selections have no rendered rates: ${JSON.stringify({ path, state })}`,
      );
    const key = JSON.stringify([state.controls, state.text, state.categoricalSelections]);
    if (!seen.has(key)) {
      seen.add(key);
      queue.push(path);
    }
  }
  async function edit(state: State, action: Action, path: Action[]) {
    const field = control(state, action.label);
    if (
      !field ||
      (action.value !== "" &&
        !field.options.some((option) => option.value === action.value && !option.disabled))
    ) {
      blocked++;
      return state;
    }
    const region = control(state, "region");
    const next = await benchmark.select(field.id, action.value);
    transitions++;
    if (action.label !== "region" && action.value !== "") {
      const edited = control(next, action.label);
      const dimension = action.label === "service tier" ? "service_tier" : "speed";
      const preserved = edited
        ? edited.value === action.value
        : next.categoricalSelections.some(
            (selection) =>
              selection.kind === "categorical" &&
              selection.dimension.namespace === "kmodels" &&
              selection.dimension.value === dimension &&
              canonicalJson(selection.value) === action.value,
          );
      if (!preserved)
        throw new Error(`Edited choice was lost: ${JSON.stringify({ path, action, next })}`);
    }
    if (action.label !== "region" && region?.value) {
      const retained = control(next, "region");
      const selection = pricingSelection(queryData.regionOption, region.value);
      if (selection === undefined) throw new Error("Missing selected audit Region");
      const choices = next.categoricalSelections.flatMap((selection) => {
        const dimension =
          selection.dimension.namespace === "kmodels" &&
          ["service_tier", "speed"].includes(selection.dimension.value)
            ? selection.dimension.value
            : undefined;
        return dimension === undefined || selection.kind !== "categorical"
          ? []
          : [commercialChoiceSchema.parse({ dimension, value: selection.value })];
      });
      const result = matchInferencePrices(
        queryData.matching,
        [selection],
        new Date().toISOString(),
        undefined,
        undefined,
        choices,
      );
      const compatible =
        result.reason !== "no_applicable_price" && result.reason !== "incompatible_conditions";
      const preserved = retained
        ? retained.value === region.value
        : next.categoricalSelections.some(
            (value) => canonicalJson(value) === canonicalJson(selection),
          );
      if (compatible !== preserved || (!compatible && retained?.value))
        throw new Error(
          `Commercial edit must retain compatible Regions and reset conflicts: ${JSON.stringify({ path, action, next })}`,
        );
    }
    accept(next, path);
    return next;
  }
  accept(initial, []);
  const [regions = [], tiers = [], speeds = []] = domains;
  // Hiding a narrowed Region must preserve an explicit input without storing an inferred one.
  for (const explicit of [false, true]) {
    let state = await mount();
    const region = control(state, "region");
    const speed = control(state, "speed");
    const firstRegion = regions[0];
    const optimized = speeds.find(({ label }) => label === "Latency optimized");
    if (!region || !speed || !firstRegion || !optimized)
      throw new Error("Missing singleton round-trip controls");
    if (explicit) state = await benchmark.select(region.id, firstRegion.value);
    state = await benchmark.select(speed.id, optimized.value);
    if (control(state, "region") !== undefined || state.rates.length === 0)
      throw new Error(`A sole Region must resolve internally: ${JSON.stringify(state)}`);
    state = await benchmark.select(speed.id, "");
    if (control(state, "region")?.value !== (explicit ? firstRegion.value : ""))
      throw new Error(`Restoring Region changed input ownership: ${JSON.stringify(state)}`);
  }
  // A Priority-only Region must not disable Standard; the edit clears Region and keeps the tier.
  let regression = await mount();
  for (const [label, text] of [
    ["service tier", "Priority"],
    ["region", "region-3"],
    ["service tier", "Standard"],
  ] as const) {
    const field = control(regression, label);
    const option = field?.options.find(({ label }) => label === text);
    if (!field || !option || option.disabled)
      throw new Error(`Missing selectable regression option ${label}: ${text}`);
    regression = await benchmark.select(field.id, option.value);
  }
  if (control(regression, "region")?.value !== "" || regression.rates.length > 0)
    throw new Error(
      `Conflicting Region must reset before rates appear: ${JSON.stringify(regression)}`,
    );
  const selectedTier = control(regression, "service tier");
  if (selectedTier?.options.find(({ value }) => value === selectedTier.value)?.label !== "Standard")
    throw new Error("Resetting Region lost the selected Standard tier");
  for (const region of regions)
    for (const tier of tiers)
      for (const speed of [...speeds, undefined])
        for (const order of orders) {
          let state = await mount();
          const values = [region.value, tier.value, speed?.value];
          const path: Action[] = [];
          for (const index of order) {
            const label = labels[index];
            const value = values[index];
            if (label === undefined || value === undefined) continue;
            const action = { label, value };
            const before = transitions;
            state = await edit(state, action, [...path, action]);
            if (transitions !== before) path.push(action);
          }
          paths++;
        }
  // Replaying a representative path isolates every outgoing edge from prior edits.
  for (let index = 0; index < queue.length; index++) {
    const path = queue[index];
    if (!path) throw new Error("Missing audit path");
    const replay = async () => {
      let state = await mount();
      for (const action of path) {
        const field = control(state, action.label);
        if (!field) throw new Error(`Unreplayable audit path ${JSON.stringify(path)}`);
        state = await benchmark.select(field.id, action.value);
      }
      return state;
    };
    const state = await replay();
    for (const field of state.controls.filter(({ label }) =>
      labels.includes(label.toLowerCase()),
    )) {
      for (const value of [
        "",
        ...field.options.filter(({ disabled }) => !disabled).map(({ value }) => value),
      ]) {
        if (value === field.value) continue;
        const action = { label: field.label.toLowerCase(), value };
        await edit(await replay(), action, [...path, action]);
      }
    }
    if (queue.length > 2_000) throw new Error("Unexpectedly unbounded pricing state graph");
  }
  return { regions: regions.length, paths, states: seen.size, transitions, blocked };
}
