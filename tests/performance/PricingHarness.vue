<script setup lang="ts" vapor>
import InferencePrices from "../../src/components/InferencePrices.vue";
import PricingOfferBreakdown from "../../src/components/PricingOfferBreakdown.vue";
import type { PricingPerformanceCase } from "./pricing-fixture.ts";
defineProps<{ subject: PricingPerformanceCase; mode: "inference" | "offer" }>();
</script>

<template>
  <InferencePrices
    v-if="mode === 'inference'"
    :model-ref="subject.modelRef"
    :prices="subject.prices"
    :offers="subject.offers"
  />
  <template v-else>
    <PricingOfferBreakdown
      v-for="offer in subject.offers"
      :key="offer.id"
      :offer="offer"
      :model-ref="subject.modelRef"
    />
  </template>
</template>
