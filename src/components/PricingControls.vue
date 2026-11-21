<script setup lang="ts" vapor>
import { computed } from "vue";
import { canonicalJson } from "../catalog/canonical-value.ts";
import type { CommercialChoice } from "../catalog/pricing-schema.ts";
import type { AvailableCommercialChoice } from "../pricing/commercial-matching.ts";
import type { WebsitePriceDimension, WebsitePricingSelector } from "../catalog/website-schema.ts";
import { fixedPricingSelection, pricingSelection } from "../catalog/pricing-selector-input.ts";
import {
  commercialDimensionLabels,
  commercialDefinitions,
  commercialValueLabel,
  commercialConditionDimension,
} from "../pricing/commercial-vocabulary.ts";
import UiSelect from "./UiSelect.vue";
import PricingConditions from "./PricingConditions.vue";
import PricingSelectionPrompt from "./PricingSelectionPrompt.vue";

const props = defineProps<{
  choices: AvailableCommercialChoice[];
  selected: CommercialChoice[];
  prefix: string;
  inferred: readonly CommercialChoice[];
  selectors: readonly WebsitePricingSelector[];
  inputs: Readonly<Record<string, string>>;
  followRegion?: { key: string; label: string } | undefined;
  selectionPrompt?:
    | {
        dimensions: readonly WebsitePriceDimension[];
        commercial?: readonly CommercialChoice["dimension"][];
        offerSelected?: boolean | undefined;
      }
    | undefined;
}>();
const emit = defineEmits<{
  change: [choices: CommercialChoice[]];
  input: [key: string, value: string];
}>();
const groups = computed(() =>
  [...new Set(props.choices.map(({ dimension }) => dimension))].map((dimension) => {
    const choices = props.choices.filter((choice) => choice.dimension === dimension);
    const inferred = props.inferred.find((choice) => choice.dimension === dimension);
    return {
      dimension,
      section: choices.some(
        (choice) => choice.targets?.includes("offer") || choice.targets?.includes("book"),
      )
        ? "Plan"
        : "Usage conditions",
      label: commercialDimensionLabels[dimension],
      description: commercialDefinitions[dimension],
      selected: props.selected.find((choice) => choice.dimension === dimension) ?? inferred,
      fixed: choices.length === 1 && inferred !== undefined,
      options: choices.map(({ value }) => ({
        value: canonicalJson(value),
        label:
          value.namespace === "kmodels"
            ? commercialValueLabel(value.value)
            : `${value.value} (${value.provider_id})`,
      })),
    };
  }),
);
const sections = computed(() => {
  const editable = props.selectors.filter(
    (selector) => fixedPricingSelection(selector) === undefined,
  );
  return ["Plan", "Usage conditions"].flatMap((label) => {
    const choices = groups.value.filter((group) => group.section === label && !group.fixed);
    const selectors = label === "Usage conditions" ? editable : [];
    return choices.length || selectors.length ? [{ label, choices, selectors }] : [];
  });
});
const remainingLabels = computed(() => {
  const prompt = props.selectionPrompt;
  if (prompt === undefined) return [];
  const missing = new Set(prompt.dimensions.map(canonicalJson));
  const labels = prompt.offerSelected === false ? ["a pricing offer"] : [];
  let hasSelection = prompt.offerSelected === true;
  for (const { choices, selectors } of sections.value) {
    for (const { dimension, label, selected } of choices) {
      if (selected !== undefined) hasSelection = true;
      else if (
        prompt.commercial?.includes(dimension) ||
        missing.has(
          canonicalJson({ namespace: "kmodels", value: commercialConditionDimension(dimension) }),
        )
      )
        labels.push(label);
    }
    for (const selector of selectors) {
      if (missing.has(canonicalJson(selector.dimension))) labels.push(selector.label);
      hasSelection ||=
        props.followRegion?.key === selector.key ||
        pricingSelection(selector, props.inputs[selector.key] ?? "") !== undefined;
    }
  }
  return hasSelection ? labels : [];
});
function choose(dimension: CommercialChoice["dimension"], key: string): void {
  const choice = props.choices.find(
    (choice) => choice.dimension === dimension && canonicalJson(choice.value) === key,
  );
  const previous = props.selected.filter((choice) => choice.dimension !== dimension);
  emit("change", choice ? [...previous, { dimension, value: choice.value }] : previous);
}
</script>

<template>
  <div v-if="sections.length || selectionPrompt" class="pricing-controls">
    <fieldset v-for="section in sections" :key="section.label">
      <legend>{{ section.label }}</legend>
      <div v-for="group in section.choices" :key="group.dimension" class="commercial-choice">
        <label :for="`${prefix}-${group.dimension}`" :title="group.description">{{
          group.label
        }}</label>
        <UiSelect
          :id="`${prefix}-${group.dimension}`"
          :model-value="group.selected ? canonicalJson(group.selected.value) : ''"
          :options="group.options"
          placeholder="Choose…"
          @update:model-value="choose(group.dimension, $event)"
        />
      </div>
      <PricingConditions
        v-if="section.selectors.length"
        :prefix="prefix"
        :selectors="section.selectors"
        :inputs="inputs"
        :follow-region="followRegion"
        @input="(key, value) => emit('input', key, value)"
      />
    </fieldset>
    <PricingSelectionPrompt v-if="selectionPrompt" :labels="remainingLabels" />
  </div>
</template>

<style scoped>
.pricing-controls {
  display: grid;
  gap: var(--space-3);
}
.pricing-controls fieldset {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
  gap: var(--space-3);
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.pricing-controls legend {
  padding: 0;
  margin-bottom: var(--space-2);
  font-size: var(--font-size-meta);
  font-weight: var(--font-weight-semibold);
}
.commercial-choice {
  display: grid;
  min-width: 0;
  gap: var(--space-1);
}
.pricing-controls label {
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
}
.pricing-controls :deep(.ui-select-control) {
  height: var(--control-height-default);
  padding-inline: var(--space-2);
  border: var(--stroke-hairline) solid var(--color-border-default);
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  background: var(--color-surface);
  font-size: var(--font-size-meta);
}
.pricing-controls :deep(.ui-select-control:has(.ui-select:focus-visible)) {
  border-color: var(--color-accent);
  outline: var(--stroke-focus) solid var(--color-accent);
  outline-offset: calc(var(--stroke-focus) * -1);
}
@media (max-width: 640px) {
  .pricing-controls fieldset {
    grid-template-columns: 1fr;
  }
}
</style>
