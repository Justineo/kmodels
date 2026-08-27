<script setup lang="ts" vapor>
import { formatLocalDateTime, formatRelativeTime } from "../catalog/presentation.ts";
import UiTooltip from "./UiTooltip.vue";

defineProps<{ value: string }>();
</script>

<template>
  <UiTooltip as="button" class="tooltip-text-trigger" :content="formatLocalDateTime(value)">
    <time :datetime="value">{{ formatRelativeTime(value) }}</time>
  </UiTooltip>
</template>
