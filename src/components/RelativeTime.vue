<script setup lang="ts" vapor>
import { formatRelativeTime, formatUtcDateTime } from "../catalog/presentation.ts";
import UiTooltip from "./UiTooltip.vue";

defineProps<{ value: string }>();
</script>

<template>
  <UiTooltip as="button" class="relative-time" :content="formatUtcDateTime(value)">
    <time :datetime="value">{{ formatRelativeTime(value) }}</time>
  </UiTooltip>
</template>

<style scoped>
.relative-time {
  border-bottom: var(--stroke-hairline) dotted var(--color-border-interactive);
  color: inherit;
  cursor: help;
}
</style>
