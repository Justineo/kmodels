<script setup lang="ts" vapor>
defineProps<{ labels: readonly string[] }>();

const list = new Intl.ListFormat("en", { type: "conjunction" });
</script>

<template>
  <p class="pricing-selection-prompt" role="status">
    {{
      labels.length
        ? `Choose ${list.format(labels)} to see rates.`
        : "Choose the options above to see rates."
    }}
  </p>
</template>

<style scoped>
.pricing-selection-prompt {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-body);
}
</style>
