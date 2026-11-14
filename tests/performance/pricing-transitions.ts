import type { PricingPerformanceCase } from "./pricing-fixture.ts";

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
    const key = JSON.stringify([state.controls, state.text]);
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
    if (action.label !== "region" && region?.value) {
      const retained = control(next, "region");
      const selected = region.options.find(({ value }) => value === region.value);
      if (
        retained
          ? retained.value !== region.value
          : !selected || !next.text.includes(selected.label)
      )
        throw new Error(`Commercial edit lost Region: ${JSON.stringify({ path, action, next })}`);
    }
    accept(next, path);
    return next;
  }
  accept(initial, []);
  const [regions = [], tiers = [], speeds = []] = domains;
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
