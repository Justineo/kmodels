<script setup lang="ts" vapor>
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
      <svg viewBox="0 0 12 12"><path d="m3 7 3 3 3-3M6 10V2" /></svg>
    </span>
  </button>
</template>
