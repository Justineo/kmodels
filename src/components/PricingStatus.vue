<script setup lang="ts" vapor>
defineProps<{ heading?: string; message?: string; refresh?: boolean }>();

function refreshPage(): void {
  window.location.reload();
}
</script>

<template>
  <div class="pricing-outcome" :role="refresh ? 'alert' : undefined">
    <strong v-if="heading">{{ heading }}</strong>
    <span v-if="message">{{ message }}</span>
    <button v-if="refresh" type="button" @click="refreshPage">Refresh page</button>
  </div>
</template>

<style scoped>
.pricing-outcome {
  display: grid;
  gap: var(--space-1);
  padding: var(--space-3);
  border: var(--stroke-hairline) solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-subtle);
}

.pricing-outcome span {
  color: var(--color-text-muted);
  font-size: var(--font-size-body);
}

.pricing-outcome button {
  width: max-content;
  min-height: var(--control-height-default);
  margin-top: var(--space-1);
  padding-inline: var(--space-3);
  border: var(--stroke-hairline) solid var(--color-border-default);
  border-radius: var(--radius-md);
  color: var(--color-text-primary);
  background: var(--color-surface);
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-medium);
}

.pricing-outcome button:hover {
  border-color: var(--color-border-interactive);
  background: var(--color-surface-hover);
}
</style>
