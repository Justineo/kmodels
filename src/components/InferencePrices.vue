<script setup lang="ts" vapor>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type {
  WebsiteInferencePrice,
  WebsitePricingOffer,
  WebsitePricingSelector,
} from "../catalog/website-schema.ts";
import PricingOfferBreakdown from "./PricingOfferBreakdown.vue";
import UiIcon from "./UiIcon.vue";
import UiSelect from "./UiSelect.vue";
import PricingConditions from "./PricingConditions.vue";
import { canonicalJson, uniqueCanonicalValues } from "../catalog/canonical-value.ts";
import { fixedPricingSelection, pricingSelection } from "../catalog/pricing-selector-input.ts";
import type { PricingSelection } from "../catalog/pricing-applicability.ts";
import { queryWebsiteInferencePrice } from "../catalog/inference-price-presentation.ts";
import { matchInferencePrices, type InferenceMatchResult } from "../pricing/inference-matching.ts";
import {
  formatCategoricalValue,
  formatDimension,
  formatRecurringTimeSchedule,
  formatUnitExpression,
} from "../catalog/pricing-presentation.ts";

const props = defineProps<{
  modelRef: string;
  catalogId?: string;
  prices: WebsiteInferencePrice[];
  offers: WebsitePricingOffer[];
}>();
const selectedId = ref("");
const selectedOffer = ref("");
const copiedId = ref("");
const inputs = ref<Record<string, string>>({});
const evaluatedAt = ref(new Date().toISOString());
const priceGroups = computed(() => {
  const groups = new Map<string, [WebsiteInferencePrice, ...WebsiteInferencePrice[]]>();
  for (const price of props.prices) {
    const { model_id, matching, pricing_options, reason } = price;
    const key =
      props.prices.length > 1 && matching?.rules.length && reason !== "ambiguous_identity"
        ? canonicalJson({
            ...matching,
            rules: uniqueCanonicalValues(matching.rules),
            pricing_options: pricing_options ?? [],
          })
        : canonicalJson(model_id);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [price]);
    else group.push(price);
  }
  return [...groups.values()];
});
const selectedPrice = computed(
  () => props.prices.find(({ model_id }) => model_id === selectedId.value) ?? props.prices[0],
);
const selectedGroup = computed(() => {
  const price = selectedPrice.value;
  return price && priceGroups.value.find((group) => group.includes(price));
});
const idOptions = computed(() =>
  props.prices.map(({ model_id }) => ({ value: model_id, label: model_id })),
);
const evidenceUrls = computed(() => [
  ...new Set(selectedGroup.value?.flatMap(({ evidence_urls }) => evidence_urls)),
]);
const usesCatalogId = computed(
  () => props.prices.length === 1 && selectedPrice.value?.model_id === props.catalogId,
);
const offerOptions = computed(() => {
  const refs = new Set(
    selectedPrice.value?.matching?.rules.flatMap(({ offer_refs }) => offer_refs),
  );
  return props.offers
    .filter(({ id }) => refs.has(id))
    .map(({ id, title }) => ({ value: id, label: title }));
});
function matchConditions(selections: readonly PricingSelection[]) {
  const matching = selectedPrice.value?.matching;
  if (matching === undefined) return;
  return matchInferencePrices(
    matching,
    selections,
    evaluatedAt.value,
    selectedOffer.value || undefined,
  );
}
function excludesPrices(result: InferenceMatchResult | undefined): boolean {
  return result?.reason === "no_applicable_price" || result?.reason === "incompatible_conditions";
}
function scopeConditionOption(option: WebsitePricingSelector): WebsitePricingSelector | undefined {
  function isAvailable(value: string): boolean {
    const selection = pricingSelection(option, value);
    return selection !== undefined && !excludesPrices(matchConditions([selection]));
  }
  switch (option.kind) {
    case "categorical": {
      const values = option.values.filter(({ key }) => isAvailable(key));
      return values.length === 0 ? undefined : { ...option, values };
    }
    case "decimal_values": {
      const values = option.values.filter(isAvailable);
      return values.length === 0 ? undefined : { ...option, values };
    }
    case "decimal_buckets": {
      const values = option.values.filter(({ key }) => isAvailable(key));
      return values.length === 0 ? undefined : { ...option, values };
    }
    default:
      return option;
  }
}
const initialMatch = computed(() => matchConditions([]));
const availableConditionOptions = computed(() => {
  const dimensions = new Set(initialMatch.value?.missing_conditions.map(canonicalJson));
  return (selectedPrice.value?.pricing_options ?? []).flatMap((option) => {
    if (!dimensions.has(canonicalJson(option.dimension))) return [];
    const scoped = scopeConditionOption(option);
    return scoped === undefined ? [] : [{ option: scoped, fixed: fixedPricingSelection(scoped) }];
  });
});
const configurableConditionOptions = computed(() =>
  availableConditionOptions.value.flatMap(({ option, fixed }) =>
    fixed === undefined ? [option] : [],
  ),
);
const chosenSelections = computed(() =>
  configurableConditionOptions.value.flatMap((option) => {
    const value = pricingSelection(option, inputs.value[option.key] ?? "");
    return value === undefined ? [] : [value];
  }),
);
const selections = computed(() => {
  const chosen = chosenSelections.value;
  const fixed = availableConditionOptions.value.flatMap(({ fixed }) =>
    fixed === undefined ? [] : [fixed],
  );
  if (fixed.length === 0) return chosen;
  const pending = chosen.length === 0 ? initialMatch.value : matchConditions(chosen);
  if (pending === undefined) return chosen;
  const missing = new Set(pending.missing_conditions.map(canonicalJson));
  const bound = pending.candidates.flatMap(({ selectors }) => selectors);
  return [
    ...chosen,
    ...fixed.filter((selection) => {
      const key = canonicalJson(selection.dimension);
      return (
        missing.has(key) &&
        bound.every(
          (value) =>
            canonicalJson(value.dimension) !== key ||
            canonicalJson(value) === canonicalJson(selection),
        )
      );
    }),
  ];
});
const selected = computed(() =>
  selectedPrice.value === undefined
    ? undefined
    : queryWebsiteInferencePrice(
        selectedPrice.value,
        selections.value,
        evaluatedAt.value,
        selectedOffer.value || undefined,
      ),
);
const conditionOptions = computed(() => {
  const result = matchConditions(selections.value);
  const active = excludesPrices(result) ? initialMatch.value : result;
  const missing = new Set(active?.missing_conditions.map(canonicalJson));
  return configurableConditionOptions.value.filter(
    (option) =>
      (inputs.value[option.key] ?? "") !== "" || missing.has(canonicalJson(option.dimension)),
  );
});
const needsPricingSelection = computed(
  () =>
    selected.value?.status === "candidates" &&
    (selected.value.requires_offer_choice || selected.value.missing_conditions.length > 0),
);
const hasPricingControls = computed(
  () =>
    conditionOptions.value.length > 0 ||
    (selected.value?.requires_offer_choice === true && offerOptions.value.length > 1),
);
function setInput(key: string, value: string): void {
  inputs.value = { ...inputs.value, [key]: value };
}
let clock: ReturnType<typeof setTimeout> | undefined;
function scheduleClock(): void {
  if (clock !== undefined) clearTimeout(clock);
  clock = undefined;
  const now = Date.now();
  evaluatedAt.value = new Date(now).toISOString();
  const data = selectedPrice.value?.matching;
  if (data === undefined) return;
  const rows = [
    ...data.offers.flatMap((offer) => [...offer.states, ...offer.relations]),
    ...[...data.offers.flatMap(({ terms }) => terms), ...data.referenced_rates].flatMap((term) => [
      ...term.variants,
      ...term.raw_variants,
    ]),
  ];
  const changes = [
    Date.parse(data.observed_at),
    ...rows.flatMap(({ validity }) =>
      [validity?.from, validity?.until].flatMap((boundary) =>
        boundary?.precision === "datetime" ? [Date.parse(boundary.value)] : [],
      ),
    ),
  ].filter((time) => time >= now);
  if (changes.length > 0)
    clock = setTimeout(scheduleClock, Math.min(Math.min(...changes) - now + 1, 2_147_483_647));
}
onMounted(scheduleClock);
watch(selectedPrice, scheduleClock);
onBeforeUnmount(() => {
  if (clock !== undefined) clearTimeout(clock);
});
function conditionLabel(selector: Exclude<PricingSelection, { kind: "decimal_range" }>): string {
  const label = formatDimension(selector.dimension);
  if (selector.kind === "decimal")
    return `${label}: ${selector.value} ${formatUnitExpression(selector.unit)}`;
  if (selector.kind === "boolean") return `${label}: ${selector.value}`;

  const fixed = availableConditionOptions.value.find(
    ({ fixed }) => fixed !== undefined && canonicalJson(fixed) === canonicalJson(selector),
  )?.option;
  const value = fixed?.kind === "categorical" ? fixed.values[0] : undefined;
  const schedule = value?.schedule;
  const name = value?.label ?? formatCategoricalValue(selector.value);
  return schedule === undefined
    ? `${label}: ${name}`
    : `${label}: ${name} (${formatRecurringTimeSchedule(schedule)} · ${schedule.time_zone})`;
}
const candidates = computed(() => {
  if (needsPricingSelection.value) return [];
  return (
    selected.value?.candidates.map((candidate) => ({
      ...candidate,
      conditions: candidate.selectors
        .filter(
          ({ dimension }) =>
            !(dimension.namespace === "kmodels" && dimension.value === "model") &&
            !chosenSelections.value.some(
              (selection) => canonicalJson(selection.dimension) === canonicalJson(dimension),
            ),
        )
        .flatMap((selector) =>
          selector.kind === "decimal_range" ? [] : [conditionLabel(selector)],
        ),
      offer: props.offers.find(({ id }) => id === candidate.offer_ref),
    })) ?? []
  );
});
watch(
  () => props.modelRef,
  () => {
    selectedId.value = "";
    selectedOffer.value = "";
    copiedId.value = "";
    inputs.value = {};
  },
);
function selectId(id: string): void {
  const samePricing = selectedGroup.value?.some(({ model_id }) => model_id === id);
  selectedId.value = id;
  copiedId.value = "";
  if (!samePricing) {
    selectedOffer.value = "";
    inputs.value = {};
  }
}
function selectOffer(offer: string): void {
  selectedOffer.value = offer;
  inputs.value = {};
}
async function copyId(id: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(id);
    copiedId.value = id;
  } catch {
    copiedId.value = "";
  }
}
</script>

