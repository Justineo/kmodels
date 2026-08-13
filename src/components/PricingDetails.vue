<script setup lang="ts" vapor>
import { computed, ref, watch } from "vue";
import { formatSnapshotAt } from "../catalog/presentation.ts";
import type {
  WebsiteModel,
  WebsitePricingDetail,
  WebsitePricingOffer,
} from "../catalog/website-schema.ts";
import PricingOfferBreakdown from "./PricingOfferBreakdown.vue";
import UiIcon from "./UiIcon.vue";

const props = defineProps<{
  model: WebsiteModel;
  detail: WebsitePricingDetail | undefined;
  loading: boolean;
  error: string | undefined;
}>();

const emit = defineEmits<{ retry: [] }>();

const selectedMechanismId = ref("");
const offers = computed(() => props.detail?.offers ?? []);
const modelMechanisms = computed(() =>
  offers.value.filter(({ group }) => group === "model_mechanism"),
);
const activeMechanism = computed(
  () =>
    modelMechanisms.value.find(({ id }) => id === selectedMechanismId.value) ??
    modelMechanisms.value[0],
);
const relatedOffers = computed(() =>
  offers.value.filter(
    (offer) =>
      offer.group !== "model_mechanism" &&
      offer.group !== "plan_capacity" &&
      (activeMechanism.value === undefined ||
        offer.mechanism_refs === undefined ||
        offer.mechanism_refs.includes(activeMechanism.value.id)),
  ),
);
const optionalServices = computed(() =>
  relatedOffers.value.filter(({ group }) => group === "optional_service"),
);
const automaticComponents = computed(() =>
  relatedOffers.value.filter(({ group }) => group === "automatic_component"),
);
const separateServices = computed(() =>
  relatedOffers.value.filter(({ group }) => group === "standalone"),
);
const additionalCostCount = computed(
  () =>
    optionalServices.value.length +
    automaticComponents.value.length +
    separateServices.value.length,
);

watch(
  () => props.model.uid,
  () => {
    selectedMechanismId.value = "";
  },
);

watch(modelMechanisms, (current) => {
  if (
    selectedMechanismId.value !== "" &&
    !current.some(({ id }) => id === selectedMechanismId.value)
  )
    selectedMechanismId.value = "";
});

function selectMechanism(offerId: string): void {
  selectedMechanismId.value = offerId;
}

function offerState(offer: WebsitePricingOffer): string | undefined {
  return offer.state_summary === "Metered pricing" ? undefined : offer.state_summary;
}

function additionalCostKind(offer: WebsitePricingOffer): string {
  if (offer.group === "optional_service") return "Optional";
  if (offer.group === "automatic_component") return "Automatic";
  return "Separate service";
}

function additionalCostDescription(offer: WebsitePricingOffer): string {
  if (offer.group === "optional_service")
    return "Charged separately only when this service is used.";
  if (offer.group === "automatic_component")
    return "Added automatically when this run mode produces the billed usage.";
  return "A separately callable service that can contribute to this request's cost.";
}
</script>

