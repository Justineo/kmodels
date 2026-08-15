<script setup lang="ts" vapor>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { canonicalJson } from "../catalog/canonical-value.ts";
import { isPricingDecimal } from "../catalog/pricing-constants.ts";
import {
  evaluateApplicability,
  evaluateModelApplicability,
  formatCategoricalValue,
  formatDailyTimeSchedule,
  formatDimension,
  formatUnitExpression,
  isModelDimension,
  isWholeNumberDimension,
  type PricingSelection,
} from "../catalog/pricing-presentation.ts";
import { publishedValidityStatus } from "../catalog/pricing-time.ts";
import { formatRateUnit, formatSentenceCase } from "../catalog/presentation.ts";
import {
  projectWebsitePricingTimeline,
  projectWebsiteRateQuery,
} from "../catalog/website-pricing-query.ts";
import type {
  WebsitePriceApplicability,
  WebsitePriceCondition,
  WebsitePricingOffer,
  WebsitePricingSelector,
  WebsitePublishedValidity,
} from "../catalog/website-schema.ts";
import ChargeDriverFacts from "./ChargeDriverFacts.vue";
import UiIcon from "./UiIcon.vue";
import UiSelect from "./UiSelect.vue";

const props = defineProps<{
  offer: WebsitePricingOffer;
  modelRef: string;
}>();

interface ScopeCopy {
  primary: string;
  secondary?: string;
}

const inputs = ref<Record<string, string>>({});
const liveNow = ref(new Date().toISOString());
const viewingUpcoming = ref(false);
const timeline = computed(() => projectWebsitePricingTimeline(props.offer, liveNow.value));
const displayOffer = computed(() =>
  viewingUpcoming.value && timeline.value.upcoming !== undefined
    ? timeline.value.upcoming.offer
    : timeline.value.current,
);
const selectors = computed(() => displayOffer.value.selectors);
type FixedSelector = Extract<WebsitePricingSelector, { kind: "categorical" | "decimal_values" }>;
const configurableSelectors = computed<WebsitePricingSelector[]>(() =>
  selectors.value.filter((selector) => !isFixedSelector(selector)),
);
const fixedSelectionValues = computed(() =>
  selectors.value.filter(isFixedSelector).map(fixedSelection),
);
const selectionValues = computed(() => [
  ...configurableSelectors.value.flatMap((selector) => {
    const value = selection(selector);
    return value === undefined ? [] : [value];
  }),
  ...fixedSelectionValues.value,
]);
const visibleStates = computed(() => matchingRows(displayOffer.value.states));
const rateProjection = computed(() =>
  projectWebsiteRateQuery(displayOffer.value, props.modelRef, selectionValues.value),
);
const rateSelectors = computed(() => {
  const keys = new Set(
    projectWebsiteRateQuery(
      displayOffer.value,
      props.modelRef,
      fixedSelectionValues.value,
    ).unresolved_dimensions.map(canonicalJson),
  );
  return configurableSelectors.value.filter(({ key }) => keys.has(key));
});
const visibleRates = computed(() =>
  rateProjection.value.rates.map(({ row }) => ({ ...row, qualifier: validityNote(row.validity) })),
);
const visibleAllowances = computed(() => matchingRows(displayOffer.value.allowances));
const visibleContributions = computed(() => matchingRows(displayOffer.value.contributions));
const unresolvedRateDimensions = computed(() => rateProjection.value.unresolved_dimensions);
const visibleUnnormalized = computed(() =>
  displayOffer.value.unnormalized
    .filter(({ possible_scope }) => possible_scope === undefined || applies(possible_scope))
    .map((row) => ({
      ...row,
      scope:
        row.possible_scope === undefined
          ? qualifiedScope("Applicability not normalized", row.validity)
          : scopeCopy(row.possible_scope, row.validity),
    })),
);
const incompleteCount = computed(
  () => visibleUnnormalized.value.filter(({ impact }) => impact === "base_price").length,
);
const showOfferStates = computed(
  () => visibleStates.value.length > 0 && displayOffer.value.states.length > 1,
);
const showPublishedStatus = computed(
  () =>
    displayOffer.value.rates.length === 0 &&
    displayOffer.value.state_summary !== "Metered pricing" &&
    displayOffer.value.state_summary !== "Incomplete",
);
const booleanOptions = [
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];

