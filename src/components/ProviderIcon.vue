<script setup lang="ts" vapor>
import { computed } from "vue";
import { darkProviderSymbolId, providerSymbolId } from "../icons/sprite.ts";

const props = defineProps<{
  providerId: string;
  providerName: string;
}>();

const icon = computed(() => providerSymbolId(props.providerId));
const darkIcon = computed(() => darkProviderSymbolId(props.providerId));
const fallback = computed(() => props.providerName.slice(0, 1).toLocaleUpperCase());
</script>

<template>
  <span class="provider-icon" aria-hidden="true">
    <svg v-if="icon" class="provider-icon-art" viewBox="0 0 24 24">
      <use :class="{ 'provider-icon-light': darkIcon }" :href="`#${icon}`"></use>
      <use v-if="darkIcon" class="provider-icon-dark" :href="`#${darkIcon}`"></use>
    </svg>
    <span class="provider-icon-fallback" v-if="!icon">{{ fallback }}</span>
  </span>
</template>
