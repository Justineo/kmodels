<script setup lang="ts" vapor>
import UiTooltip from "./UiTooltip.vue";

defineProps<{
  expanded: boolean;
  toggleLabel: string;
  description: string;
}>();

const emit = defineEmits<{
  toggle: [];
}>();
</script>

<template>
  <UiTooltip
    as="button"
    type="button"
    class="group-varies-trigger tooltip-text-trigger table-status-trigger"
    :aria-expanded="expanded"
    :content="description"
    :aria-label="`${toggleLabel}. ${description}`"
    @click="emit('toggle')"
  >
    Varies
  </UiTooltip>
</template>
