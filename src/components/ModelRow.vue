<script setup lang="ts" vapor>
import { computed } from "vue";
import {
  formatModelOperation,
  formatPrice,
  formatTablePricingState,
  formatTableRateLabel,
  formatTableRateUnit,
  formatTokenCount,
  primaryStatus,
  representativeTableRate,
} from "../catalog/presentation.ts";
import type {
  ModelLifecycle,
  ModelOperation,
  ModelReleaseStage,
  ProviderModel,
} from "../catalog/schema.ts";
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
  filterOperation: [operation: ModelOperation];
  filterLifecycle: [lifecycle: ModelLifecycle];
  filterReleaseStage: [releaseStage: ModelReleaseStage];
}>();

const inputRate = computed(() => representativeTableRate(props.model, "input"));
const cachedRate = computed(() => representativeTableRate(props.model, "cached"));
const outputRate = computed(() => representativeTableRate(props.model, "output"));
const inputRateUnit = computed(() => formatTableRateUnit(inputRate.value));
const cachedRateUnit = computed(() => formatTableRateUnit(cachedRate.value));
const outputRateUnit = computed(() => formatTableRateUnit(outputRate.value));
const hasRepresentativeRate = computed(
  () =>
    inputRate.value !== undefined ||
    cachedRate.value !== undefined ||
    outputRate.value !== undefined,
);
const pricingState = computed(() => formatTablePricingState(props.model));
const status = computed(() => primaryStatus(props.model));

function selectModel(): void {
  emit("select", props.model);
}

function filterStatus(): void {
  if (props.model.status === "active" && props.model.release_stage !== "unknown") {
    emit("filterReleaseStage", props.model.release_stage);
    return;
  }
  emit("filterLifecycle", props.model.status);
}
</script>

<template>
  <tr class="model-row" :aria-rowindex="rowIndex" :aria-selected="selected" :data-status="status">
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
        <span v-if="model.operations.length === 0">—</span>
        <template v-for="(operation, index) in model.operations" :key="operation">
          <span v-if="index > 0" class="operation-separator" aria-hidden="true">, </span>
          <button
            class="operation-filter-button"
            type="button"
            :aria-label="`Filter by operation ${formatModelOperation(operation)}`"
            @click="emit('filterOperation', operation)"
          >
            {{ formatModelOperation(operation) }}
          </button>
        </template>
      </span>
    </td>
    <td class="status-col">
      <button
        class="row-status"
        type="button"
        :aria-label="`Filter by status ${status}`"
        @click="filterStatus"
      >
        <span aria-hidden="true"></span>
        {{ status }}
      </button>
    </td>
    <td class="context-col numeric">{{ formatTokenCount(model.limits.context_tokens) }}</td>
    <template v-if="hasRepresentativeRate">
      <td
        class="input-col price-cell numeric"
        :aria-label="inputRate ? formatTableRateLabel(inputRate) : undefined"
        :title="inputRate ? formatTableRateLabel(inputRate) : undefined"
      >
        <template v-if="inputRate">
          <span class="price-value">{{ formatPrice(inputRate) }}</span>
          <small v-if="inputRateUnit">{{ inputRateUnit }}</small>
        </template>
        <span v-else aria-hidden="true">—</span>
      </td>
      <td
        class="cached-col price-cell numeric"
        :aria-label="cachedRate ? formatTableRateLabel(cachedRate) : undefined"
        :title="cachedRate ? formatTableRateLabel(cachedRate) : undefined"
      >
        <template v-if="cachedRate">
          <span class="price-value">{{ formatPrice(cachedRate) }}</span>
          <small v-if="cachedRateUnit">{{ cachedRateUnit }}</small>
        </template>
        <span v-else aria-hidden="true">—</span>
      </td>
      <td
        class="output-col price-cell numeric"
        :aria-label="outputRate ? formatTableRateLabel(outputRate) : undefined"
        :title="outputRate ? formatTableRateLabel(outputRate) : undefined"
      >
        <template v-if="outputRate">
          <span class="price-value">{{ formatPrice(outputRate) }}</span>
          <small v-if="outputRateUnit">{{ outputRateUnit }}</small>
        </template>
        <span v-else aria-hidden="true">—</span>
      </td>
    </template>
    <template v-else>
      <td
        class="input-col pricing-state-cell"
        :aria-label="`Pricing: ${pricingState}`"
        :title="`Pricing: ${pricingState}`"
      >
        {{ pricingState }}
      </td>
      <td class="cached-col" aria-hidden="true"></td>
      <td class="output-col" aria-hidden="true"></td>
    </template>
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
