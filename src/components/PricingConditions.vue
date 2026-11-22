<script setup lang="ts" vapor>
import { computed } from "vue";
import type { WebsitePricingSelector } from "../catalog/website-schema.ts";
import {
  decimalRangeLabel,
  isIntegerSelector,
  pricingInputError,
} from "../catalog/pricing-selector-input.ts";
import {
  formatUnitExpression,
  formatRecurringTimeSchedule,
  formatConditionValue,
} from "../catalog/pricing-presentation.ts";
import UiChoice from "./UiChoice.vue";
import UiIcon from "./UiIcon.vue";
import UiTooltip from "./UiTooltip.vue";
import { pricingConditionHeading } from "../pricing/condition-presentation.ts";

const props = defineProps<{
  prefix: string;
  selectors: readonly WebsitePricingSelector[];
  inputs: Readonly<Record<string, string>>;
  followRegion?: { key: string; label: string } | undefined;
}>();
const emit = defineEmits<{ input: [key: string, value: string] }>();
const booleanOptions = [
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];
const conditions = computed(() =>
  props.selectors.map((selector) => ({
    selector,
    ...pricingConditionHeading(selector),
  })),
);
function inputValue(key: string): string {
  return props.inputs[key] ?? "";
}
function choiceOptions(selector: Exclude<WebsitePricingSelector, { kind: "decimal_range" }>) {
  switch (selector.kind) {
    case "categorical":
      return selector.values.map(({ key, value, label }) => ({
        value: key,
        label: formatConditionValue(selector.dimension, value, label),
      }));
    case "boolean":
      return booleanOptions;
    case "decimal_values":
      return selector.values.map((value) => ({ value, label: value }));
    case "decimal_buckets":
      return selector.values.map(({ key, label }) => ({ value: key, label }));
  }
}
function setInput(key: string, value: string): void {
  emit("input", key, value);
}
function setDecimalInput(key: string, event: Event): void {
  setInput(key, event.target instanceof HTMLInputElement ? event.target.value : "");
}
function decimalInputError(
  selector: Extract<WebsitePricingSelector, { kind: "decimal_range" }>,
): string | undefined {
  return pricingInputError(selector, inputValue(selector.key));
}
function scheduleRows(selector: WebsitePricingSelector) {
  if (selector.kind !== "categorical") return [];
  return selector.values.flatMap(({ key, label, schedule }) =>
    schedule === undefined
      ? []
      : [
          {
            key,
            label,
            cadence: schedule.kind.startsWith("weekly_") ? "Weekly" : "Daily",
            rule: formatRecurringTimeSchedule(schedule),
            timeZone: schedule.time_zone,
          },
        ],
  );
}
</script>

<template>
  <div
    v-for="({ selector, label, description }, index) in conditions"
    :key="selector.key"
    class="pricing-condition"
  >
    <label :id="`${prefix}-selector-${index}-label`" :for="`${prefix}-selector-${index}`">
      <UiTooltip
        v-if="description"
        class="tooltip-text-trigger"
        tabindex="0"
        :content="description"
        :aria-label="`${label}: ${description}`"
        >{{ label }}</UiTooltip
      >
      <template v-else>{{ label }}</template>
      <template v-if="'unit' in selector">{{
        ` (${formatUnitExpression(selector.unit)})`
      }}</template>
    </label>
    <UiChoice
      v-if="selector.kind !== 'decimal_range'"
      :id="`${prefix}-selector-${index}`"
      :model-value="inputValue(selector.key)"
      :options="choiceOptions(selector)"
      :empty-label="
        selector.kind === 'categorical' && followRegion?.key === selector.key
          ? `Pricing region · ${followRegion.label}`
          : undefined
      "
      @update:model-value="setInput(selector.key, $event)"
    />
    <input
      v-else
      :id="`${prefix}-selector-${index}`"
      :inputmode="isIntegerSelector(selector) ? 'numeric' : 'decimal'"
      :value="inputValue(selector.key)"
      :aria-invalid="decimalInputError(selector) === undefined ? undefined : true"
      :aria-describedby="`${prefix}-selector-${index}-guidance`"
      placeholder="Enter value"
      @input="setDecimalInput(selector.key, $event)"
    />
    <small
      v-if="selector.kind === 'decimal_range'"
      :id="`${prefix}-selector-${index}-guidance`"
      :class="decimalInputError(selector) === undefined ? 'selector-hint' : 'selector-error'"
    >
      {{ decimalInputError(selector) ?? `Supported: ${decimalRangeLabel(selector)}` }}
    </small>
    <details v-if="scheduleRows(selector).length > 0" class="schedule-rule">
      <summary>
        <span
          >{{ scheduleRows(selector)[0]?.cadence }} rule ·
          {{ scheduleRows(selector)[0]?.timeZone }}</span
        >
        <UiIcon name="chevron-right" />
      </summary>
      <dl>
        <div
          v-for="row in scheduleRows(selector)"
          :key="row.key"
          :data-selected="inputValue(selector.key) === row.key"
        >
          <dt>{{ row.label }}</dt>
          <dd>{{ row.rule }}</dd>
        </div>
      </dl>
    </details>
  </div>
