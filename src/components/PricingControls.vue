<script setup lang="ts" vapor>
import { computed } from "vue";
import { canonicalJson } from "../catalog/canonical-value.ts";
import type { CommercialChoice } from "../catalog/pricing-schema.ts";
import type { AvailableCommercialChoice } from "../pricing/commercial-matching.ts";
import type { WebsitePricingSelector } from "../catalog/website-schema.ts";
import {
  commercialDimensionLabels,
  commercialDefinitions,
  commercialValueLabel,
} from "../pricing/commercial-vocabulary.ts";
import UiSelect from "./UiSelect.vue";
import PricingConditions from "./PricingConditions.vue";

const props = defineProps<{
  choices: AvailableCommercialChoice[];
  selected: CommercialChoice[];
  prefix: string;
  fixed: readonly CommercialChoice[];
  selectors: readonly WebsitePricingSelector[];
  inputs: Readonly<Record<string, string>>;
  followRegion?: { key: string; label: string } | undefined;
}>();
const emit = defineEmits<{
  change: [choices: CommercialChoice[]];
  input: [key: string, value: string];
}>();
const groups = computed(() =>
  [...new Set(props.choices.map(({ dimension }) => dimension))].map((dimension) => {
    const choices = props.choices.filter((choice) => choice.dimension === dimension);
    return {
      dimension,
      section: choices.some(
        (choice) => choice.targets?.includes("offer") || choice.targets?.includes("book"),
      )
        ? "Plan"
        : "Usage conditions",
      label: commercialDimensionLabels[dimension],
      description: commercialDefinitions[dimension],
      selected: props.selected.find((choice) => choice.dimension === dimension),
      fixed: props.fixed.some((choice) => choice.dimension === dimension),
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
const sections = computed(() =>
  ["Plan", "Usage conditions"]
    .map((label) => ({ label, groups: groups.value.filter((group) => group.section === label) }))
    .filter(
      (section) =>
        section.groups.length || (section.label === "Usage conditions" && props.selectors.length),
    ),
);
function choose(dimension: CommercialChoice["dimension"], key: string): void {
  const choice = props.choices.find(
    (choice) => choice.dimension === dimension && canonicalJson(choice.value) === key,
  );
  const previous = props.selected.filter((choice) => choice.dimension !== dimension);
  emit("change", choice ? [...previous, { dimension, value: choice.value }] : previous);
}
</script>

<template>
  <div v-if="sections.length" class="pricing-controls">
    <fieldset v-for="section in sections" :key="section.label">
      <legend>{{ section.label }}</legend>
      <div v-for="group in section.groups" :key="group.dimension" class="commercial-choice">
        <label :for="`${prefix}-${group.dimension}`" :title="group.description">{{
          group.label
        }}</label>
        <output
          v-if="group.fixed"
          :id="`${prefix}-${group.dimension}`"
          class="pricing-fixed-value"
          >{{ group.options[0]?.label }}</output
        >
        <UiSelect
          v-else
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
        :selectors="selectors"
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
.pricing-controls :deep(.pricing-fixed-value) {
  display: flex;
  align-items: center;
  min-width: 0;
  min-height: var(--control-height-default);
  padding-inline: var(--space-2);
  border: var(--stroke-hairline) solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  background: var(--color-surface-subtle);
  font-size: var(--font-size-meta);
  line-height: var(--line-height-body);
}
@media (max-width: 640px) {
  .pricing-controls fieldset {
    grid-template-columns: 1fr;
  }
}
</style>
