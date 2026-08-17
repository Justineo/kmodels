<script setup lang="ts" vapor>
import { formatRelativeTime, formatUtcDateTime } from "../catalog/presentation.ts";
import UiTooltip from "./UiTooltip.vue";

defineProps<{ value: string }>();
</script>

<template>
  <UiTooltip as="button" class="tooltip-text-trigger" :content="formatUtcDateTime(value)">
    <time :datetime="value">{{ formatRelativeTime(value) }}</time>
  </UiTooltip>
</template>
