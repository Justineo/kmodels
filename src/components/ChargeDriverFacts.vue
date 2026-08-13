<script setup lang="ts" vapor>
import type { WebsitePricingOffer } from "../catalog/website-schema.ts";

type ChargeDriver = NonNullable<WebsitePricingOffer["rates"][number]["driver"]>;

defineProps<{ driver: ChargeDriver }>();

const whenKnown = {
  publication: "Set by the published price",
  request: "Before the request is sent",
  outcome: "After the result is known",
  account: "From account-level billing data",
} satisfies Record<ChargeDriver["resolution_phase"], string>;
</script>

<template>
  <dl class="charge-driver-facts">
    <div>
      <dt>Charges for</dt>
      <dd>{{ driver.label }}</dd>
    </div>
    <div>
      <dt>What counts</dt>
      <dd>{{ driver.definition }}</dd>
    </div>
    <div>
      <dt>Counted per</dt>
      <dd>
        {{ driver.aggregation }}
        <small v-if="driver.aggregation_definition">{{ driver.aggregation_definition }}</small>
      </dd>
    </div>
    <div>
      <dt>When known</dt>
      <dd>{{ whenKnown[driver.resolution_phase] }}</dd>
    </div>
  </dl>
</template>

<style scoped>
.charge-driver-facts {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-1-5) var(--space-2);
  margin: var(--space-2) 0 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-micro);
  font-weight: var(--font-weight-regular);
}

.charge-driver-facts > div {
  display: contents;
}

.charge-driver-facts dt {
  color: var(--color-text-muted);
  font-weight: var(--font-weight-semibold);
}

.charge-driver-facts dd {
  min-width: 0;
  margin: 0;
}

.charge-driver-facts small {
  display: block;
  margin-top: var(--space-0-5);
  color: var(--color-text-muted);
  font: inherit;
}
</style>
