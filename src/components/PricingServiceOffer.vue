<script setup lang="ts" vapor>
import { computed } from "vue";
import type {
  WebsitePricingOffer,
  WebsiteProviderPricingOffer,
} from "../catalog/website-schema.ts";
import PricingOfferBreakdown from "./PricingOfferBreakdown.vue";

const props = defineProps<{
  offer: WebsitePricingOffer | WebsiteProviderPricingOffer;
  modelRef?: string | undefined;
  resourceTitle?: string;
  error?: string | undefined;
}>();
const emit = defineEmits<{ retry: [] }>();
const pricing = computed(() => ("rates" in props.offer ? props.offer : undefined));
const kind = computed(() => {
  if (pricing.value?.group === "optional_service")
    return props.offer.state_summary === "Included" ? "Included feature" : "Service charge";
  if (pricing.value?.group === "automatic_component") return "Automatic charge";
  return "Separate service";
});
const state = computed(() =>
  ["Metered pricing", "Included"].includes(props.offer.state_summary)
    ? undefined
    : props.offer.state_summary,
);
</script>

<template>
  <article class="rate-offer" :data-kind="pricing?.group ?? 'standalone'">
    <header class="rate-offer-heading">
      <div>
        <small class="rate-kind"
          >{{ kind }}<template v-if="resourceTitle"> · {{ resourceTitle }}</template></small
        >
        <h5>{{ offer.title }}</h5>
      </div>
      <small v-if="state" class="offer-state">{{ state }}</small>
    </header>
    <PricingOfferBreakdown v-if="pricing" :offer="pricing" :model-ref explain-charges />
    <p v-else-if="error" class="service-status" role="alert">
      {{ error }} <button type="button" @click="emit('retry')">Retry</button>
    </p>
    <p v-else class="service-status" aria-live="polite">Loading pricing…</p>
    <p
      v-if="pricing && pricing.unnormalized_count > pricing.unnormalized.length"
      class="service-status"
    >
      Showing {{ pricing.unnormalized.length }} of {{ pricing.unnormalized_count }} pricing facts.
      The complete pricing download contains every official fact.
    </p>
  </article>
</template>

<style scoped>
.rate-offer {
  min-width: 0;
}

.rate-offer-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.rate-offer-heading h5 {
  margin: 0;
  color: var(--color-text-primary);
  font-size: var(--font-size-body);
}

.rate-offer-heading > div {
  display: grid;
  min-width: 0;
  gap: var(--space-0-5);
}

.rate-kind,
.offer-state,
.service-status {
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
}

.rate-kind {
  color: var(--color-accent);
  font-weight: var(--font-weight-medium);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
}

.offer-state {
  text-align: right;
}
</style>