watch(
  () => props.offer.id,
  () => {
    inputs.value = {};
    viewingUpcoming.value = false;
    scheduleClockRefresh();
  },
);

watch(viewingUpcoming, () => {
  inputs.value = {};
});

watch(
  () => timeline.value.upcoming?.effective_at,
  () => {
    viewingUpcoming.value = false;
  },
);

let clockTimer: ReturnType<typeof setTimeout> | undefined;

onMounted(scheduleClockRefresh);
onBeforeUnmount(() => {
  if (clockTimer !== undefined) clearTimeout(clockTimer);
});

function scheduleClockRefresh(): void {
  if (clockTimer !== undefined) clearTimeout(clockTimer);
  clockTimer = undefined;
  liveNow.value = new Date().toISOString();
  const nextChangeAt = timeline.value.next_change_at;
  if (nextChangeAt === undefined) return;
  const delay = Math.min(Math.max(Date.parse(nextChangeAt) - Date.now() + 1, 1), 2_147_483_647);
  clockTimer = setTimeout(scheduleClockRefresh, delay);
}

function toggleUpcoming(): void {
  viewingUpcoming.value = !viewingUpcoming.value;
}

function applies(applicability: WebsitePriceApplicability): boolean {
  return evaluate(applicability).state !== "false";
}

function matches(applicability: WebsitePriceApplicability): boolean {
  return evaluate(applicability).state === "true";
}

function evaluate(applicability: WebsitePriceApplicability) {
  return evaluateModelApplicability(applicability, props.modelRef, selectionValues.value);
}

function matchingRows<
  T extends {
    applicability: WebsitePriceApplicability;
    validity?: WebsitePublishedValidity | undefined;
  },
>(rows: readonly T[]): Array<T & { qualifier: string | undefined }> {
  return rows
    .filter(({ applicability }) => matches(applicability))
    .map((row) => ({
      ...row,
      qualifier: validityNote(row.validity),
    }));
}

function scopeCopy(
  applicability: WebsitePriceApplicability,
  validity: WebsitePublishedValidity | undefined,
): ScopeCopy {
  const result = evaluate(applicability);
  const scope = applicabilityLabel(applicability);
  if (result.state !== "missing") return qualifiedScope(scope, validity);
  return {
    primary: `Choose ${result.missing_dimensions.map(formatDimension).join(", ")}`,
    secondary: [scope, validityNote(validity)]
      .filter((value): value is string => value !== undefined)
      .join(" · "),
  };
}

function qualifiedScope(
  primary: string,
  validity: WebsitePublishedValidity | undefined,
): ScopeCopy {
  const secondary = validityNote(validity);
  return secondary === undefined ? { primary } : { primary, secondary };
}

function applicabilityLabel(applicability: WebsitePriceApplicability): string {
  const clauses = applicability.any_of.map(({ all_of }) =>
    all_of.filter(({ dimension }) => !isModelDimension(dimension)).map(conditionLabel),
  );
  if (clauses.some((conditions) => conditions.length === 0)) return "All contexts";
  const labels = clauses.map((conditions) => conditions.join(" · "));
  if (labels.length <= 2) return labels.join(" or ");
  return `${labels[0]} or ${labels[1]} · +${labels.length - 2} alternatives`;
}

function conditionLabel(condition: WebsitePriceCondition): string {
  const label = formatDimension(condition.dimension);
  if (condition.kind === "categorical")
    return `${label}: ${condition.values.map(formatCategoricalValue).join(", ")}`;
  if (condition.kind === "boolean") return condition.value ? label : `No ${label.toLowerCase()}`;
  const bounds = [
    condition.lower === undefined
      ? undefined
      : `${condition.lower.inclusive ? "≥" : ">"} ${condition.lower.value}`,
    condition.upper === undefined
      ? undefined
      : `${condition.upper.inclusive ? "≤" : "<"} ${condition.upper.value}`,
  ].filter((value): value is string => value !== undefined);
  return `${label}: ${bounds.join(" · ")} ${formatUnitExpression(condition.unit)}`;
}

