<script setup lang="ts" vapor>
import { computed, onBeforeUnmount, onMounted, ref, toRaw, watch } from "vue";
import type { WebsiteInferencePrice, WebsitePricingOffer } from "../catalog/website-schema.ts";
import PricingOfferBreakdown from "./PricingOfferBreakdown.vue";
import UiIcon from "./UiIcon.vue";
import UiSelect from "./UiSelect.vue";
import PricingControls from "./PricingControls.vue";
import { canonicalJson, uniqueCanonicalValues } from "../catalog/canonical-value.ts";
import {
  fixedPricingSelection,
  fixedCommercialChoices,
  pricingSelection,
  retainPricingInputs,
  retainCommercialChoices,
  commercialControlChoices,
} from "../catalog/pricing-selector-input.ts";
import type { PricingSelection } from "../catalog/pricing-applicability.ts";
import { presentWebsiteInferencePrice } from "../catalog/inference-price-presentation.ts";
import {
  inferencePriceOptions,
  inferenceCandidateScopes,
} from "../catalog/inference-price-options.ts";
import {
  commercialBranchesCoverScopes,
  resolveCommercialChoices,
} from "../pricing/commercial-matching.ts";
import {
  inferencePricingContext,
  type WebsitePricingContext,
} from "../catalog/website-pricing-context.ts";
import { matchInferencePrices, type InferenceMatchResult } from "../pricing/inference-matching.ts";
import type { CommercialChoice } from "../catalog/pricing-schema.ts";
import { commercialConditionDimension } from "../pricing/commercial-vocabulary.ts";
import {
  formatCategoricalValue,
  formatDimension,
  formatRecurringTimeSchedule,
  formatUnitExpression,
} from "../catalog/pricing-presentation.ts";

