<script setup lang="ts" vapor>
import { computed } from "vue";
import type {
  WebsitePricingOffer,
  WebsiteProviderPricingOffer,
} from "../catalog/website-schema.ts";
import PricingOfferBreakdown from "./PricingOfferBreakdown.vue";
import PricingStatus from "./PricingStatus.vue";
import type { PricingRegion, WebsitePricingContext } from "../catalog/website-pricing-context.ts";
import { serviceOfferTitle } from "../pricing/condition-presentation.ts";

const props = defineProps<{
  offer: WebsitePricingOffer | WebsiteProviderPricingOffer;
  modelRef?: string | undefined;
  resourceTitle?: string;
  error?: string | undefined;
  preferredRegion?: PricingRegion | undefined;
  pricingContext?: WebsitePricingContext | undefined;
}>();
const pricing = computed(() => ("rates" in props.offer ? props.offer : undefined));
const title = computed(() =>
  serviceOfferTitle(props.resourceTitle, props.offer.title, pricing.value?.selectors),
);
</script>

<template>
  <article class="rate-offer" :data-kind="pricing?.group ?? 'standalone'">
    <header v-if="!pricing" class="rate-offer-heading">
      <h5>{{ title }}</h5>
    </header>
    <PricingOfferBreakdown
      v-if="pricing"
      :offer="pricing"
      :model-ref
      :preferred-region
      :pricing-context
      :service-title="title"
      service
    />
    <PricingStatus v-else-if="error" heading="Pricing unavailable" :message="error" refresh />
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
  padding-block: var(--space-2-5);
  border-top: var(--stroke-hairline) solid var(--color-border-subtle);
}

.rate-offer-heading {
  display: grid;
  gap: var(--space-0-5);
}

.rate-offer-heading h5 {
  margin: 0;
  color: var(--color-text-primary);
  font-size: var(--font-size-body);
}

.service-status {
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
}
</style>
