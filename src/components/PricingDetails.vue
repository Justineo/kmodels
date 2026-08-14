<script setup lang="ts" vapor>
import { computed, ref, watch } from "vue";
import { formatSnapshotAt } from "../catalog/presentation.ts";
import type {
  WebsiteModel,
  WebsitePricingDetail,
  WebsitePricingOffer,
} from "../catalog/website-schema.ts";
import PricingOfferBreakdown from "./PricingOfferBreakdown.vue";

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
const rateOffers = computed(() =>
  offers.value.filter((offer) => {
    if (offer.group === "model_mechanism") return offer.id === activeMechanism.value?.id;
    return (
      offer.group !== "plan_capacity" &&
      (activeMechanism.value === undefined ||
        offer.mechanism_refs === undefined ||
        offer.mechanism_refs.includes(activeMechanism.value.id))
    );
  }),
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

function offerKind(offer: WebsitePricingOffer): string {
  if (offer.group === "model_mechanism") return "Base model";
  if (offer.group === "optional_service") return "Optional";
  if (offer.group === "automatic_component") return "Automatic";
  return "Service";
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
        v-if="modelMechanisms.length > 1"
        class="run-mode"
        aria-labelledby="run-mode-heading"
      >
        <h4 id="run-mode-heading" class="section-heading">Run mode</h4>

        <fieldset class="run-mode-options">
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
              <strong>{{ offer.title }}</strong>
              <small v-if="offerState(offer)" class="offer-state">{{ offerState(offer) }}</small>
            </label>
          </div>
        </fieldset>
      </section>

      <div v-if="rateOffers.length > 0" class="rate-sheet">
        <div v-if="!activeMechanism" class="pricing-outcome no-base-offer">
          <strong>No base model rate</strong>
        </div>

        <article
          v-for="offer in rateOffers"
          :key="offer.id"
          class="rate-offer"
          :data-kind="offer.group"
        >
          <header class="rate-offer-heading">
            <div>
              <small class="rate-kind">{{ offerKind(offer) }}</small>
              <h5>{{ offer.title }}</h5>
            </div>
            <small v-if="offerState(offer)" class="offer-state">{{ offerState(offer) }}</small>
          </header>
          <PricingOfferBreakdown :offer="offer" :model-ref="model.uid" />
        </article>
      </div>
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

.run-mode {
  margin-top: var(--space-5);
}

.rate-sheet {
  margin-top: var(--space-3);
}

.run-mode + .rate-sheet {
  margin-top: var(--space-5);
}

.rate-offer-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section-heading,
.rate-offer-heading h5 {
  margin: 0;
}

.section-heading {
  color: var(--color-text-primary);
  font-size: var(--font-size-body);
}

.offer-choice small {
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

.rate-offer-heading {
  gap: var(--space-3);
}

.rate-offer {
  min-width: 0;
  margin-top: var(--space-4);
  padding-top: var(--space-4);
  border-top: 1px solid var(--color-border-subtle);
}

.rate-offer[data-kind="model_mechanism"] {
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
}

.rate-offer-heading > div {
  display: grid;
  min-width: 0;
  gap: var(--space-0-5);
}

.rate-offer-heading h5 {
  color: var(--color-text-primary);
  font-size: var(--font-size-body);
}

.rate-kind {
  color: var(--color-text-muted);
  font-size: var(--font-size-micro);
  font-weight: var(--font-weight-medium);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
}

.rate-offer:not([data-kind="model_mechanism"]) .rate-kind {
  color: var(--color-accent);
}

.no-base-offer {
  margin-top: var(--space-4);
}

@media (max-width: 640px) {
  .offer-list {
    display: grid;
  }

  .offer-choice {
    width: 100%;
  }
}
</style>