function validityNote(validity: WebsitePublishedValidity | undefined): string | undefined {
  if (validity === undefined || publishedValidityStatus(validity, liveNow.value) !== "unresolved")
    return undefined;
  const from = validity.from === undefined ? undefined : `From ${formatBoundary(validity.from)}`;
  const until =
    validity.until === undefined ? undefined : `Until ${formatBoundary(validity.until)}`;
  return [from, until].filter((value): value is string => value !== undefined).join(" · ");
}

function formatBoundary(boundary: NonNullable<WebsitePublishedValidity["from"]>): string {
  return boundary.precision === "datetime" ? formatEffectiveAt(boundary.value) : boundary.value;
}

function formatEffectiveAt(value: string): string {
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

function isFixedSelector(selector: WebsitePricingSelector): selector is FixedSelector {
  return (
    (selector.kind === "categorical" || selector.kind === "decimal_values") &&
    selector.values.length === 1
  );
}

function fixedSelection(selector: FixedSelector): PricingSelection {
  return selector.kind === "categorical"
    ? {
        dimension: selector.dimension,
        kind: "categorical",
        value: selector.values[0]!.value,
      }
    : {
        dimension: selector.dimension,
        kind: "decimal",
        value: selector.values[0]!,
        unit: selector.unit,
      };
}

type DecimalRangeSelector = Extract<WebsitePricingSelector, { kind: "decimal_range" }>;

function setInput(key: string, value: string): void {
  if (value === "") delete inputs.value[key];
  else inputs.value[key] = value;
}

function setDecimalInput(key: string, event: Event): void {
  setInput(key, event.target instanceof HTMLInputElement ? event.target.value : "");
}

function selection(selector: WebsitePricingSelector): PricingSelection | undefined {
  const value = inputValue(selector.key);
  if (value === "") return undefined;
  if (selector.kind === "categorical") {
    const selected = selector.values.find(({ key }) => key === value);
    return selected === undefined
      ? undefined
      : { dimension: selector.dimension, kind: "categorical", value: selected.value };
  }
  if (selector.kind === "boolean")
    return value === "true" || value === "false"
      ? { dimension: selector.dimension, kind: "boolean", value: value === "true" }
      : undefined;
  if (selector.kind === "decimal_buckets") {
    const selected = selector.values.find(({ key }) => key === value);
    return selected === undefined
      ? undefined
      : {
          dimension: selector.dimension,
          kind: "decimal_range",
          unit: selector.unit,
          ...(selected.lower === undefined ? {} : { lower: selected.lower }),
          ...(selected.upper === undefined ? {} : { upper: selected.upper }),
        };
  }
  if (
    (selector.kind === "decimal_values" && !selector.values.includes(value)) ||
    (selector.kind === "decimal_range" && !isAcceptedDecimal(selector, value))
  )
    return undefined;
  return { dimension: selector.dimension, kind: "decimal", value, unit: selector.unit };
}

function isIntegerSelector(selector: WebsitePricingSelector): boolean {
  return isWholeNumberDimension(selector.dimension);
}

function isAcceptedDecimal(selector: DecimalRangeSelector, value: string): boolean {
  if (!isPricingDecimal(value) || (isIntegerSelector(selector) && value.includes(".")))
    return false;
  return (
    evaluateApplicability(
      {
        any_of: selector.ranges.map((range) => ({
          all_of: [
            {
              kind: "decimal_range",
              dimension: selector.dimension,
              unit: selector.unit,
              ...range,
            },
          ],
        })),
      },
      [{ dimension: selector.dimension, kind: "decimal", value, unit: selector.unit }],
    ).state === "true"
  );
}

function decimalInputError(selector: DecimalRangeSelector): string | undefined {
  const value = inputValue(selector.key);
  if (value === "" || isAcceptedDecimal(selector, value)) return undefined;
  if (!isPricingDecimal(value)) return "Enter a non-negative number.";
  if (isIntegerSelector(selector) && value.includes(".")) return "Enter a whole number.";
  return "No published pricing range includes this value.";
}

function decimalRangeLabel(selector: DecimalRangeSelector): string {
  return selector.ranges.map(({ lower, upper }) => rangeLabel(lower, upper)).join(" or ");
}

function rangeLabel(
  lower: { value: string; inclusive: boolean } | undefined,
  upper: { value: string; inclusive: boolean } | undefined,
): string {
  if (lower === undefined) return `${upper?.inclusive === true ? "≤" : "<"} ${upper?.value ?? ""}`;
  if (upper === undefined) return `${lower.inclusive ? "≥" : ">"} ${lower.value}`;
  if (lower.inclusive && upper.inclusive) return `${lower.value}–${upper.value}`;
  return `${lower.inclusive ? "≥" : ">"} ${lower.value} and ${upper.inclusive ? "≤" : "<"} ${upper.value}`;
}

function inputValue(key: string): string {
  return inputs.value[key] ?? "";
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
            rule: formatDailyTimeSchedule(schedule),
            timeZone: schedule.time_zone,
          },
        ],
  );
}
</script>

