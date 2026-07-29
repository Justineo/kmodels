<script setup lang="ts" vapor>
import { computed } from "vue";
import ProviderIcon from "./ProviderIcon.vue";
import UiSelect from "./UiSelect.vue";

const props = defineProps<{
  options: Array<{ id: string; name: string }>;
}>();

const selected = defineModel<string>({ required: true });
const selectOptions = computed(() =>
  props.options.map(({ id, name }) => ({ value: id, label: name })),
);
</script>

<template>
  <div class="select-field">
    <label class="select-label" for="provider-select">Provider</label>
    <UiSelect
      id="provider-select"
      :key="options.length"
      v-model="selected"
      :options="selectOptions"
      placeholder="All providers"
    >
      <template #placeholder-prefix>
        <span class="provider-option-placeholder" aria-hidden="true"></span>
      </template>
      <template #option-prefix="{ option }">
        <ProviderIcon :provider-id="option.value" :provider-name="option.label" />
      </template>
      <template #value-prefix="{ option }">
        <ProviderIcon v-if="option" :provider-id="option.value" :provider-name="option.label" />
        <span v-else class="provider-option-placeholder" aria-hidden="true"></span>
      </template>
    </UiSelect>
  </div>
</template>
