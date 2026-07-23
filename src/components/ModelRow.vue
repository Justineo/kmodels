<script setup lang="ts" vapor>
import { computed } from "vue";
import {
  formatPrice,
  formatRateUnit,
  formatTokenCount,
  modelTypeList,
  preferredRate,
} from "../catalog/presentation.ts";
import type { ProviderModel } from "../catalog/schema.ts";

const props = defineProps<{
  model: ProviderModel;
  providerName: string;
  rowIndex: number;
  selected: boolean;
}>();

const emit = defineEmits<{
  select: [model: ProviderModel];
}>();

const inputRate = computed(() => preferredRate(props.model, "input_text"));
const outputRate = computed(() => preferredRate(props.model, "output_text"));

function selectModel(): void {
  emit("select", props.model);
}
</script>

<template>
  <tr
    class="model-row"
    :aria-rowindex="rowIndex"
    :aria-selected="selected"
    :data-status="model.status"
    @click="selectModel"
  >
    <td class="model-col">
      <button
        class="model-identity"
        type="button"
        :aria-label="`View ${model.name} details`"
        @click.stop="selectModel"
      >
        <strong>{{ model.name }}</strong>
        <code>
          {{ model.model_id }}<span v-if="model.version"> · {{ model.version }}</span>
        </code>
      </button>
    </td>
    <td class="provider-col">{{ providerName }}</td>
    <td class="operations-col">{{ modelTypeList(model) }}</td>
    <td class="status-col">
      <span class="row-status">
        <span aria-hidden="true"></span>
        {{ model.status }}
      </span>
    </td>
    <td class="context-col numeric">{{ formatTokenCount(model.limits.context_tokens) }}</td>
    <td class="input-col price-cell numeric">
      <strong>{{ formatPrice(inputRate) }}</strong>
      <small>{{ formatRateUnit(inputRate) }}</small>
    </td>
    <td class="output-col price-cell numeric">
      <strong>{{ formatPrice(outputRate) }}</strong>
      <small>{{ formatRateUnit(outputRate) }}</small>
    </td>
    <td class="updated-col numeric">
      {{ model.updated_date ?? model.release_date ?? "—" }}
    </td>
    <td class="disclosure-col">
      <button
        class="disclosure-button"
        type="button"
        :aria-label="`View ${model.name} details`"
        @click.stop="selectModel"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m6 3 5 5-5 5" />
        </svg>
      </button>
    </td>
  </tr>
</template>
