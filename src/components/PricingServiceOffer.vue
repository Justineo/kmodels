<script setup lang="ts" vapor>
import { computed } from "vue";
import type {
  WebsitePricingOffer,
  WebsiteProviderPricingOffer,
} from "../catalog/website-schema.ts";
import PricingOfferBreakdown from "./PricingOfferBreakdown.vue";
import PricingStatus from "./PricingStatus.vue";
import type { PricingRegion, WebsitePricingContext } from "../catalog/website-pricing-context.ts";
import { isCodeExecutionSelector, serviceOfferTitle } from "../pricing/condition-presentation.ts";

const props = defineProps<{
  offer: WebsitePricingOffer | WebsiteProviderPricingOffer;
  modelRef?: string | undefined;
  resourceTitle?: string;
  error?: string | undefined;
  preferredRegion?: PricingRegion | undefined;
  pricingContext?: WebsitePricingContext | undefined;
}>();
const pricing = computed(() => ("rates" in props.offer ? props.offer : undefined));
const title = computed(() => {
  // Older model detail chunks only carry the offer name.
  const resource =
    props.resourceTitle ??
    (props.offer.title === "Public rates" && pricing.value?.selectors.some(isCodeExecutionSelector)
      ? "Code Execution"
      : undefined);
  return serviceOfferTitle(resource, props.offer.title);
});
const kind = computed(() => {
  if (pricing.value?.group === "optional_service")
    return props.offer.state_summary === "Included" ? "Included feature" : "Service charge";
  if (pricing.value?.group === "automatic_component") return "Automatic charge";
  return "Separate service";
});
</script>

<template>
  <article class="rate-offer" :data-kind="pricing?.group ?? 'standalone'">
    <header class="rate-offer-heading">
      <small class="rate-kind">{{ kind }}</small>
      <h5>{{ title }}</h5>
    </header>
    <PricingOfferBreakdown
      v-if="pricing"
      :offer="pricing"
      :model-ref
      :preferred-region
      :pricing-context
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

.rate-kind,
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
</style>
