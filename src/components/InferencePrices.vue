<script setup lang="ts" vapor>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { WebsiteInferencePrice, WebsitePricingOffer } from "../catalog/website-schema.ts";
import PricingOfferBreakdown from "./PricingOfferBreakdown.vue";
import UiSelect from "./UiSelect.vue";
import PricingConditions from "./PricingConditions.vue";
import { canonicalJson } from "../catalog/canonical-value.ts";
import { pricingSelection } from "../catalog/pricing-selector-input.ts";
import { queryWebsiteInferencePrice } from "../catalog/inference-price-presentation.ts";
import { matchInferencePrices } from "../pricing/inference-matching.ts";
import { formatCategoricalValue, formatDimension } from "../catalog/pricing-presentation.ts";

const props = defineProps<{
  modelRef: string;
  prices: WebsiteInferencePrice[];
  offers: WebsitePricingOffer[];
}>();
const selectedId = ref("");
const selectedOffer = ref("");
const copied = ref(false);
const inputs = ref<Record<string, string>>({});
const evaluatedAt = ref(new Date().toISOString());
const selectedPrice = computed(
  () => props.prices.find(({ model_id }) => model_id === selectedId.value) ?? props.prices[0],
);
const identifierLabel = computed(() =>
  selectedPrice.value?.reason === "unreviewed_id" ? "Catalog ID" : "Inference model ID",
);
const offerOptions = computed(() => {
  const refs = new Set(
    selectedPrice.value?.matching?.rules.flatMap(({ offer_refs }) => offer_refs),
  );
  return props.offers
    .filter(({ id }) => refs.has(id))
    .map(({ id, title }) => ({ value: id, label: title }));
});
const availableConditionOptions = computed(() => {
  const price = selectedPrice.value;
  if (price?.matching === undefined) return [];
  const initial = matchInferencePrices(
    price.matching,
    [],
    evaluatedAt.value,
    selectedOffer.value || undefined,
  );
  const dimensions = new Set(initial.missing_conditions.map(canonicalJson));
  return (price.pricing_options ?? []).filter(({ dimension }) =>
    dimensions.has(canonicalJson(dimension)),
  );
});
const selections = computed(() =>
  availableConditionOptions.value.flatMap((option) => {
    const value = pricingSelection(option, inputs.value[option.key] ?? "");
    return value === undefined ? [] : [value];
  }),
);
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
  const matching = selectedPrice.value?.matching;
  if (matching === undefined) return [];
  const result = matchInferencePrices(
    matching,
    selections.value,
    evaluatedAt.value,
    selectedOffer.value || undefined,
  );
  const missing = new Set(result.missing_conditions.map(canonicalJson));
  return availableConditionOptions.value.filter(
    (option) =>
      (inputs.value[option.key] ?? "") !== "" || missing.has(canonicalJson(option.dimension)),
  );
});
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
const candidates = computed(
  () =>
    selected.value?.candidates.map((candidate) => ({
      ...candidate,
      conditions: candidate.selectors
        .filter(
          ({ dimension }) =>
            !(dimension.namespace === "kmodels" && dimension.value === "model") &&
            !selections.value.some(
              (selection) => canonicalJson(selection.dimension) === canonicalJson(dimension),
            ),
        )
        .flatMap((selector) =>
          selector.kind === "decimal_range"
            ? []
            : [
                `${formatDimension(selector.dimension)}: ${selector.kind === "categorical" ? formatCategoricalValue(selector.value) : String(selector.value)}`,
              ],
        ),
      offer: props.offers.find(({ id }) => id === candidate.offer_ref),
    })) ?? [],
);
watch(
  () => props.modelRef,
  () => {
    selectedId.value = "";
    selectedOffer.value = "";
    copied.value = false;
    inputs.value = {};
  },
);
function selectId(id: string): void {
  selectedId.value = id;
  selectedOffer.value = "";
  copied.value = false;
  inputs.value = {};
}
function selectOffer(offer: string): void {
  selectedOffer.value = offer;
  inputs.value = {};
}
async function copyId(): Promise<void> {
  if (!selected.value) return;
  try {
    await navigator.clipboard.writeText(selected.value.model_id);
    copied.value = true;
  } catch {
    copied.value = false;
  }
}
</script>

<template>
  <div v-if="selected" class="inference-prices">
    <div class="id-control">
      <label for="inference-model-id">{{ identifierLabel }}</label>
      <div class="id-value">
        <UiSelect
          v-if="prices.length > 1"
          id="inference-model-id"
          placeholder="Choose inference model ID"
          :model-value="selected.model_id"
          :options="prices.map(({ model_id }) => ({ value: model_id, label: model_id }))"
          @update:model-value="selectId"
        />
        <code v-else id="inference-model-id">{{ selected.model_id }}</code>
        <button
          type="button"
          :aria-label="`${identifierLabel === 'Catalog ID' ? 'Copy catalog ID' : 'Copy inference model ID'} ${selected.model_id}`"
          @click="copyId"
        >
          {{ copied ? "Copied" : "Copy" }}
        </button>
      </div>
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
          : selected.status === "candidates"
            ? "Candidate prices"
            : selected.reason === "no_applicable_price" ||
                selected.reason === "incompatible_conditions"
              ? "No applicable prices"
              : selected.reason === "unresolved_price"
                ? "Price evidence incomplete"
                : "Price mapping unknown"
      }}</strong>
      <p>{{ selected.explanation }}</p>
      <p v-if="selected.missing_conditions.length">
        Conditions: {{ selected.missing_conditions.join(", ") }}.
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
    <details v-if="selected.evidence_urls.length" class="mapping-evidence">
      <summary>Mapping evidence</summary>
      <ul>
        <li v-for="url in selected.evidence_urls" :key="url">
          <a
            v-if="/^https?:\/\//.test(url)"
            :href="url"
            target="_blank"
            rel="noopener noreferrer"
            >{{ url }}</a
          ><span v-else>{{ url }}</span>
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
.candidate h4 {
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-semibold);
}
.fixed-conditions {
  color: var(--color-text-muted);
  font-size: var(--font-size-body);
  margin: 0 0 var(--space-2);
}
.id-value {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.id-value :deep(.ui-select),
.id-value code {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.id-value :deep(.ui-select-control),
.id-value button {
  min-height: var(--control-height-default);
  border: var(--stroke-hairline) solid var(--color-border-default);
  border-radius: var(--radius-md);
}
.id-value button {
  padding-inline: var(--space-3);
  color: var(--color-text-primary);
  background: var(--color-surface);
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
.mapping-evidence {
  margin-top: var(--space-2);
  font-size: var(--font-size-meta);
  color: var(--color-text-muted);
  overflow-wrap: anywhere;
}
.mapping-evidence summary {
  cursor: pointer;
}
</style>