<template>
  <div v-if="selected" class="inference-prices">
    <div v-if="selected.reason !== 'unreviewed_id'" class="id-control">
      <label v-if="priceGroups.length > 1" for="inference-model-id">Inference model ID</label>
      <span v-else class="id-label">{{
        (selectedGroup?.length ?? 0) > 1 ? "Inference model IDs" : "Inference model ID"
      }}</span>
      <div v-if="priceGroups.length > 1" class="id-picker">
        <UiSelect
          id="inference-model-id"
          class="id-select"
          :title="selected.model_id"
          :model-value="selected.model_id"
          :options="idOptions"
          @update:model-value="selectId"
        />
        <button
          class="identifier-copy id-copy"
          type="button"
          :data-copied="copiedId === selected.model_id || undefined"
          :aria-label="`Copy inference model ID ${selected.model_id}`"
          :title="copiedId === selected.model_id ? 'Copied' : 'Copy inference model ID'"
          @click="copyId(selected.model_id)"
        >
          <UiIcon :name="copiedId === selected.model_id ? 'check' : 'copy'" />
        </button>
      </div>
      <p v-else-if="usesCatalogId" class="id-reference">Same as Catalog ID</p>
      <ul v-else class="identifier-list inference-ids">
        <li v-for="{ model_id } in selectedGroup" :key="model_id">
          <button
            class="identifier-copy"
            type="button"
            :data-copied="copiedId === model_id || undefined"
            :aria-label="`Copy inference model ID ${model_id}`"
            @click="copyId(model_id)"
          >
            <code>{{ model_id }}</code>
            <UiIcon :name="copiedId === model_id ? 'check' : 'copy'" />
          </button>
        </li>
      </ul>
      <p class="visually-hidden" aria-live="polite">{{ copiedId ? `Copied ${copiedId}` : "" }}</p>
    </div>
    <div v-if="offerOptions.length > 1" class="id-control">
      <label for="inference-price-plan">Pricing plan</label>
      <UiSelect
        id="inference-price-plan"
        placeholder="Choose pricing plan"
        :model-value="selectedOffer"
        :options="offerOptions"
        @update:model-value="selectOffer"
      />
    </div>
    <PricingConditions
      prefix="inference-price"
      :selectors="conditionOptions"
      :inputs="inputs"
      @input="setInput"
    />
    <div class="match-status" role="status">
      <strong>{{
        selected.status === "matched"
          ? "Applicable prices"
          : needsPricingSelection && hasPricingControls
            ? "Select pricing options"
            : selected.reason === "no_applicable_price" ||
                selected.reason === "incompatible_conditions"
              ? "No applicable prices"
              : selected.status === "candidates" || selected.reason === "unresolved_price"
                ? "Price evidence incomplete"
                : "Price mapping unknown"
      }}</strong>
      <p v-if="needsPricingSelection">
        {{
          hasPricingControls
            ? "Complete the required selections to see applicable rates."
            : "The published evidence does not resolve these pricing conditions."
        }}
      </p>
      <p v-else>{{ selected.explanation }}</p>
      <p v-if="selected.missing_conditions.length">
        Remaining conditions: {{ selected.missing_conditions.join(", ") }}.
      </p>
    </div>
    <article
      v-for="(candidate, index) in candidates"
      :key="`${selected.model_id}:${index}`"
      class="candidate"
    >
      <template v-if="candidate.offer">
        <h4>{{ candidate.offer.title }}</h4>
        <p v-if="candidate.conditions.length" class="fixed-conditions">
          {{ candidate.conditions.join(" · ") }}
        </p>
        <PricingOfferBreakdown
          :offer="candidate.offer"
          :model-ref="modelRef"
          :bound-selectors="candidate.selectors"
          :matched-rows="candidate.row_keys"
          :hide-conditions="selected.matching !== undefined"
          show-candidate-rates
        />
      </template>
      <p v-else>Price details are unavailable for this candidate.</p>
    </article>
    <details v-if="evidenceUrls.length" class="detail-disclosure">
      <summary>
        <span>Mapping evidence</span>
        <small
          >{{ evidenceUrls.length }} {{ evidenceUrls.length === 1 ? "source" : "sources" }}</small
        >
        <UiIcon name="chevron-right" />
      </summary>
      <ul class="detail-disclosure-body evidence-list">
        <li v-for="url in evidenceUrls" :key="url">
          <a v-if="/^https?:\/\//.test(url)" :href="url" target="_blank" rel="noopener noreferrer">
            <strong>{{ url }}</strong>
            <UiIcon name="external-link" />
          </a>
          <strong v-else>{{ url }}</strong>
        </li>
      </ul>
    </details>
  </div>
