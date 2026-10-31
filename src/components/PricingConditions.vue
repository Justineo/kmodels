<script setup lang="ts" vapor>
import type { WebsitePricingSelector } from "../catalog/website-schema.ts";
import {
  decimalRangeLabel,
  isIntegerSelector,
  pricingInputError,
} from "../catalog/pricing-selector-input.ts";
import {
  formatUnitExpression,
  formatRecurringTimeSchedule,
} from "../catalog/pricing-presentation.ts";
import UiSelect from "./UiSelect.vue";
import UiIcon from "./UiIcon.vue";

const props = defineProps<{
  prefix: string;
  selectors: readonly WebsitePricingSelector[];
  inputs: Readonly<Record<string, string>>;
}>();
const emit = defineEmits<{ input: [key: string, value: string] }>();
const booleanOptions = [
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];
function inputValue(key: string): string {
  return props.inputs[key] ?? "";
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
  <section v-if="selectors.length > 0" class="pricing-context" aria-label="Pricing options">
    <div class="pricing-selector-grid">
      <div v-for="(selector, index) in selectors" :key="selector.key">
        <label :for="`${prefix}-selector-${index}`">
          {{ selector.label }}
          <template v-if="'unit' in selector">({{ formatUnitExpression(selector.unit) }})</template>
        </label>
        <template v-if="selector.kind === 'categorical'">
          <UiSelect
            :id="`${prefix}-selector-${index}`"
            :model-value="inputValue(selector.key)"
            :options="
              selector.values.map((option) => ({
                value: option.key,
                label: option.label,
              }))
            "
            placeholder="Choose…"
            @update:model-value="setInput(selector.key, $event)"
          />
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
        </template>
        <UiSelect
          v-else-if="selector.kind === 'boolean'"
          :id="`${prefix}-selector-${index}`"
          :model-value="inputValue(selector.key)"
          :options="booleanOptions"
          placeholder="Choose…"
          @update:model-value="setInput(selector.key, $event)"
        />
        <UiSelect
          v-else-if="selector.kind === 'decimal_values'"
          :id="`${prefix}-selector-${index}`"
          :model-value="inputValue(selector.key)"
          :options="selector.values.map((value) => ({ value, label: value }))"
          placeholder="Choose…"
          @update:model-value="setInput(selector.key, $event)"
        />
        <UiSelect
          v-else-if="selector.kind === 'decimal_buckets'"
          :id="`${prefix}-selector-${index}`"
          :model-value="inputValue(selector.key)"
          :options="selector.values.map(({ key, label }) => ({ value: key, label }))"
          placeholder="Choose…"
          @update:model-value="setInput(selector.key, $event)"
        />
        <input
          v-else-if="selector.kind === 'decimal_range'"
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
      </div>
    </div>
  </section>
</template>

<style scoped>
.pricing-context {
  margin-top: var(--space-3);
}
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
.pricing-selector-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
  gap: var(--space-2);
}

.pricing-selector-grid > div {
  display: grid;
  min-width: 0;
  gap: var(--space-1);
}

.pricing-selector-grid > div > label {
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
}

.pricing-selector-grid :deep(.ui-select-control),
.pricing-selector-grid input {
  min-width: 0;
  height: var(--control-height-default);
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  background: var(--color-surface);
  font: inherit;
}

.pricing-selector-grid :deep(.ui-select-control),
.pricing-selector-grid :deep(.ui-select option) {
  font-size: var(--font-size-meta);
}

.pricing-selector-grid :deep(.ui-select-control:has(.ui-select:focus-visible)),
.pricing-selector-grid input:focus-visible {
  border-color: var(--color-accent);
  outline: var(--stroke-focus) solid var(--color-accent);
  outline-offset: calc(var(--stroke-focus) * -1);
}

.pricing-selector-grid .selector-hint,
.pricing-selector-grid .selector-error {
  line-height: var(--line-height-tight);
}

.pricing-selector-grid .selector-error {
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
  .pricing-selector-grid {
    grid-template-columns: 1fr;
  }
  .schedule-rule dl > div {
    grid-template-columns: var(--space-2) minmax(0, 1fr);
  }
  .schedule-rule dd {
    grid-column: 2;
    text-align: left;
  }
}
</style>
