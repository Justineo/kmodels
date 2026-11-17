<script setup lang="ts" vapor>
import InferencePrices from "../../src/components/InferencePrices.vue";
import PricingOfferBreakdown from "../../src/components/PricingOfferBreakdown.vue";
import type { PricingPerformanceCase } from "./pricing-fixture.ts";
import type { WebsitePricingContext } from "../../src/catalog/website-pricing-context.ts";
import { shallowRef } from "vue";
defineProps<{ subject: PricingPerformanceCase; mode: "inference" | "offer" }>();
const context = shallowRef<WebsitePricingContext>();
</script>

<template>
  <span
    id="pricing-context"
    hidden
    :data-selections="
      JSON.stringify(context?.selections.filter(({ kind }) => kind === 'categorical') ?? [])
    "
  />
  <InferencePrices
    v-if="mode === 'inference'"
    :model-ref="subject.modelRef"
    :prices="subject.prices"
    :offers="subject.offers"
    @pricing-context="context = $event"
  />
  <template v-else>
    <PricingOfferBreakdown
      v-for="offer in subject.offers"
      :key="offer.id"
      :offer="offer"
      :model-ref="subject.modelRef"
      share-context
      @pricing-context="context = $event"
    />
  </template>
</template>
