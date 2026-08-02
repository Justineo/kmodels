<script setup lang="ts" vapor>
import { computed, ref, watch } from "vue";
import { canonicalJson } from "../catalog/canonical-value.ts";
import { isPricingDecimal } from "../catalog/pricing-constants.ts";
import {
  evaluateApplicability,
  evaluateModelApplicability,
  formatCategoricalValue,
  formatDimension,
  formatUnitExpression,
  isModelDimension,
  type PricingSelection,
} from "../catalog/pricing-presentation.ts";
import { formatSentenceCase } from "../catalog/presentation.ts";
import type {
  WebsiteModel,
  WebsitePriceApplicability,
  WebsitePriceCondition,
  WebsitePricingDetail,
  WebsitePricingOffer,
  WebsitePricingSelector,
  WebsitePublishedValidity,
} from "../catalog/website-schema.ts";
import UiIcon from "./UiIcon.vue";
import UiSelect from "./UiSelect.vue";

const props = defineProps<{
  model: WebsiteModel;
  detail: WebsitePricingDetail | undefined;
  loading: boolean;
}>();

interface OfferGroup {
  key: "base" | "add_on";
  title: string;
  offers: WebsitePricingOffer[];
}

interface ScopeCopy {
  primary: string;
  secondary?: string;
}

const inputs = ref<Record<string, string>>({});
const selectedOfferId = ref("");
const offers = computed(() => props.detail?.offers ?? []);
const baseOffers = computed(() => offers.value.filter(({ role }) => role === "base"));
const addOns = computed(() => offers.value.filter(({ role }) => role === "add_on"));
const soleBaseOffer = computed(() =>
  baseOffers.value.length === 1 ? baseOffers.value[0] : undefined,
);
const offerGroups = computed<OfferGroup[]>(() => {
  const groups: OfferGroup[] = [];
  if (baseOffers.value.length > 1)
    groups.push({ key: "base", title: "Base offers", offers: baseOffers.value });
  if (addOns.value.length > 0)
    groups.push({ key: "add_on", title: "Add-ons", offers: addOns.value });
  return groups;
});
const activeOffer = computed(
  () => offers.value.find(({ id }) => id === selectedOfferId.value) ?? soleBaseOffer.value,
);
const selectors = computed(() => activeOffer.value?.selectors ?? []);
type CategoricalSelector = Extract<WebsitePricingSelector, { kind: "categorical" }>;
const fixedSelectors = computed(() => selectors.value.filter(isFixedSelector));
const configurableSelectors = computed<WebsitePricingSelector[]>(() =>
  selectors.value.filter((selector) => !isFixedSelector(selector)),
);
const selectionValues = computed(() => [
  ...selectors.value.flatMap((selector) => {
    const value = selection(selector);
    return value === undefined ? [] : [value];
  }),
  ...fixedSelectors.value.map(fixedSelection),
]);
const hasSelections = computed(() => Object.keys(inputs.value).length > 0);
const visibleStates = computed(() => matchingRows(activeOffer.value?.states ?? []));
const visibleRates = computed(() => matchingRows(activeOffer.value?.rates ?? []));
const visibleAllowances = computed(() => matchingRows(activeOffer.value?.allowances ?? []));
const unresolvedRateDimensions = computed(() => {
  const keys = new Set(
    (activeOffer.value?.rates ?? []).flatMap(({ applicability }) => {
      const result = evaluate(applicability);
      return result.state === "missing" ? result.missing_dimensions.map(canonicalJson) : [];
    }),
  );
  return selectors.value.filter(({ key }) => keys.has(key));
});
const contextPrompt = computed(() => {
  const labels = joinLabels(unresolvedRateDimensions.value.map(({ label }) => label));
  return `Choose ${labels} to ${
    visibleRates.value.length === 0 ? "see exact rates" : "resolve the remaining rates"
  }.`;
});
const visibleUnnormalized = computed(() =>
  (activeOffer.value?.unnormalized ?? [])
    .filter(({ possible_scope }) => possible_scope === undefined || applies(possible_scope))
    .map((row) => ({
      ...row,
      scope:
        row.possible_scope === undefined
          ? qualifiedScope("Applicability not normalized", row.validity)
          : scopeCopy(row.possible_scope, row.validity),
    })),
);
const incomplete = computed(() =>
  visibleUnnormalized.value.some(({ impact }) => impact === "base_price"),
);
const showOfferStates = computed(
  () => visibleStates.value.length > 0 && (activeOffer.value?.states.length ?? 0) > 1,
);
const booleanOptions = [
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];

