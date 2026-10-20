<script setup lang="ts" vapor>
import { ref, watch } from "vue";
import { loadWebsiteProviderPricing } from "../catalog/website-loader.ts";
import type { WebsiteProvider, WebsiteProviderPricingDetail } from "../catalog/website-schema.ts";
import ProviderPricingDetails from "./ProviderPricingDetails.vue";

const props = defineProps<{
  provider: WebsiteProvider;
  dataVersion: string;
  active: boolean;
  excludedOfferIds: string[];
}>();
const detail = ref<WebsiteProviderPricingDetail>();
const loading = ref(false);
const error = ref<string>();
let request = 0;

watch([() => props.provider.id, () => props.dataVersion], () => {
  request += 1;
  detail.value = undefined;
  loading.value = false;
  error.value = undefined;
  if (props.active) void load();
});

watch(
  () => props.active,
  (active) => {
    if (active) void load();
  },
  { immediate: true },
);

async function load(): Promise<void> {
  if (loading.value || detail.value !== undefined) return;
  const current = ++request;
  loading.value = true;
  error.value = undefined;
  try {
    const value = await loadWebsiteProviderPricing(props.dataVersion, props.provider);
    if (current === request) detail.value = value;
  } catch {
    if (current === request) error.value = "Service pricing is temporarily unavailable.";
  } finally {
    if (current === request) loading.value = false;
  }
}
</script>

<template>
  <ProviderPricingDetails
    :provider
    :detail
    :loading
    :error
    :active
    :excluded-offer-ids
    @retry="load"
  />
</template>
