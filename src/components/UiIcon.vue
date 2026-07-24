<script setup lang="ts" vapor>
import { computed } from "vue";
import { type UiIconName, uiSymbolId } from "../icons/sprite.ts";

const props = defineProps<{
  name: UiIconName;
}>();

const icon = computed(() => uiSymbolId(props.name));
</script>

<template>
  <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">
    <use :href="`#${icon}`"></use>
  </svg>
</template>
