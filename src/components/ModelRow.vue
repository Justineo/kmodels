<script setup lang="ts" vapor>
import { computed } from "vue";
import {
  formatModelType,
  formatPrice,
  formatTableRateUnit,
  formatTokenCount,
  perMillionTokenRate,
  preferredRate,
} from "../catalog/presentation.ts";
import type { ModelType, ProviderModel } from "../catalog/schema.ts";
import ProviderIcon from "./ProviderIcon.vue";
import UiIcon from "./UiIcon.vue";

const props = defineProps<{
  model: ProviderModel;
  providerName: string;
  rowIndex: number;
  selected: boolean;
}>();

const emit = defineEmits<{
  select: [model: ProviderModel];
  filterProvider: [providerId: string];
  filterType: [modelType: ModelType];
  filterStatus: [status: ProviderModel["status"]];
}>();

const inputRate = computed(() => perMillionTokenRate(preferredRate(props.model, "input_text")));
const outputRate = computed(() => perMillionTokenRate(preferredRate(props.model, "output_text")));
const inputRateUnit = computed(() => formatTableRateUnit(inputRate.value));
const outputRateUnit = computed(() => formatTableRateUnit(outputRate.value));

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
  >
    <td class="model-col">
      <button
        class="model-identity"
        type="button"
        :aria-label="`View ${model.name} details`"
        @click="selectModel"
      >
        <strong>{{ model.name }}</strong>
        <code>
          {{ model.model_id }}<span v-if="model.version"> · {{ model.version }}</span>
        </code>
      </button>
    </td>
    <td class="provider-col">
      <button
        class="provider-identity"
        type="button"
        :aria-label="`Filter by provider ${providerName}`"
        @click="emit('filterProvider', model.provider_id)"
      >
        <ProviderIcon :provider-id="model.provider_id" :provider-name="providerName" />
        <span>{{ providerName }}</span>
      </button>
    </td>
    <td class="operations-col">
      <span class="operation-list">
        <button
          v-for="modelType in model.types"
          :key="modelType"
          class="operation-filter-button"
          type="button"
          :aria-label="`Filter by operation ${formatModelType(modelType)}`"
          @click="emit('filterType', modelType)"
        >
          {{ formatModelType(modelType) }}
        </button>
      </span>
    </td>
    <td class="status-col">
      <button
        class="row-status"
        type="button"
        :aria-label="`Filter by status ${model.status}`"
        @click="emit('filterStatus', model.status)"
      >
        <span aria-hidden="true"></span>
        {{ model.status }}
      </button>
    </td>
    <td class="context-col numeric">{{ formatTokenCount(model.limits.context_tokens) }}</td>
    <td class="input-col price-cell numeric">
      <strong>{{ formatPrice(inputRate) }}</strong>
      <small v-if="inputRateUnit">{{ inputRateUnit }}</small>
    </td>
    <td class="output-col price-cell numeric">
      <strong>{{ formatPrice(outputRate) }}</strong>
      <small v-if="outputRateUnit">{{ outputRateUnit }}</small>
    </td>
    <td class="updated-col numeric">
      {{ model.updated_date ?? model.release_date ?? "—" }}
    </td>
    <td class="disclosure-col">
      <button
        class="disclosure-button"
        type="button"
        :aria-label="`View ${model.name} details`"
        @click="selectModel"
      >
        <UiIcon name="chevron-right" />
      </button>
    </td>
  </tr>
</template>
