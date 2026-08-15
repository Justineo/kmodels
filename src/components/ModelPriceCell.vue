<script setup lang="ts" vapor>
import { computed } from "vue";
import type { WebsiteModel } from "../catalog/website-schema.ts";

const props = defineProps<{ price: WebsiteModel["pricing"]["input"] }>();
const unit = computed(() => {
  const value = props.price?.displayUnit;
  return value === undefined || value === "1M tokens" ? undefined : `/ ${value}`;
});
</script>

<template>
  <td class="price-cell numeric" :aria-label="price?.accessibleText">
    <template v-if="price">
      <span class="price-value">{{ price.amount }}</span>
      <small v-if="unit">{{ unit }}</small>
    </template>
    <span v-else class="price-value">—</span>
  </td>
</template>
