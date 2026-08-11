<script setup lang="ts" vapor>
import { detailsState } from "./details-state.ts";
import ModelDetails from "./components/ModelDetails.vue";
import ProviderPricingDetails from "./components/ProviderPricingDetails.vue";
</script>

<template>
  <ModelDetails
    :model="detailsState.model"
    :provider-name="detailsState.providerName"
    :detail="detailsState.detail"
    :loading="detailsState.loading"
    :error="detailsState.error"
    :pricing-target="detailsState.pricingTarget"
    @close="detailsState.close"
    @navigate="detailsState.navigate"
    @pricing-target-reached="detailsState.pricingTarget = undefined"
  />
  <ProviderPricingDetails
    :provider="detailsState.provider"
    :detail="detailsState.providerPricing"
    :loading="detailsState.loading"
    :error="detailsState.error"
    @close="detailsState.close"
  />
</template>