<template>
  <div class="offer-breakdown">
    <div v-if="timeline.upcoming" class="pricing-change">
      <span class="pricing-change-icon"><UiIcon name="calendar-clock" /></span>
      <p>
        <strong>{{ viewingUpcoming ? "Previewing new rates" : "New rates" }}</strong>
        <time :datetime="timeline.upcoming.effective_at">
          {{ formatEffectiveAt(timeline.upcoming.effective_at) }}
        </time>
      </p>
      <button type="button" @click="toggleUpcoming">
        {{ viewingUpcoming ? "Current" : "Preview" }}
      </button>
    </div>

    <section v-if="rateSelectors.length > 0" class="pricing-context" aria-label="Pricing options">
      <div class="pricing-selector-grid">
        <div v-for="(selector, index) in rateSelectors" :key="selector.key">
          <label :for="`${offer.id}-selector-${index}`">
            {{ selector.label }}
            <template v-if="'unit' in selector"
              >({{ formatUnitExpression(selector.unit) }})</template
            >
          </label>
          <template v-if="selector.kind === 'categorical'">
            <UiSelect
              :id="`${offer.id}-selector-${index}`"
              :model-value="inputValue(selector.key)"
              :options="selector.values.map(({ key, label }) => ({ value: key, label }))"
              placeholder="Choose…"
              @update:model-value="setInput(selector.key, $event)"
            />
            <details v-if="scheduleRows(selector).length > 0" class="schedule-rule">
              <summary>
                <span>Daily rule · {{ scheduleRows(selector)[0]?.timeZone }}</span>
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
            :id="`${offer.id}-selector-${index}`"
            :model-value="inputValue(selector.key)"
            :options="booleanOptions"
            placeholder="Choose…"
            @update:model-value="setInput(selector.key, $event)"
          />
          <UiSelect
            v-else-if="selector.kind === 'decimal_values'"
            :id="`${offer.id}-selector-${index}`"
            :model-value="inputValue(selector.key)"
            :options="selector.values.map((value) => ({ value, label: value }))"
            placeholder="Choose…"
            @update:model-value="setInput(selector.key, $event)"
          />
          <UiSelect
            v-else-if="selector.kind === 'decimal_buckets'"
            :id="`${offer.id}-selector-${index}`"
            :model-value="inputValue(selector.key)"
            :options="selector.values.map(({ key, label }) => ({ value: key, label }))"
            placeholder="Choose…"
            @update:model-value="setInput(selector.key, $event)"
          />
          <input
            v-else
            :id="`${offer.id}-selector-${index}`"
            :inputmode="isIntegerSelector(selector) ? 'numeric' : 'decimal'"
            :value="inputValue(selector.key)"
            :aria-invalid="decimalInputError(selector) === undefined ? undefined : true"
            :aria-describedby="`${offer.id}-selector-${index}-guidance`"
            placeholder="Enter value"
            @input="setDecimalInput(selector.key, $event)"
          />
          <small
            v-if="selector.kind === 'decimal_range'"
            :id="`${offer.id}-selector-${index}-guidance`"
            :class="decimalInputError(selector) === undefined ? 'selector-hint' : 'selector-error'"
          >
            {{ decimalInputError(selector) ?? `Supported: ${decimalRangeLabel(selector)}` }}
          </small>
        </div>
      </div>
    </section>

    <section
      v-if="
        displayOffer.rates.length > 0 &&
        (visibleRates.length > 0 || unresolvedRateDimensions.length === 0)
      "
      class="offer-section"
      aria-label="Published rates"
    >
      <dl v-if="visibleRates.length > 0" class="rate-grid fact-grid">
        <div v-for="rate in visibleRates" :key="rate.key">
          <dt>
            <span class="rate-name">{{ rate.label }}</span>
            <small v-if="rate.qualifier">{{ rate.qualifier }}</small>
          </dt>
          <dd class="numeric" :aria-label="rate.accessible_text">
            <span class="exact-rate">{{ rate.amount }}</span>
            <small>{{ formatRateUnit(rate.unit) }}</small>
          </dd>
        </div>
      </dl>
      <p v-else-if="unresolvedRateDimensions.length === 0" class="context-prompt">
        No rates match the selected context.
      </p>
    </section>

    <div v-if="showPublishedStatus" class="published-status">
      <small>Status</small>
      <strong>{{ displayOffer.state_summary }}</strong>
    </div>

    <div v-if="incompleteCount > 0" class="pricing-warning" role="status">
      <strong
        >{{ incompleteCount }} published rate exception{{
          incompleteCount === 1 ? "" : "s"
        }}</strong
      >
      <span>Exact rates are shown above. Exceptions are available below.</span>
    </div>

    <section v-if="visibleAllowances.length > 0" class="offer-section">
      <header class="pricing-subheading"><h6>Allowances</h6></header>
      <div class="allowance-list">
        <div v-for="allowance in visibleAllowances" :key="allowance.key">
          <div>
            <span class="allowance-value">{{ allowance.value }}</span>
            <small>{{ allowance.target }} · {{ allowance.reset }}</small>
            <small v-if="allowance.qualifier">{{ allowance.qualifier }}</small>
          </div>
        </div>
      </div>
    </section>

    <section v-if="visibleContributions.length > 0" class="offer-section">
      <header class="pricing-subheading"><h6>Additional usage</h6></header>
      <div class="allowance-list">
        <div v-for="contribution in visibleContributions" :key="contribution.key">
          <div>
            <span class="allowance-value">{{ contribution.label }}</span>
            <small>{{ contribution.target }}</small>
            <template v-if="contribution.drivers.length > 0">
              <ChargeDriverFacts
                v-for="(driver, index) in contribution.drivers"
                :key="index"
                :driver="driver"
              />
            </template>
            <small v-else>No exact public quantity signal is bound.</small>
            <small v-if="contribution.qualifier">{{ contribution.qualifier }}</small>
          </div>
        </div>
      </div>
    </section>

    <section v-if="showOfferStates" class="offer-section">
      <header class="pricing-subheading"><h6>Pricing states</h6></header>
      <div class="state-list">
        <div
          v-for="state in visibleStates"
          :key="state.key"
          class="state-row"
          :data-state="state.state"
        >
          <span class="state-marker"></span>
          <div>
            <span class="state-label">{{ state.label }}</span>
            <small v-if="state.qualifier">{{ state.qualifier }}</small>
          </div>
        </div>
      </div>
    </section>

    <details v-if="visibleUnnormalized.length > 0" class="pricing-disclosure">
      <summary>
        <span><UiIcon name="chevron-right" />Source exceptions</span>
        <strong>{{ visibleUnnormalized.length }}</strong>
      </summary>
      <div class="raw-fact-list">
        <div v-for="fact in visibleUnnormalized" :key="fact.key">
          <header>
            <strong>{{ fact.label }}</strong>
            <span>{{ fact.reason }}</span>
          </header>
          <small v-for="detail in fact.details ?? []" :key="detail">{{ detail }}</small>
          <small>{{ formatSentenceCase(fact.impact) }} · {{ fact.scope.primary }}</small>
          <small v-if="fact.scope.secondary">{{ fact.scope.secondary }}</small>
        </div>
      </div>
    </details>
  </div>
