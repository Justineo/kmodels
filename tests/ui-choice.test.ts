import { expect, it } from "vite-plus/test";
import UiChoice from "../src/components/UiChoice.vue";
import { renderComponent } from "./render-component.ts";

const options = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ value: `v${index}`, label: `Option ${index}` }));

it("renders a few options as a labelled segmented radio group", async () => {
  const html = await renderComponent(UiChoice, {
    id: "tier",
    options: options(3),
    modelValue: "v1",
  });
  expect(html).toContain('role="radiogroup"');
  expect(html).toContain('aria-labelledby="tier-label"');
  expect(html.match(/type="radio"/g)).toHaveLength(3);
  expect(html).toMatch(/value="v1"[^>]*checked/);
  expect(html).not.toContain("<select");
});

it("keeps the dropdown for long option sets and meaningful empty values", async () => {
  const many = await renderComponent(UiChoice, {
    id: "region",
    options: options(6),
    modelValue: "",
  });
  const following = await renderComponent(UiChoice, {
    id: "region",
    options: options(2),
    modelValue: "",
    emptyLabel: "Pricing region · US",
  });
  for (const html of [many, following]) {
    expect(html).toContain("<select");
    expect(html).not.toContain('role="radiogroup"');
  }
  expect(following).toContain("Pricing region · US");
});