watch(
  () => props.model.uid,
  () => {
    inputs.value = {};
    selectedOfferId.value = "";
  },
);

watch(offers, (current) => {
  if (selectedOfferId.value !== "" && !current.some(({ id }) => id === selectedOfferId.value))
    selectedOfferId.value = "";
});

function applies(applicability: WebsitePriceApplicability): boolean {
  return evaluate(applicability).state !== "false";
}

function matches(applicability: WebsitePriceApplicability): boolean {
  return evaluate(applicability).state === "true";
}

function evaluate(applicability: WebsitePriceApplicability) {
  return evaluateModelApplicability(applicability, props.model.uid, selectionValues.value);
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
      qualifier: row.validity === undefined ? undefined : validityNote(row.validity),
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
    secondary: [scope, validity === undefined ? undefined : validityNote(validity)]
      .filter((value): value is string => value !== undefined)
      .join(" · "),
  };
}

function qualifiedScope(
  primary: string,
  validity: WebsitePublishedValidity | undefined,
): ScopeCopy {
  return validity === undefined ? { primary } : { primary, secondary: validityNote(validity) };
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

function validityNote(validity: WebsitePublishedValidity): string {
  const from = validity.from === undefined ? "" : `from ${validity.from.value}`;
  const until = validity.until === undefined ? "" : `until ${validity.until.value}`;
  return `Validity-qualified; currentness not asserted (${[from, until].filter(Boolean).join(" ")})`;
}

function selectOffer(offerId: string): void {
  if (selectedOfferId.value === offerId) return;
  selectedOfferId.value = offerId;
  inputs.value = {};
}

function clearSelections(): void {
  inputs.value = {};
}

function offerState(offer: WebsitePricingOffer): string | undefined {
  const summary = offer.state_summary;
  return summary === "Metered pricing" || summary === "Incomplete" ? undefined : summary;
}

function isFixedSelector(selector: WebsitePricingSelector): selector is CategoricalSelector {
  return selector.kind === "categorical" && selector.values.length === 1;
}

function fixedSelection(selector: CategoricalSelector): PricingSelection {
  return {
    dimension: selector.dimension,
    kind: "categorical",
    value: selector.values[0]!.value,
  };
}

function fixedSelectorValue(selector: CategoricalSelector): string {
  return selector.values[0]!.label;
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
  if (
    (selector.kind === "decimal_values" && !selector.values.includes(value)) ||
    (selector.kind === "decimal_range" && !isAcceptedDecimal(selector, value))
  )
    return undefined;
  return { dimension: selector.dimension, kind: "decimal", value, unit: selector.unit };
}

function isIntegerSelector(selector: WebsitePricingSelector): boolean {
  return (
    selector.dimension.namespace === "kmodels" &&
    ["cache_ttl_seconds", "context_tokens", "input_tokens", "output_tokens"].includes(
      selector.dimension.value,
    )
  );
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

function joinLabels(labels: string[]): string {
  if (labels.length < 2) return labels[0] ?? "the required context";
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

function formatSnapshotAt(value: string): string {
  return `${value.slice(0, 10)} ${value.slice(11, 16)} UTC`;
}
</script>

<template>
  <section class="detail-section pricing-section" aria-labelledby="pricing-heading">
    <header class="pricing-section-header">
      <div>
        <h3 id="pricing-heading">Pricing</h3>
        <p v-if="detail?.snapshot?.publication === 'fresh'">
          Verified
          <time :datetime="detail.snapshot.observed_at">
            {{ formatSnapshotAt(detail.snapshot.observed_at) }}
          </time>
        </p>
      </div>
    </header>

    <p
      v-if="detail?.snapshot?.publication === 'retained'"
      class="pricing-refresh-status"
      role="status"
    >
      <span v-if="model.pricing.outcome === 'unknown'">
        No pricing was present in the provider snapshot verified on
        <time :datetime="detail.snapshot.observed_at">
          {{ formatSnapshotAt(detail.snapshot.observed_at) }} </time
        >.
      </span>
      <span v-else>
        Showing provider pricing verified on
        <time :datetime="detail.snapshot.observed_at">
          {{ formatSnapshotAt(detail.snapshot.observed_at) }} </time
        >.
      </span>
      <span>
        A refresh on
        <time :datetime="detail.snapshot.refresh_failure.attempted_at">
          {{ formatSnapshotAt(detail.snapshot.refresh_failure.attempted_at) }}
        </time>
        was rejected: {{ detail.snapshot.refresh_failure.message }}
      </span>
    </p>

    <div v-if="model.pricing.outcome === 'not_applicable'" class="pricing-outcome">
      <strong>Not applicable</strong>
      <span>This provider publishes no public pricing offer for this model.</span>
    </div>

    <div v-else-if="model.pricing.outcome === 'unknown'" class="pricing-outcome">
      <strong>Pricing unknown</strong>
      <span>No reliable public pricing offer is currently available.</span>
    </div>

    <div v-else-if="loading" class="pricing-empty" aria-live="polite">
      <span>Loading pricing…</span>
    </div>

    <template v-else-if="detail">
      <section
        v-if="soleBaseOffer"
        class="pricing-offer-group"
        aria-labelledby="base-offer-heading"
      >
        <header class="pricing-subheading">
          <h4 id="base-offer-heading">Base offer</h4>
          <button
            v-if="activeOffer?.id !== soleBaseOffer.id"
            type="button"
            @click="selectOffer(soleBaseOffer.id)"
          >
            View base offer
          </button>
        </header>
        <div class="offer-summary">
          <span class="offer-title">{{ soleBaseOffer.title }}</span>
          <span v-if="offerState(soleBaseOffer)" class="offer-state">
            {{ offerState(soleBaseOffer) }}
          </span>
        </div>
      </section>

      <fieldset v-for="group in offerGroups" :key="group.key" class="pricing-offer-group">
        <legend>{{ group.title }}</legend>
        <div class="offer-list">
          <label v-for="offer in group.offers" :key="offer.id" class="offer-choice">
            <input
              type="radio"
              :name="`pricing-offer-${model.uid}-${group.key}`"
              :value="offer.id"
              :checked="activeOffer?.id === offer.id"
              @change="selectOffer(offer.id)"
            />
            <span>
              <span class="offer-title">{{ offer.title }}</span>
              <small v-if="offerState(offer)" class="offer-state">
                {{ offerState(offer) }}
              </small>
            </span>
          </label>
        </div>
      </fieldset>

      <p v-if="activeOffer === undefined && offers.length > 0" class="context-prompt offer-prompt">
        Choose an offer to view its pricing.
      </p>

      <section
        v-if="activeOffer && selectors.length > 0"
        class="pricing-context"
        aria-labelledby="context-heading"
      >
        <header class="pricing-subheading">
          <h4 id="context-heading">Price calculator</h4>
          <button v-if="hasSelections" type="button" @click="clearSelections">Reset</button>
        </header>
        <div v-if="fixedSelectors.length > 0" class="fixed-context-list">
          <span v-for="selector in fixedSelectors" :key="selector.key">
            <small>{{ selector.label }}</small>
            <span>{{ fixedSelectorValue(selector) }}</span>
          </span>
        </div>
        <div v-if="configurableSelectors.length > 0" class="pricing-selector-grid">
          <label v-for="selector in configurableSelectors" :key="selector.key">
            <span>
              {{ selector.label }}
              <template
                v-if="selector.kind === 'decimal_values' || selector.kind === 'decimal_range'"
              >
                ({{ formatUnitExpression(selector.unit) }})
              </template>
            </span>
            <UiSelect
              v-if="selector.kind === 'categorical'"
              :model-value="inputValue(selector.key)"
              :options="
                selector.values.map(({ key, label }) => ({
                  value: key,
                  label,
                }))
              "
              placeholder="Choose…"
              @update:model-value="setInput(selector.key, $event)"
            />
            <UiSelect
              v-else-if="selector.kind === 'boolean'"
              :model-value="inputValue(selector.key)"
              :options="booleanOptions"
              placeholder="Choose…"
              @update:model-value="setInput(selector.key, $event)"
            />
            <UiSelect
              v-else-if="selector.kind === 'decimal_values'"
              :model-value="inputValue(selector.key)"
              :options="selector.values.map((value) => ({ value, label: value }))"
              placeholder="Choose…"
              @update:model-value="setInput(selector.key, $event)"
            />
            <input
              v-else
              :inputmode="isIntegerSelector(selector) ? 'numeric' : 'decimal'"
              :value="inputValue(selector.key)"
              :aria-invalid="decimalInputError(selector) === undefined ? undefined : true"
              :aria-describedby="`${selector.key}-range-guidance`"
              placeholder="Enter value"
              @input="setDecimalInput(selector.key, $event)"
            />
            <small
              v-if="selector.kind === 'decimal_range'"
              :id="`${selector.key}-range-guidance`"
              :class="
                decimalInputError(selector) === undefined ? 'selector-hint' : 'selector-error'
              "
            >
              {{ decimalInputError(selector) ?? `Supported: ${decimalRangeLabel(selector)}` }}
            </small>
          </label>
        </div>
      </section>

      <article v-if="activeOffer" :key="activeOffer.id" class="pricing-offer-view">
        <p v-if="activeOffer.compatibility" class="offer-compatibility">
          {{ activeOffer.compatibility }}
        </p>

        <div v-if="incomplete" class="pricing-warning" role="status">
          <strong>Pricing details incomplete</strong>
          <span
            >Some official pricing cannot be represented exactly. Shown rates may be
            incomplete.</span
          >
        </div>

        <section v-if="showOfferStates" class="offer-section">
          <header class="pricing-subheading">
            <h5>Offer state</h5>
          </header>
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

        <section v-if="activeOffer.rates.length > 0" class="offer-section">
          <header class="pricing-subheading">
            <h5>Rates</h5>
          </header>
          <p v-if="unresolvedRateDimensions.length > 0" class="context-prompt">
            {{ contextPrompt }}
          </p>
          <div v-if="visibleRates.length > 0" class="pricing-matrix">
            <table>
              <thead>
                <tr>
                  <th scope="col">Meter</th>
                  <th scope="col">Exact rate</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="rate in visibleRates" :key="rate.key">
                  <th scope="row">
                    <span class="rate-name">{{ rate.label }}</span>
                    <small v-if="rate.qualifier">{{ rate.qualifier }}</small>
                  </th>
                  <td class="numeric" :aria-label="rate.accessible_text">
                    <span class="exact-rate">{{ rate.amount }}</span>
                    <small>{{ rate.unit }}</small>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else-if="unresolvedRateDimensions.length === 0" class="context-prompt">
            No rates match the selected context.
          </p>
        </section>

        <section v-if="visibleAllowances.length > 0" class="offer-section">
          <header class="pricing-subheading">
            <h5>Allowances</h5>
          </header>
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

        <details v-if="visibleUnnormalized.length > 0" class="pricing-disclosure">
          <summary>
            <span><UiIcon name="chevron-right" />Unnormalized facts</span>
            <strong>{{ visibleUnnormalized.length }}</strong>
          </summary>
          <div class="raw-fact-list">
            <div v-for="fact in visibleUnnormalized" :key="fact.key">
              <header>
                <strong>{{ fact.label }}</strong>
                <span>{{ fact.reason }}</span>
              </header>
              <small>{{ formatSentenceCase(fact.impact) }} · {{ fact.scope.primary }}</small>
              <small v-if="fact.scope.secondary">{{ fact.scope.secondary }}</small>
            </div>
          </div>
        </details>
      </article>
    </template>
  </section>
</template>

<style scoped>
.pricing-section-header,
.pricing-subheading,
.state-row,
.allowance-list > div,
.pricing-disclosure > summary,
.raw-fact-list header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.pricing-section-header {
  min-height: var(--control-height-comfortable);
  margin-bottom: var(--space-3);
  gap: var(--space-4);
}

.pricing-section-header h3 {
  margin-bottom: 0;
}

.pricing-section-header p {
  margin: var(--space-0-5) 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-micro);
}

.pricing-refresh-status {
  display: grid;
  gap: var(--space-1);
  margin: 0 0 var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--color-status-warning);
  border-radius: var(--radius-md);
  background: var(--color-surface-subtle);
  color: var(--color-text-muted);
  font-size: var(--font-size-body);
}

.pricing-outcome,
.pricing-empty,
.pricing-warning {
  display: grid;
  gap: var(--space-1);
  padding: var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-subtle);
}

