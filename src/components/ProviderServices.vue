<script setup lang="ts" vapor>
import { ref, watch } from "vue";
import { loadWebsiteProviderPricing } from "../catalog/website-loader.ts";
import type { WebsiteProvider, WebsiteProviderPricingDetail } from "../catalog/website-schema.ts";
import ProviderPricingDetails from "./ProviderPricingDetails.vue";
import UiIcon from "./UiIcon.vue";

const props = defineProps<{ provider: WebsiteProvider; dataVersion: string }>();
const expanded = ref(false);
const detail = ref<WebsiteProviderPricingDetail>();
const loading = ref(false);
const error = ref<string>();
let request = 0;

watch([() => props.provider.id, () => props.dataVersion], () => {
  request += 1;
  detail.value = undefined;
  loading.value = false;
  error.value = undefined;
  if (expanded.value) void load();
});

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

function toggle(event: Event): void {
  if (!(event.currentTarget instanceof HTMLDetailsElement)) return;
  expanded.value = event.currentTarget.open;
  if (expanded.value) void load();
}
</script>

<template>
  <details class="provider-services" @toggle="toggle">
    <summary>
      <strong>{{ provider.name }} services</strong>
      <small
        >{{ provider.pricing_coverage.standalone_resources }} separately priced resources</small
      >
      <UiIcon name="chevron-right" />
    </summary>
    <p class="scope-note">
      Provider services are billed separately. Availability depends on each service and invocation
      method; listing a service here does not establish compatibility with this model.
    </p>
    <ProviderPricingDetails :provider :detail :loading :error @retry="load" />
  </details>
</template>

<style scoped>
.provider-services {
  margin-top: var(--space-4);
  border-top: var(--stroke-hairline) solid var(--color-border-subtle);
}

.provider-services > summary {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
  padding-block: var(--space-3);
  cursor: pointer;
}

.provider-services small,
.scope-note {
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
}

.provider-services[open] > summary > .ui-icon {
  transform: rotate(90deg);
}

.scope-note {
  margin: 0 0 var(--space-3);
}
</style>
