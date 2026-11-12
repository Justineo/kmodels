<script setup lang="ts" vapor>
import { computed } from "vue";
import { canonicalJson } from "../catalog/canonical-value.ts";
import type { CommercialChoice } from "../catalog/pricing-schema.ts";
import type { AvailableCommercialChoice } from "../pricing/commercial-matching.ts";
import {
  commercialDimensionLabels,
  commercialDefinitions,
  commercialValueLabel,
} from "../pricing/commercial-vocabulary.ts";
import UiSelect from "./UiSelect.vue";

const props = defineProps<{
  choices: AvailableCommercialChoice[];
  selected: CommercialChoice[];
  prefix: string;
  candidateRefs?: string[];
}>();
const emit = defineEmits<{ change: [choices: CommercialChoice[]] }>();
const groups = computed(() =>
  [...new Set(props.choices.map(({ dimension }) => dimension))].map((dimension) => {
    const choices = props.choices.filter((choice) => choice.dimension === dimension);
    const candidateRefs = props.candidateRefs ?? [];
    return {
      dimension,
      label: commercialDimensionLabels[dimension],
      description: commercialDefinitions[dimension],
      selected: props.selected.find((choice) => choice.dimension === dimension),
      fixed:
        ["execution", "billing_mode", "resource_kind"].includes(dimension) &&
        choices.length === 1 &&
        candidateRefs.length > 0 &&
        candidateRefs.every((ref) => choices.some((choice) => choice.offer_refs.includes(ref))),
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
function choose(dimension: CommercialChoice["dimension"], key: string): void {
  const choice = props.choices.find(
    (choice) => choice.dimension === dimension && canonicalJson(choice.value) === key,
  );
  const previous =
    dimension === "execution"
      ? []
      : props.selected.filter((choice) => choice.dimension !== dimension);
  emit("change", choice ? [...previous, { dimension, value: choice.value }] : previous);
}
</script>

<template>
  <div v-if="groups.length" class="commercial-choices">
    <div v-for="group in groups" :key="group.dimension">
      <p v-if="group.fixed" :title="group.description">
        {{ group.label }}: {{ group.options[0]?.label }}
      </p>
      <label v-else :for="`${prefix}-${group.dimension}`" :title="group.description">{{
        group.label
      }}</label>
      <UiSelect
        v-if="!group.fixed"
        :id="`${prefix}-${group.dimension}`"
        :model-value="group.selected ? canonicalJson(group.selected.value) : ''"
        :options="[{ value: '', label: 'All applicable options' }, ...group.options]"
        @update:model-value="choose(group.dimension, $event)"
      />
      <p v-if="group.dimension === 'served_service_tier' || group.dimension === 'speed'">
        Select the observed outcome, or an explicit estimate for planning.
      </p>
    </div>
  </div>
</template>

<style scoped>
.commercial-choices {
  display: grid;
  gap: var(--space-2);
}
.commercial-choices label {
  font-weight: var(--font-weight-semibold);
}
.commercial-choices p {
  margin: var(--space-1) 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-body);
}
</style>