</template>

<style scoped>
.offer-breakdown {
  min-width: 0;
}

.pricing-subheading,
.schedule-rule > summary,
.state-row,
.allowance-list > div,
.pricing-disclosure > summary,
.raw-fact-list header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.pricing-change {
  display: grid;
  min-height: var(--target-size-minimum);
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-2);
  padding: var(--space-2) var(--space-2-5);
  border: var(--stroke-hairline) solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-subtle);
}

.pricing-change-icon {
  display: grid;
  width: var(--control-height-compact);
  height: var(--control-height-compact);
  place-items: center;
  border-radius: var(--radius-full);
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

.pricing-change-icon .ui-icon {
  width: var(--icon-size-sm);
  height: var(--icon-size-sm);
}

.pricing-change p {
  display: grid;
  min-width: 0;
  gap: var(--space-0-5);
  margin: 0;
  font-size: var(--font-size-body);
}

.pricing-change time {
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
}

.pricing-change button {
  min-height: var(--control-height-compact);
  padding-inline: var(--space-2);
  border: var(--stroke-hairline) solid var(--color-border-default);
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  background: var(--color-surface);
  font: inherit;
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  white-space: nowrap;
}

.pricing-change button:hover {
  border-color: var(--color-border-interactive);
  background: var(--color-surface-hover);
}

.offer-section {
  margin-top: var(--space-3);
}

.pricing-context {
  margin-top: var(--space-3);
}

.schedule-rule > summary {
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

.pricing-subheading {
  min-height: var(--control-height-compact);
  gap: var(--space-3);
}

.pricing-subheading h6 {
  margin: 0;
  font-size: var(--font-size-body);
}

.pricing-warning,
.published-status {
  display: grid;
  gap: var(--space-1);
  margin-top: var(--space-4);
  padding: var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-subtle);
}

.pricing-warning {
  border-color: var(--color-status-warning);
}

.pricing-warning span,
.published-status small {
  color: var(--color-text-muted);
  font-size: var(--font-size-body);
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

.pricing-selector-grid label {
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

.context-prompt {
  margin: var(--space-2) 0 0;
  padding: var(--space-2-5) var(--space-3);
  border-left: var(--stroke-focus) solid var(--color-border-default);
  color: var(--color-text-muted);
  background: var(--color-surface-subtle);
  font-size: var(--font-size-body);
  line-height: var(--line-height-body);
}

.state-list,
.allowance-list,
.raw-fact-list {
  display: grid;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.state-row,
.allowance-list > div,
.raw-fact-list > div {
  gap: var(--space-3);
  padding: var(--space-2-5) var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
}

.state-row > div,
.allowance-list > div > div {
  display: grid;
  flex: 1;
  gap: var(--space-0-5);
}

.state-marker {
  width: var(--space-2);
  height: var(--space-2);
  border-radius: var(--radius-full);
  background: var(--color-accent);
}

.state-label,
.allowance-value {
  color: var(--color-text-primary);
  font-weight: var(--font-weight-medium);
}

.state-row small,
.allowance-list small,
.raw-fact-list small {
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
}

.rate-grid {
  margin-top: var(--space-2);
  padding: 0;
}

.rate-grid:has(> :only-child) {
  grid-template-columns: 1fr;
  width: 50%;
}

.rate-grid dt > * {
  display: block;
}

.rate-grid dt small {
  margin-top: var(--space-0-5);
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
}

.rate-grid dd {
  display: flex;
  align-items: baseline;
  gap: var(--space-1);
  white-space: nowrap;
}

.rate-grid dd small {
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
}

.pricing-disclosure {
  margin-top: var(--space-4);
}

.pricing-disclosure > summary {
  min-height: var(--control-height-comfortable);
  list-style: none;
  cursor: pointer;
}

.pricing-disclosure > summary::-webkit-details-marker {
  display: none;
}

.pricing-disclosure > summary > span {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}

.pricing-disclosure > summary .ui-icon {
  transition: transform var(--duration-fast) var(--easing-standard);
}

.pricing-disclosure[open] > summary .ui-icon {
  transform: rotate(90deg);
}

.raw-fact-list header {
  gap: var(--space-2);
}

.raw-fact-list > div > small {
  display: block;
  margin-top: var(--space-1);
}

@media (max-width: 640px) {
  .pricing-selector-grid {
    grid-template-columns: 1fr;
  }

  .pricing-change {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .pricing-change button {
    grid-column: 2;
    justify-self: start;
  }

  .schedule-rule dl > div {
    grid-template-columns: var(--space-2) minmax(0, 1fr);
  }

  .schedule-rule dd {
    grid-column: 2;
    text-align: left;
  }

  .rate-grid:has(> :only-child) {
    width: 100%;
  }
}
</style>
