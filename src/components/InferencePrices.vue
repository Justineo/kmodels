<script setup lang="ts" vapor>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { WebsiteInferencePrice, WebsitePricingOffer } from "../catalog/website-schema.ts";
import PricingOfferBreakdown from "./PricingOfferBreakdown.vue";
import UiIcon from "./UiIcon.vue";
import UiSelect from "./UiSelect.vue";
import PricingConditions from "./PricingConditions.vue";
import { canonicalJson, uniqueCanonicalValues } from "../catalog/canonical-value.ts";
import { pricingSelection } from "../catalog/pricing-selector-input.ts";
import { queryWebsiteInferencePrice } from "../catalog/inference-price-presentation.ts";
import { matchInferencePrices } from "../pricing/inference-matching.ts";
import { formatCategoricalValue, formatDimension } from "../catalog/pricing-presentation.ts";

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
    <details v-if="evidenceUrls.length" class="mapping-evidence">
      <summary>Mapping evidence</summary>
      <ul>
        <li v-for="url in evidenceUrls" :key="url">
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
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
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