.pricing-outcome span,
.pricing-empty span,
.pricing-warning span {
  color: var(--color-text-muted);
  font-size: var(--font-size-body);
}

.pricing-warning {
  border-color: var(--color-status-warning);
}

.pricing-offer-group,
.pricing-context,
.pricing-offer-view {
  margin-top: var(--space-4);
}

.pricing-offer-group {
  min-width: 0;
  padding: 0;
  border: 0;
}

.pricing-offer-group > legend {
  padding: 0;
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-semibold);
}

.pricing-subheading {
  min-height: var(--control-height-default);
  gap: var(--space-3);
}

.pricing-subheading h4,
.pricing-subheading h5 {
  margin: 0;
  font-size: var(--font-size-body);
}

.pricing-subheading button {
  border: 0;
  color: var(--color-accent);
  background: transparent;
  font: inherit;
  cursor: pointer;
}

.offer-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.offer-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  width: 100%;
  margin-top: var(--space-2);
  padding: var(--space-2-5) var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.offer-choice {
  display: inline-flex;
  min-height: var(--control-height-default);
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1-5) var(--space-2);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  cursor: pointer;
}

.offer-choice:has(input:checked) {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
}

.offer-choice:has(input:focus-visible) {
  outline: var(--stroke-focus) solid var(--color-accent);
  outline-offset: var(--stroke-focus);
}

