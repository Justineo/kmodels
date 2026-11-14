<script setup lang="ts" vapor>
import { computed } from "vue";
import { canonicalJson } from "../catalog/canonical-value.ts";
import type { CommercialChoice } from "../catalog/pricing-schema.ts";
import type { AvailableCommercialChoice } from "../pricing/commercial-matching.ts";
import type { WebsitePricingSelector } from "../catalog/website-schema.ts";
import { fixedPricingSelection } from "../catalog/pricing-selector-input.ts";
import { fixedPricingDetailVisible } from "../pricing/condition-presentation.ts";
import {
  commercialDimensionLabels,
  commercialDefinitions,
  commercialValueLabel,
} from "../pricing/commercial-vocabulary.ts";
import UiSelect from "./UiSelect.vue";
import PricingConditions from "./PricingConditions.vue";

const props = defineProps<{
  choices: AvailableCommercialChoice[];
  available?: readonly AvailableCommercialChoice[];
  selected: CommercialChoice[];
  prefix: string;
  inferred: readonly CommercialChoice[];
  selectors: readonly WebsitePricingSelector[];
  inputs: Readonly<Record<string, string>>;
  followRegion?: { key: string; label: string } | undefined;
}>();
const emit = defineEmits<{
  change: [choices: CommercialChoice[]];
  input: [key: string, value: string];
}>();
function isAvailable(choice: CommercialChoice): boolean {
  return (
    props.available === undefined ||
    props.available.some(
      ({ dimension, value }) =>
        dimension === choice.dimension && canonicalJson(value) === canonicalJson(choice.value),
    )
  );
}
const groups = computed(() =>
  [...new Set(props.choices.filter(isAvailable).map(({ dimension }) => dimension))].map(
    (dimension) => {
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
          disabled: !isAvailable({ dimension, value }),
          label:
            value.namespace === "kmodels"
              ? commercialValueLabel(value.value)
              : `${value.value} (${value.provider_id})`,
        })),
      };
    },
  ),
);
const sections = computed(() =>
  ["Plan", "Usage conditions"]
    .map((label) => ({
      label,
      groups: groups.value.filter((group) => group.section === label && !group.fixed),
    }))
    .filter(
      (section) =>
        section.groups.length ||
        (section.label === "Usage conditions" && editableSelectors.value.length),
    ),
);
const fixedGroups = computed(() =>
  groups.value.filter((group) => group.fixed && fixedPricingDetailVisible(group.dimension)),
);
const fixedSelectors = computed(() =>
  props.selectors.filter(
    (selector) =>
      fixedPricingSelection(selector) !== undefined &&
      fixedPricingDetailVisible(selector.dimension.value),
  ),
);
const editableSelectors = computed(() =>
  props.selectors.filter((selector) => fixedPricingSelection(selector) === undefined),
);
function choose(dimension: CommercialChoice["dimension"], key: string): void {
  const choice = props.choices.find(
    (choice) => choice.dimension === dimension && canonicalJson(choice.value) === key,
  );
  const previous = props.selected.filter((choice) => choice.dimension !== dimension);
  if (choice !== undefined && !isAvailable(choice)) return;
  emit("change", choice ? [...previous, { dimension, value: choice.value }] : previous);
}
</script>

<template>
  <div
    v-if="sections.length || fixedGroups.length || fixedSelectors.length"
    class="pricing-controls"
  >
    <section
      v-if="fixedGroups.length || fixedSelectors.length"
      class="pricing-scope"
      aria-label="Price scope"
    >
      <p class="pricing-scope-title">Price scope</p>
      <p class="pricing-scope-description">Prices shown apply within this scope.</p>
      <div class="pricing-scope-values">
        <div v-for="group in fixedGroups" :key="group.dimension" class="commercial-choice">
          <span class="pricing-scope-label" :title="group.description">{{ group.label }}</span>
          <output class="pricing-fixed-value">{{ group.options[0]?.label }}</output>
        </div>
        <PricingConditions :prefix="prefix" :selectors="fixedSelectors" :inputs="inputs" />
      </div>
    </section>
    <fieldset v-for="section in sections" :key="section.label">
      <legend>{{ section.label }}</legend>
      <div v-for="group in section.groups" :key="group.dimension" class="commercial-choice">
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
        v-if="section.label === 'Usage conditions'"
        :prefix="prefix"
        :selectors="editableSelectors"
        :inputs="inputs"
        :follow-region="followRegion"
        @input="(key, value) => emit('input', key, value)"
      />
    </fieldset>
  </div>
</template>

<style scoped>
.pricing-controls {
  display: grid;
  gap: var(--space-3);
}
.pricing-controls fieldset,
.pricing-scope-values {
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
.pricing-scope-title {
  margin: 0;
  font-size: var(--font-size-meta);
  font-weight: var(--font-weight-semibold);
}
.pricing-scope-description {
  margin: var(--space-1) 0 var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
}
.commercial-choice {
  display: grid;
  min-width: 0;
  gap: var(--space-1);
}
.pricing-controls label,
.pricing-scope-label {
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
.pricing-controls :deep(.pricing-fixed-value) {
  display: block;
  min-width: 0;
  color: var(--color-text-primary);
  font-size: var(--font-size-meta);
  line-height: var(--line-height-body);
}
@media (max-width: 640px) {
  .pricing-controls fieldset,
  .pricing-scope-values {
    grid-template-columns: 1fr;
  }
}
</style>