<template>
  <section class="detail-section pricing-section" aria-labelledby="pricing-heading">
    <header class="pricing-section-header">
      <div>
        <h3 id="pricing-heading">Pricing</h3>
        <p v-if="detail?.snapshot?.publication === 'fresh'">
          Public rates verified
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

    <div v-else-if="error" class="pricing-outcome" role="alert">
      <strong>Pricing unavailable</strong>
      <span>{{ error }}</span>
      <button type="button" @click="emit('retry')">Retry</button>
    </div>

    <template v-else-if="detail">
      <section
        v-if="modelMechanisms.length > 0"
        class="run-mode"
        aria-labelledby="run-mode-heading"
      >
        <header class="section-introduction">
          <div>
            <h4 id="run-mode-heading">Run mode</h4>
            <p>Select how the model is invoked. Each mode has its own base rates.</p>
          </div>
        </header>

        <div v-if="modelMechanisms.length === 1" class="run-mode-summary">
          <span>
            <strong>{{ activeMechanism?.title }}</strong>
            <small>{{ activeMechanism?.billing_mode.label }}</small>
          </span>
          <small v-if="activeMechanism && offerState(activeMechanism)" class="offer-state">
            {{ offerState(activeMechanism) }}
          </small>
        </div>

        <fieldset v-else class="run-mode-options">
          <legend class="visually-hidden">Choose a run mode</legend>
          <div class="offer-list">
            <label v-for="offer in modelMechanisms" :key="offer.id" class="offer-choice">
              <input
                type="radio"
                :name="`pricing-mechanism-${model.uid}`"
                :value="offer.id"
                :checked="activeMechanism?.id === offer.id"
                @change="selectMechanism(offer.id)"
              />
              <span>
                <strong>{{ offer.title }}</strong>
                <small>{{ offer.billing_mode.label }}</small>
              </span>
              <small v-if="offerState(offer)" class="offer-state">{{ offerState(offer) }}</small>
            </label>
          </div>
        </fieldset>
      </section>

      <section v-if="activeMechanism" class="base-cost" aria-labelledby="base-rates-heading">
        <header class="cost-section-heading">
          <div>
            <span class="section-index">01</span>
            <div>
              <h4 id="base-rates-heading">Base model rates</h4>
              <p>{{ activeMechanism.title }} · {{ activeMechanism.billing_mode.label }}</p>
            </div>
          </div>
          <span v-if="offerState(activeMechanism)" class="offer-state">
            {{ offerState(activeMechanism) }}
          </span>
        </header>
        <PricingOfferBreakdown
          :key="activeMechanism.id"
          :offer="activeMechanism"
          :model-ref="model.uid"
        />
      </section>

      <div v-else class="pricing-outcome no-base-offer">
        <strong>No provider-priced model run mode</strong>
        <span>Only related request services are published for this model.</span>
      </div>

      <section
        v-if="additionalCostCount > 0"
        class="additional-costs"
        aria-labelledby="additional-costs-heading"
      >
        <header class="cost-section-heading">
          <div>
            <span class="section-index">{{ activeMechanism ? "02" : "01" }}</span>
            <div>
              <h4 id="additional-costs-heading">Additional request costs</h4>
              <p>Separate meters shown alongside the base rates; no usage total is calculated.</p>
            </div>
          </div>
          <strong class="cost-count">{{ additionalCostCount }}</strong>
        </header>

        <div class="additional-cost-list">
          <details
            v-for="offer in [...optionalServices, ...automaticComponents, ...separateServices]"
            :key="offer.id"
            class="additional-cost"
          >
            <summary>
              <span class="cost-summary-main">
                <small class="cost-kind">{{ additionalCostKind(offer) }}</small>
                <span>
                  <strong>{{ offer.title }}</strong>
                  <small>{{ additionalCostDescription(offer) }}</small>
                </span>
              </span>
              <span class="cost-summary-meta">
                <small v-if="offerState(offer)" class="offer-state">{{ offerState(offer) }}</small>
                <UiIcon name="chevron-right" />
              </span>
            </summary>
            <div class="additional-cost-body">
              <PricingOfferBreakdown :offer="offer" :model-ref="model.uid" />
            </div>
          </details>
        </div>
      </section>
    </template>
  </section>
</template>

<style scoped>
.pricing-section-header {
  display: flex;
  min-height: var(--control-height-comfortable);
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-3);
}

.pricing-section-header h3,
.pricing-section-header p {
  margin: 0;
}

.pricing-section-header p {
  margin-top: var(--space-0-5);
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
.pricing-empty {
  display: grid;
  gap: var(--space-1);
  padding: var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-subtle);
}

.pricing-outcome span,
.pricing-empty span {
  color: var(--color-text-muted);
  font-size: var(--font-size-body);
}

.pricing-outcome button {
  width: max-content;
  min-height: var(--control-height-default);
  margin-top: var(--space-1);
  padding-inline: var(--space-3);
  border: var(--stroke-hairline) solid var(--color-border-default);
  border-radius: var(--radius-md);
  color: var(--color-text-primary);
  background: var(--color-surface);
  font-size: var(--font-size-caption);
  font-weight: var(--font-weight-medium);
}

.pricing-outcome button:hover {
  border-color: var(--color-border-interactive);
  background: var(--color-surface-hover);
}

