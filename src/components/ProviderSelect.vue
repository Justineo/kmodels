<script setup lang="ts" vapor>
import { computed } from "vue";
import type { Provider } from "../catalog/schema.ts";
import ProviderIcon from "./ProviderIcon.vue";
import UiIcon from "./UiIcon.vue";

const props = defineProps<{
  options: Provider[];
}>();

const selected = defineModel<string>({ required: true });
const selectedProvider = computed(() =>
  props.options.find((provider) => provider.id === selected.value),
);
</script>

<template>
  <div class="select-field">
    <label class="select-label" for="provider-select">Provider</label>
    <div class="provider-select-control">
      <select id="provider-select" v-model="selected" class="provider-select">
        <option value="">
          <span class="provider-option-placeholder" aria-hidden="true"></span>
          <span class="provider-option-label">All providers</span>
        </option>
        <option v-for="provider in options" :key="provider.id" :value="provider.id">
          <ProviderIcon :provider-id="provider.id" :provider-name="provider.name" />
          <span class="provider-option-label">{{ provider.name }}</span>
        </option>
      </select>
      <span class="provider-select-value" aria-hidden="true">
        <ProviderIcon
          v-if="selectedProvider"
          :provider-id="selectedProvider.id"
          :provider-name="selectedProvider.name"
        />
        <span class="provider-option-label">
          {{ selectedProvider?.name ?? "All providers" }}
        </span>
        <UiIcon class="select-chevron" name="chevron-down" />
      </span>
    </div>
  </div>
</template>
