<script setup lang="ts" vapor>
import { computed } from "vue";
import type { WebsiteModel } from "../catalog/website-schema.ts";
import UiTooltip from "./UiTooltip.vue";

const props = defineProps<{ price: WebsiteModel["pricing"]["input"] }>();
const unit = computed(() => {
  const value = props.price?.displayUnit;
  return value === undefined || value === "1M tokens" ? undefined : `/ ${value}`;
});
</script>

<template>
  <td
    class="price-cell numeric"
    :aria-label="price?.showTooltip ? undefined : price?.accessibleText"
  >
    <UiTooltip
      v-if="price?.showTooltip"
      class="price-tooltip-trigger"
      tabindex="0"
      :content="price.accessibleText"
      :aria-label="price.accessibleText"
    >
      <span class="price-value">{{ price.amount }}</span>
      <small v-if="unit">{{ unit }}</small>
    </UiTooltip>
    <template v-else-if="price">
      <span class="price-value">{{ price.amount }}</span>
      <small v-if="unit">{{ unit }}</small>
    </template>
    <span v-else class="price-value">—</span>
  </td>
</template>
