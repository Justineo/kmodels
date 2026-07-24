<script setup lang="ts" vapor>
import UiIcon from "./UiIcon.vue";

defineProps<{
  direction: "ascending" | "descending" | undefined;
  label: string;
}>();

const emit = defineEmits<{
  sort: [];
}>();
</script>

<template>
  <button type="button" @click="emit('sort')">
    {{ label }}
    <span
      class="sort-icon"
      :class="{
        active: direction !== undefined,
        descending: direction === 'descending',
      }"
      aria-hidden="true"
    >
      <UiIcon name="arrow-up" />
    </span>
  </button>
</template>