const props = defineProps<{
  modelRef: string;
  prices: WebsiteInferencePrice[];
  offers: WebsitePricingOffer[];
}>();
const emit = defineEmits<{ pricingContext: [context: WebsitePricingContext] }>();
const selectedId = ref("");
const selectedOffer = ref("");
const commercialChoices = ref<CommercialChoice[]>([]);
const copiedId = ref("");
let copyResetTimer: ReturnType<typeof setTimeout> | undefined;
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
const commercialMatch = computed(() => {
  const matching = toRaw(selectedPrice.value?.matching);
  return matching === undefined
    ? undefined
    : matchInferencePrices(
        matching,
        [],
        evaluatedAt.value,
        undefined,
        undefined,
        commercialChoices.value,
      );
});
const commercialOptions = computed(() => {
  const matching = toRaw(selectedPrice.value?.matching);
  if (matching === undefined) return [];
  return commercialControlChoices(
    matchInferencePrices(matching, [], evaluatedAt.value).available_choices,
    commercialMatch.value?.available_choices ?? [],
    commercialChoices.value,
  );
});
const fixedChoices = computed(() => {
  const matching = toRaw(selectedPrice.value?.matching);
  if (matching === undefined) return [];
  return fixedCommercialChoices(
    commercialOptions.value,
    commercialMatch.value?.candidates.map(({ offer_ref }) => offer_ref) ?? [],
  ).filter((choice) =>
    commercialMatch.value?.candidates.every((candidate) => {
      const offer = matching.offers.find(({ id }) => id === candidate.offer_ref);
      if (offer === undefined) return false;
      const resolve = (choices: CommercialChoice[]) =>
        resolveCommercialChoices(
          offer,
          candidate.selectors,
          choices,
          evaluatedAt.value,
          matching.observed_at,
        );
      const current = resolve(commercialChoices.value);
      const proposed = resolve([
        ...commercialChoices.value.filter(({ dimension }) => dimension !== choice.dimension),
        choice,
      ]);
      return (
        proposed.unresolved.length === 0 &&
        commercialBranchesCoverScopes(
          inferenceCandidateScopes(offer, candidate),
          current.branches,
          proposed.branches,
        )
      );
    }),
  );
});
const effectiveCommercialChoices = computed(() => [
  ...commercialChoices.value,
  ...fixedChoices.value.filter(
    (fixed) => !commercialChoices.value.some(({ dimension }) => dimension === fixed.dimension),
  ),
]);
const offerOptions = computed(() => {
  const refs = new Set(commercialMatch.value?.candidates.map(({ offer_ref }) => offer_ref));
  return props.offers
    .filter(({ id }) => refs.has(id))
    .map(({ id, title }) => ({ value: id, label: title }));
});
function matchConditions(selections: readonly PricingSelection[]) {
  const matching = toRaw(selectedPrice.value?.matching);
  if (matching === undefined) return;
  return matchInferencePrices(
    matching,
    selections,
    evaluatedAt.value,
    selectedOffer.value || undefined,
    undefined,
    effectiveCommercialChoices.value,
  );
}
function excludesPrices(result: InferenceMatchResult | undefined): boolean {
  return result?.reason === "no_applicable_price" || result?.reason === "incompatible_conditions";
}
const initialMatch = computed(() => matchConditions([]));
const availableConditionOptions = computed(() => {
  const price = toRaw(selectedPrice.value);
  const initial = initialMatch.value;
  if (price?.matching === undefined || initial === undefined) return [];
  return inferencePriceOptions(
    price.matching,
    initial,
    price.pricing_options ?? [],
    evaluatedAt.value,
    selectedOffer.value || undefined,
    effectiveCommercialChoices.value,
  )
    .filter(
      ({ dimension }) =>
        !commercialOptions.value.some(
          (choice) =>
            dimension.namespace === "kmodels" &&
            commercialConditionDimension(choice.dimension) === dimension.value,
        ),
    )
    .map((option) => ({ option, fixed: fixedPricingSelection(option) }));
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
const activeMatch = computed(() => {
  const values = selections.value;
  return values.length === 0 ? initialMatch.value : matchConditions(values);
});
const selected = computed(() => {
  const price = toRaw(selectedPrice.value);
  return price === undefined ? undefined : presentWebsiteInferencePrice(price, activeMatch.value);
});
watch(
  () =>
    inferencePricingContext(
      props.modelRef,
      excludesPrices(activeMatch.value) ? [] : (selected.value?.candidates ?? []),
      chosenSelections.value,
    ),
  (context) => emit("pricingContext", context),
  { immediate: true },
);
const conditionOptions = computed(() => {
  const result = activeMatch.value;
  const active = excludesPrices(result) ? initialMatch.value : result;
  const missing = new Set(active?.missing_conditions.map(canonicalJson));
  return availableConditionOptions.value.flatMap(({ option, fixed }) =>
    (fixed !== undefined &&
      selections.value.some((value) => canonicalJson(value) === canonicalJson(fixed))) ||
    (inputs.value[option.key] ?? "") !== "" ||
    missing.has(canonicalJson(option.dimension))
      ? [option]
      : [],
  );
});
const needsPricingSelection = computed(
  () =>
    selected.value?.status === "candidates" &&
    (selected.value.missing_choices.length > 0 ||
      selected.value.requires_offer_choice ||
      selected.value.missing_conditions.length > 0),
);
const hasPricingControls = computed(
  () =>
    conditionOptions.value.length > 0 ||
    commercialOptions.value.length > 0 ||
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
watch(() => props.prices, scheduleClock);
onBeforeUnmount(() => {
  if (clock !== undefined) clearTimeout(clock);
  resetCopyFeedback();
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
            !commercialChoices.value.some(
              (choice) =>
                dimension.namespace === "kmodels" &&
                commercialConditionDimension(choice.dimension) === dimension.value,
            ) &&
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
    commercialChoices.value = [];
    resetCopyFeedback();
    inputs.value = {};
  },
);
function selectId(id: string): void {
  if (id === selectedPrice.value?.model_id) return;
  const previous = availableConditionOptions.value.map(({ option }) => option);
  selectedId.value = id;
  resetCopyFeedback();
  scheduleClock();
  if (
    selectedOffer.value !== "" &&
    (!offerOptions.value.some(({ value }) => value === selectedOffer.value) ||
      excludesPrices(initialMatch.value))
  )
    selectedOffer.value = "";
  retainInputs(previous);
}
function selectOffer(offer: string): void {
  const previous = availableConditionOptions.value.map(({ option }) => option);
  selectedOffer.value = offer;
  retainInputs(previous);
}
function retainInputs(previous: ReturnType<typeof inferencePriceOptions>): void {
  if (Object.values(inputs.value).some((value) => value !== ""))
    inputs.value = retainPricingInputs(
      previous,
      availableConditionOptions.value.map(({ option }) => option),
      inputs.value,
    );
}
function selectCommercial(choices: CommercialChoice[]): void {
  const previous = availableConditionOptions.value.map(({ option }) => option);
  const matching = toRaw(selectedPrice.value?.matching);
  commercialChoices.value = retainCommercialChoices(
    commercialChoices.value,
    choices,
    (next) =>
      matching === undefined ||
      !excludesPrices(
        matchInferencePrices(matching, [], evaluatedAt.value, undefined, undefined, next),
      ),
  );
  if (selectedOffer.value && excludesPrices(initialMatch.value)) selectedOffer.value = "";
  retainInputs(previous);
}
function resetCopyFeedback(): void {
  copiedId.value = "";
  if (copyResetTimer !== undefined) clearTimeout(copyResetTimer);
  copyResetTimer = undefined;
}
async function copyId(id: string): Promise<void> {
  resetCopyFeedback();
  try {
    await navigator.clipboard.writeText(id);
    copiedId.value = id;
    copyResetTimer = setTimeout(resetCopyFeedback, 2_000);
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
    <p v-if="selected.unresolved_choices.length" class="fixed-conditions">
      Some offers have incomplete evidence for the selected commercial choices. They have not been
      treated as unsupported.
    </p>
    <fieldset
      v-if="
        offerOptions.length > 1 &&
        !selected.missing_choices.includes('execution') &&
        !commercialOptions.some((choice) => choice.dimension === 'account_plan')
      "
      class="plan-control"
    >
      <legend>Pricing plan</legend>
      <div class="offer-list">
        <label v-for="option in offerOptions" :key="option.value" class="offer-choice">
          <input
            type="radio"
            :name="`pricing-plan-${modelRef}`"
            :value="option.value"
            :checked="selectedOffer === option.value"
            @change="selectOffer(option.value)"
          />
          <strong>{{ option.label }}</strong>
        </label>
      </div>
    </fieldset>
    <PricingControls
      prefix="inference-price"
      :choices="commercialOptions"
      :fixed="fixedChoices"
      :selected="commercialChoices"
      :selectors="conditionOptions"
      :inputs="inputs"
      @change="selectCommercial"
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
.plan-control legend,
.candidate h4 {
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-semibold);
}
.plan-control {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.plan-control legend {
  padding: 0;
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