.offer-choice input {
  margin: 0;
  accent-color: var(--color-accent);
}

.offer-choice > span {
  display: grid;
  gap: var(--space-0-5);
}

.offer-summary > span + span {
  text-align: right;
}

.offer-title,
.state-label,
.allowance-value,
.rate-name,
.exact-rate {
  color: var(--color-text-primary);
  font-weight: var(--font-weight-medium);
}

.offer-state {
  color: var(--color-text-muted);
  font-size: var(--font-size-micro);
}

.state-row small,
.allowance-list small,
.raw-fact-list small {
  color: var(--color-text-muted);
  font-size: var(--font-size-micro);
}

.fixed-context-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.fixed-context-list > span {
  display: inline-flex;
  min-height: var(--control-height-default);
  align-items: center;
  gap: var(--space-1-5);
  padding-inline: var(--space-2);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--color-surface-subtle);
}

.fixed-context-list small {
  color: var(--color-text-muted);
  font-size: var(--font-size-micro);
}

.fixed-context-list > span > span {
  font-size: var(--font-size-caption);
}

.fixed-context-list small::after {
  content: ":";
}

.pricing-selector-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.pricing-selector-grid label {
  display: grid;
  min-width: 0;
  gap: var(--space-1);
  color: var(--color-text-muted);
  font-size: var(--font-size-micro);
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

.pricing-offer-view {
  padding-top: var(--space-4);
  border-top: 1px solid var(--color-border-subtle);
}

.offer-compatibility,
.context-prompt {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-body);
  line-height: var(--line-height-body);
}

