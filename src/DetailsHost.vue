<script setup lang="ts" vapor>
import { detailsState } from "./details-state.ts";
import ModelDetails from "./components/ModelDetails.vue";
</script>

<template>
  <ModelDetails
    :model="detailsState.model"
    :provider-name="detailsState.providerName"
    :detail="detailsState.detail"
    :loading="detailsState.loading"
    :error="detailsState.error"
    @close="detailsState.close"
    @navigate="detailsState.navigate"
  />
</template>