.run-mode,
.base-cost,
.additional-costs,
.no-base-offer {
  margin-top: var(--space-5);
}

.section-introduction,
.cost-section-heading,
.run-mode-summary,
.additional-cost > summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section-introduction h4,
.section-introduction p,
.cost-section-heading h4,
.cost-section-heading p {
  margin: 0;
}

.section-introduction h4,
.cost-section-heading h4 {
  color: var(--color-text-primary);
  font-size: var(--font-size-body);
}

.section-introduction p,
.cost-section-heading p {
  margin-top: var(--space-0-5);
  color: var(--color-text-muted);
  font-size: var(--font-size-micro);
}

.run-mode-summary {
  gap: var(--space-3);
  margin-top: var(--space-2);
  padding-block: var(--space-2-5);
  border-block: 1px solid var(--color-border-subtle);
}

.run-mode-summary > span:first-child,
.offer-choice > span,
.cost-summary-main > span {
  display: grid;
  gap: var(--space-0-5);
}

.run-mode-summary small,
.offer-choice small,
.cost-summary-main small,
.cost-summary-meta small {
  color: var(--color-text-muted);
  font-size: var(--font-size-micro);
}

.run-mode-options {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.offer-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.offer-choice {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  min-width: min(100%, 12rem);
  min-height: var(--control-height-comfortable);
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-2-5);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  cursor: pointer;
  transition:
    border-color var(--duration-fast) var(--easing-standard),
    background var(--duration-fast) var(--easing-standard);
}

.offer-choice:hover {
  border-color: var(--color-border-interactive);
  background: var(--color-surface-hover);
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

.offer-state {
  color: var(--color-text-muted);
  font-size: var(--font-size-micro);
  text-align: right;
}

.base-cost,
.additional-costs {
  padding-top: var(--space-5);
  border-top: 1px solid var(--color-border-subtle);
}

.cost-section-heading {
  gap: var(--space-3);
}

.cost-section-heading > div {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: var(--space-2-5);
}

.section-index {
  display: grid;
  width: var(--control-height-default);
  height: var(--control-height-default);
  flex: none;
  place-items: center;
  border-radius: 50%;
  color: var(--color-text-muted);
  background: var(--color-surface-subtle);
  font-size: var(--font-size-micro);
  font-variant-numeric: tabular-nums;
}

.cost-count {
  min-width: var(--control-height-default);
  color: var(--color-text-muted);
  font-size: var(--font-size-caption);
  text-align: center;
}

.additional-cost-list {
  margin-top: var(--space-3);
  border-block: 1px solid var(--color-border-subtle);
}

.additional-cost + .additional-cost {
  border-top: 1px solid var(--color-border-subtle);
}

.additional-cost > summary {
  min-height: var(--control-height-comfortable);
  gap: var(--space-3);
  padding-block: var(--space-2-5);
  list-style: none;
  cursor: pointer;
}

.additional-cost > summary::-webkit-details-marker {
  display: none;
}

.additional-cost > summary:hover strong {
  color: var(--color-accent);
}

.cost-summary-main,
.cost-summary-meta {
  display: flex;
  align-items: center;
}

.cost-summary-main {
  min-width: 0;
  gap: var(--space-3);
}

.cost-kind {
  width: 5.5rem;
  flex: none;
  color: var(--color-accent) !important;
  font-weight: var(--font-weight-medium);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
}

.cost-summary-meta {
  flex: none;
  gap: var(--space-2);
}

.cost-summary-meta .ui-icon {
  transition: transform var(--duration-fast) var(--easing-standard);
}

.additional-cost[open] .cost-summary-meta .ui-icon {
  transform: rotate(90deg);
}

.additional-cost-body {
  margin-left: calc(5.5rem + var(--space-3));
  padding: 0 0 var(--space-4);
}

@media (max-width: 640px) {
  .offer-list {
    display: grid;
  }

  .offer-choice {
    width: 100%;
  }

  .cost-summary-main {
    align-items: flex-start;
    gap: var(--space-2);
  }

  .cost-kind {
    width: 4.75rem;
  }

  .cost-summary-main > span > small {
    display: none;
  }

  .additional-cost-body {
    margin-left: 0;
  }
}
</style>