.offer-compatibility {
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--color-border-subtle);
}

.offer-compatibility + .pricing-warning {
  margin-top: var(--space-3);
}

.pricing-offer-view > .pricing-warning {
  margin-bottom: var(--space-4);
}

.offer-section {
  margin-top: var(--space-4);
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
  border-radius: 50%;
  background: var(--color-accent);
}

.pricing-matrix {
  overflow-x: auto;
  margin-top: var(--space-2);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
}

.pricing-matrix table {
  width: 100%;
  border-collapse: collapse;
}

.pricing-matrix thead th:first-child {
  width: 68%;
}

.pricing-matrix thead th:last-child {
  width: 32%;
  text-align: right;
}

.pricing-matrix th,
.pricing-matrix td {
  padding: var(--space-2-5) var(--space-3);
  border-bottom: 1px solid var(--color-border-subtle);
  text-align: left;
}

.pricing-matrix tr:last-child > * {
  border-bottom: 0;
}

.pricing-matrix thead th {
  color: var(--color-text-muted);
  background: var(--color-surface-subtle);
  font-size: var(--font-size-micro);
}

.pricing-matrix tbody th,
.pricing-matrix td {
  vertical-align: top;
}

.pricing-matrix tbody th {
  font-weight: var(--font-weight-regular);
}

.pricing-matrix tbody th > *,
.pricing-matrix td > * {
  display: block;
}

.pricing-matrix tbody th small,
.pricing-matrix td small {
  margin-top: var(--space-0-5);
  color: var(--color-text-muted);
  font-size: var(--font-size-micro);
}

.context-prompt {
  margin-top: var(--space-2);
  padding: var(--space-2-5) var(--space-3);
  border-left: var(--stroke-focus) solid var(--color-border-default);
  background: var(--color-surface-subtle);
}

.pricing-matrix td {
  text-align: right;
  white-space: nowrap;
}

.pricing-disclosure {
  margin-top: var(--space-4);
  border-top: 1px solid var(--color-border-subtle);
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
  .offer-choice {
    align-items: flex-start;
  }

  .pricing-selector-grid {
    grid-template-columns: 1fr;
  }
}
</style>
