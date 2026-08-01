<script setup lang="ts" vapor>
import { computed } from "vue";
import {
  formatModelTask,
  formatTableTask,
  formatTokenCount,
  primaryStatus,
} from "../catalog/presentation.ts";
import type { WebsiteModel } from "../catalog/website-schema.ts";
import ModelPriceCell from "./ModelPriceCell.vue";
import ProviderIcon from "./ProviderIcon.vue";
import UiIcon from "./UiIcon.vue";
import UiTooltip from "./UiTooltip.vue";

type ModelTask = WebsiteModel["tasks"][number];
type ModelLifecycle = WebsiteModel["status"];
type ModelReleaseStage = WebsiteModel["release_stage"];

const props = defineProps<{
  model: WebsiteModel;
  providerName: string;
  rowIndex: number;
  alternate: boolean;
  selected: boolean;
  showVersionBadge: boolean;
  nested?: boolean;
}>();

const emit = defineEmits<{
  select: [model: WebsiteModel];
  selectPricing: [model: WebsiteModel];
  filterProvider: [providerId: string];
  filterTask: [task: ModelTask];
  filterLifecycle: [lifecycle: ModelLifecycle];
  filterReleaseStage: [releaseStage: ModelReleaseStage];
}>();

const pricingStatus = computed(() => props.model.pricing.status);
const hasRepresentativeRate = computed(
  () =>
    props.model.pricing.input !== undefined ||
    props.model.pricing.cache !== undefined ||
    props.model.pricing.output !== undefined,
);
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
  <tr
    class="model-row"
    :aria-rowindex="rowIndex"
    :aria-selected="selected"
    :data-alternate="alternate ? 'true' : undefined"
    :data-status="status"
    :data-nested="nested ? 'true' : undefined"
  >
    <td class="model-col">
      <div class="model-cell">
        <button
          class="model-identity"
          type="button"
          :aria-label="`View ${model.name} details`"
          @click="selectModel"
        >
          <strong>{{ model.name }}</strong>
          <code>{{ model.model_id }}</code>
        </button>
        <UiTooltip
          v-if="showVersionBadge"
          as="button"
          type="button"
          class="version-badge"
          :content="
            model.version === undefined
              ? 'Provider did not publish a separate version for this record'
              : `Provider model version ${model.version}`
          "
          :aria-label="
            model.version === undefined
              ? 'Provider model record without a separate version'
              : `Provider model version ${model.version}`
          "
        >
          {{ model.version === undefined ? "unversioned" : `@${model.version}` }}
        </UiTooltip>
      </div>
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
    <td class="tasks-col">
      <span class="task-list">
        <span v-if="model.tasks.length === 0">—</span>
        <template v-for="task in model.tasks" :key="task">
          <UiTooltip
            class="task-filter-button"
            as="button"
            type="button"
            :aria-label="`Filter by task ${formatModelTask(task)}`"
            :content="formatModelTask(task)"
            @click="emit('filterTask', task)"
          >
            {{ formatTableTask(task) }}
          </UiTooltip>
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
    <td class="context-col numeric">{{ formatTokenCount(model.context_tokens) }}</td>
    <template v-if="hasRepresentativeRate">
      <ModelPriceCell class="input-col" :price="model.pricing.input" />
      <ModelPriceCell class="cached-col" :price="model.pricing.cache" />
      <ModelPriceCell class="output-col" :price="model.pricing.output" />
    </template>
    <td v-else-if="pricingStatus" class="price-status-cell" colspan="3">
      <span class="price-status-band">
        <UiTooltip
          as="button"
          type="button"
          class="table-status-trigger"
          :content="pricingStatus.description"
          :aria-label="`View ${model.name} pricing details. ${pricingStatus.description}`"
          @click="emit('selectPricing', model)"
        >
          {{ pricingStatus.label }}
        </UiTooltip>
      </span>
    </td>
    <td v-else class="price-status-cell" colspan="3">
      <span class="price-status-band">—</span>
    </td>
    <td class="released-col numeric">{{ model.release_date ?? "—" }}</td>
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
