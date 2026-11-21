import { createVaporApp, nextTick } from "vue";
import PricingHarness from "./PricingHarness.vue";
import type { PricingPerformanceCase } from "./pricing-fixture.ts";
import { pricingTransitionAudit } from "./pricing-transitions.ts";
import { selectorSchema } from "../../src/pricing/schema.ts";
import "../../src/tokens.css";
import "../../src/style.css";

const root = document.querySelector("#app");
if (!(root instanceof HTMLElement)) throw new Error("Missing benchmark mount point");
let app: ReturnType<typeof createVaporApp> | undefined;
function radios(group: Element) {
  return [...group.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
}
function state() {
  return {
    text: root?.textContent ?? "",
    rates: [...document.querySelectorAll(".exact-rate")].map((rate) => rate.textContent),
    categoricalSelections: selectorSchema
      .array()
      .parse(JSON.parse(document.getElementById("pricing-context")?.dataset.selections ?? "[]")),
    controls: [...document.querySelectorAll('select, [role="radiogroup"]:not([inert])')].map(
      (control) => {
        if (control instanceof HTMLSelectElement)
          return {
            id: control.id,
            label: [...(control.labels ?? [])].map((label) => label.textContent?.trim()).join(" "),
            value: control.value,
            options: [...control.options]
              .filter(({ value }) => value !== "")
              .map(({ value, label, disabled }) => ({ value, label, disabled })),
          };
        const buttons = radios(control);
        return {
          id: control.id,
          label:
            document
              .getElementById(control.getAttribute("aria-labelledby") ?? "")
              ?.textContent?.trim() ?? "",
          value: buttons.find(({ checked }) => checked)?.value ?? "",
          options: buttons.map(({ value, labels, disabled }) => ({
            value,
            label: labels?.[0]?.textContent?.trim() ?? "",
            disabled,
          })),
        };
      },
    ),
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
    const control = document.getElementById(id);
    const start = performance.now();
    if (
      control instanceof HTMLSelectElement &&
      [...control.options].some((o) => o.value === value && !o.disabled)
    ) {
      control.value = value;
      control.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (control?.matches('[role="radiogroup"]:not([inert])')) {
      const button = radios(control).find((r) => (value === "" ? r.checked : r.value === value));
      if (button?.disabled || (!button && value !== ""))
        throw new Error(`Unavailable option ${id}: ${value}`);
      if (button && (value === "" || !button.checked)) button.click();
    } else {
      throw new Error(`Unavailable option ${id}: ${value}`);
    }
    return settle(start);
  },
};
declare global {
  interface Window {
    pricingBenchmark: typeof benchmark;
  }
}
window.pricingBenchmark = benchmark;