</template>

<style scoped>
.schedule-rule > summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  list-style: none;
  cursor: pointer;
}
.schedule-rule > summary::-webkit-details-marker {
  display: none;
}
.schedule-rule > summary .ui-icon {
  width: var(--icon-size-xs);
  height: var(--icon-size-xs);
  transition: transform var(--duration-fast) var(--easing-standard);
}
.schedule-rule[open] > summary .ui-icon {
  transform: rotate(90deg);
}
.pricing-condition {
  display: grid;
  min-width: 0;
  gap: var(--space-1);
}

.pricing-condition > label {
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
}

.pricing-condition :deep(.ui-select-control),
.pricing-condition input {
  min-width: 0;
  height: var(--control-height-default);
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  background: var(--color-surface);
  font: inherit;
}

.pricing-condition :deep(.ui-select-control),
.pricing-condition :deep(.ui-select option) {
  font-size: var(--font-size-meta);
}

.pricing-condition :deep(.ui-select-control:has(.ui-select:focus-visible)),
.pricing-condition input:focus-visible {
  border-color: var(--color-accent);
  outline: var(--stroke-focus) solid var(--color-accent);
  outline-offset: calc(var(--stroke-focus) * -1);
}

.pricing-condition .selector-hint,
.pricing-condition .selector-error {
  line-height: var(--line-height-tight);
}

.pricing-condition .selector-error {
  color: var(--color-status-danger);
}

.schedule-rule {
  overflow: hidden;
  border: var(--stroke-hairline) solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-subtle);
}

.schedule-rule > summary {
  min-height: var(--control-height-compact);
  padding-inline: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
  font-weight: var(--font-weight-medium);
}

.schedule-rule[open] > summary {
  border-bottom: var(--stroke-hairline) solid var(--color-border-subtle);
}

.schedule-rule dl,
.schedule-rule dd {
  margin: 0;
}

.schedule-rule dl {
  display: grid;
  background: var(--color-surface);
}

.schedule-rule dl > div {
  display: grid;
  grid-template-columns: var(--space-2) minmax(0, 1fr) minmax(0, 2fr);
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-2-5);
  border-bottom: var(--stroke-hairline) solid var(--color-border-subtle);
  transition: background-color var(--duration-fast) var(--easing-standard);
}

.schedule-rule dl > div:last-child {
  border-bottom: 0;
}

.schedule-rule dl > div::before {
  width: var(--space-2);
  height: var(--space-2);
  border: var(--stroke-hairline) solid var(--color-border-default);
  border-radius: var(--radius-full);
  background: var(--color-surface);
  content: "";
}

.schedule-rule dl > div[data-selected="true"] {
  background: var(--color-accent-soft);
}

.schedule-rule dl > div[data-selected="true"]::before {
  border-color: var(--color-accent);
  background: var(--color-accent);
}

.schedule-rule dt {
  font-size: var(--font-size-meta);
  font-weight: var(--font-weight-medium);
}

.schedule-rule dd {
  color: var(--color-text-secondary);
  font-size: var(--font-size-meta);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 640px) {
  .schedule-rule dl > div {
    grid-template-columns: var(--space-2) minmax(0, 1fr);
  }
  .schedule-rule dd {
    grid-column: 2;
    text-align: left;
  }
}
</style>
