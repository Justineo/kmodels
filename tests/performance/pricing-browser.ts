import { createVaporApp, nextTick } from "vue";
import PricingHarness from "./PricingHarness.vue";
import type { PricingPerformanceCase } from "./pricing-fixture.ts";
import { pricingTransitionAudit } from "./pricing-transitions.ts";
import "../../src/tokens.css";

const root = document.querySelector("#app");
if (!(root instanceof HTMLElement)) throw new Error("Missing benchmark mount point");
let app: ReturnType<typeof createVaporApp> | undefined;
function state() {
  return {
    text: root?.textContent ?? "",
    rates: [...document.querySelectorAll(".exact-rate")].map((rate) => rate.textContent),
    controls: [...document.querySelectorAll("select")].map((select) => ({
      id: select.id,
      label: [...(select.labels ?? [])].map((label) => label.textContent?.trim()).join(" "),
      value: select.value,
      options: [...select.options]
        .filter(({ value }) => value !== "")
        .map(({ value, label, disabled }) => ({ value, label, disabled })),
    })),
  };
}
async function settle(start: number) {
  await nextTick();
  root?.getBoundingClientRect();
  const update_ms = performance.now() - start;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  return { update_ms, frame_ms: performance.now() - start, ...state() };
}
const benchmark = {
  audit(
    subject: PricingPerformanceCase,
    mode: "inference" | "offer",
  ): Promise<{
    regions: number;
    paths: number;
    states: number;
    transitions: number;
    blocked: number;
  }> {
    return pricingTransitionAudit(benchmark, subject, mode);
  },
  async mount(subject: PricingPerformanceCase, mode: "inference" | "offer") {
    app?.unmount();
    const start = performance.now();
    app = createVaporApp(PricingHarness, { subject, mode });
    app.mount(root);
    return settle(start);
  },
  async select(id: string, value: string) {
    const select = document.getElementById(id);
    if (
      !(select instanceof HTMLSelectElement) ||
      ![...select.options].some((option) => option.value === value && !option.disabled)
    )
      throw new Error(`Unavailable option ${id}: ${value}`);
    const start = performance.now();
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return settle(start);
  },
};
declare global {
  interface Window {
    pricingBenchmark: typeof benchmark;
  }
}
window.pricingBenchmark = benchmark;
