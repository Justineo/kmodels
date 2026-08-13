<script setup lang="ts" vapor>
import type { UiIconName } from "../icons/manifest.ts";

defineProps<{
  name: UiIconName;
}>();
</script>

<template>
  <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">
    <use :href="`#ui-${name}`"></use>
  </svg>
</template>
