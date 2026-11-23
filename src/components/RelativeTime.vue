<script setup lang="ts" vapor>
import { formatLocalDateTime, formatRelativeTime } from "../catalog/presentation.ts";
import UiTooltip from "./UiTooltip.vue";

defineProps<{ value: string }>();
</script>

<template>
  <UiTooltip class="tooltip-text-trigger" tabindex="0" :content="formatLocalDateTime(value)">
    <time :datetime="value">{{ formatRelativeTime(value) }}</time>
  </UiTooltip>
</template>
