<script setup lang="ts" vapor>
import type { CapabilityValue } from "../catalog/capability-presentation.ts";
import UiTooltip from "./UiTooltip.vue";

defineProps<{ values: readonly CapabilityValue[] }>();
</script>

<template>
  <ul class="capability-values" role="list">
    <li v-for="{ value, isDefault, partialDefault } in values" :key="value">
      <UiTooltip
        v-if="isDefault"
        class="capability-value"
        data-default
        :aria-label="`${value} (${partialDefault ? 'default where documented' : 'default'})`"
        :content="partialDefault ? 'Default where documented' : 'Default'"
        tabindex="0"
        >{{ value }}</UiTooltip
      >
      <span v-else class="capability-value">{{ value }}</span>
    </li>
  </ul>
</template>

<style scoped>
.capability-values {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}
.capability-values :deep(.capability-value) {
  display: inline-flex;
  min-height: var(--tag-height);
  align-items: center;
  padding-inline: var(--tag-padding-inline);
  border-radius: var(--tag-radius);
  color: var(--tag-text);
  background: var(--tag-background);
  font-family: var(--font-family-mono);
  font-size: var(--tag-font-size);
  line-height: var(--line-height-none);
}
.capability-values :deep(.capability-value[data-default]) {
  color: var(--color-text-primary);
  background: var(--color-accent-soft);
  outline: var(--stroke-hairline) solid var(--color-border-interactive);
  outline-offset: calc(var(--stroke-hairline) * -1);
  font-weight: var(--font-weight-semibold);
  cursor: help;
}
</style>