</template>

<style scoped>
.inference-prices,
.id-control {
  display: grid;
  gap: var(--space-2);
}
.id-control label,
.id-label,
.candidate h4 {
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-semibold);
}
.id-reference {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-body);
}
.inference-ids {
  margin: 0;
}
.fixed-conditions {
  color: var(--color-text-muted);
  font-size: var(--font-size-body);
  margin: 0 0 var(--space-2);
}
.id-picker {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  min-width: 0;
  min-height: var(--control-height-comfortable);
  border: var(--stroke-hairline) solid var(--color-border-default);
  border-radius: var(--radius-md);
}
.id-picker:has(select:focus-visible) {
  outline: var(--stroke-focus) solid var(--color-accent);
  outline-offset: var(--space-0-5);
}
.id-select {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-meta);
}
.id-select :deep(option .ui-select-option-label) {
  overflow-wrap: anywhere;
  white-space: normal;
}
.id-copy {
  justify-content: center;
  min-width: var(--control-height-comfortable);
  border: 0;
  border-inline-start: var(--stroke-hairline) solid var(--color-border-subtle);
  border-radius: var(--radius-none) var(--radius-md) var(--radius-md) var(--radius-none);
}
.match-status {
  margin-block: var(--space-2);
}
.match-status p {
  margin: var(--space-1) 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-body);
}
.candidate {
  min-width: 0;
}
.candidate + .candidate {
  border-top: var(--stroke-hairline) solid var(--color-border-subtle);
  padding-top: var(--space-3);
}
.candidate h4 {
  margin: 0 0 var(--space-2);
}
</style>
