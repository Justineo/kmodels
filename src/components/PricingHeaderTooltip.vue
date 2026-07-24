<script setup lang="ts" vapor>
defineProps<{
  label: string;
  tooltipId: string;
}>();
</script>

<template>
  <span class="pricing-header-tooltip">
    <button
      class="pricing-header-trigger"
      type="button"
      :aria-describedby="tooltipId"
      :aria-label="`${label} pricing units`"
    >
      {{ label }}
    </button>
    <span :id="tooltipId" class="pricing-unit-tooltip" role="tooltip">
      <slot></slot>
    </span>
  </span>
</template>
