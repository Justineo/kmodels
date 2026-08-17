<script setup lang="ts" vapor>
import { computed } from "vue";
import type { ModelGroup } from "../catalog/model-groups.ts";
import {
  formatModelTask,
  formatSentenceCase,
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
type Shared<T> = { kind: "shared"; value: T } | { kind: "varies" };

const props = defineProps<{
  group: ModelGroup<WebsiteModel>;
  providerName: string;
  rowIndex: number;
  alternate: boolean;
  expanded: boolean;
}>();

const emit = defineEmits<{
  toggle: [];
  filterProvider: [providerId: string];
  filterTask: [task: ModelTask];
  filterLifecycle: [lifecycle: ModelLifecycle];
  filterReleaseStage: [releaseStage: ModelReleaseStage];
}>();

function equivalent(left: unknown, right: unknown): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

function sharedBy<T>(project: (model: WebsiteModel) => T): Shared<T> {
  const first = props.group.models[0];
  if (first === undefined) return { kind: "varies" };
  const value = project(first);
  return props.group.models.every((model) => equivalent(project(model), value))
    ? { kind: "shared", value }
    : { kind: "varies" };
}

const firstModel = computed(() => {
  const model = props.group.models[0];
  if (model === undefined) throw new Error("Model group is empty");
  return model;
});
const sharedName = computed(() => sharedBy((model) => model.name));
const sharedTasks = computed(() => sharedBy((model) => model.tasks));
const sharedStatus = computed(() => sharedBy((model) => primaryStatus(model)));
const variedStatusDescription = computed(
  () =>
    `Status varies by version: ${[
      ...new Set(props.group.models.map((model) => formatSentenceCase(primaryStatus(model)))),
    ].join(", ")}.`,
);
const contextLabel = computed(() => {
  const context = sharedBy((model) => model.context_tokens);
  return context.kind === "shared" ? formatTokenCount(context.value) : "Varies";
});
const releasedLabel = computed(() => {
  const released = sharedBy((model) => model.release_date);
  return released.kind === "shared" ? (released.value ?? "—") : "Varies";
});
const sharedPricing = computed(() => {
  const pricing = sharedBy((model) => model.pricing);
  return pricing.kind === "shared" ? pricing.value : undefined;
});
const hasRepresentativeRate = computed(
  () =>
    sharedPricing.value?.input !== undefined ||
    sharedPricing.value?.cache !== undefined ||
    sharedPricing.value?.output !== undefined,
);
const pricingStatus = computed(() => sharedPricing.value?.status);
const toggleLabel = computed(
  () =>
    `${props.expanded ? "Collapse" : "Expand"} ${props.group.model_id}, ${props.group.models.length} versions`,
);

function filterStatus(): void {
  const model = firstModel.value;
  if (model.status === "active" && model.release_stage !== "unknown") {
    emit("filterReleaseStage", model.release_stage);
    return;
  }
  emit("filterLifecycle", model.status);
}
</script>

<template>
  <tr
    class="model-row model-group-row"
    :aria-rowindex="rowIndex"
    :data-alternate="alternate ? 'true' : undefined"
    :data-status="sharedStatus.kind === 'shared' ? sharedStatus.value : 'unknown'"
  >
    <td class="model-col">
      <div class="model-cell">
        <button
          class="model-identity"
          type="button"
          :aria-expanded="expanded"
          :aria-label="toggleLabel"
          @click="emit('toggle')"
        >
          <strong>
            {{ sharedName.kind === "shared" ? sharedName.value : group.model_id }}
          </strong>
          <code>{{ group.model_id }}</code>
        </button>
        <span class="version-badge version-count-badge"> {{ group.models.length }} versions </span>
      </div>
    </td>
    <td class="provider-col">
      <button
        class="provider-identity"
        type="button"
        :aria-label="`Filter by provider ${providerName}`"
        @click="emit('filterProvider', group.provider_id)"
      >
        <ProviderIcon :provider-id="group.provider_id" :provider-name="providerName" />
        <span>{{ providerName }}</span>
      </button>
    </td>
    <td class="tasks-col">
      <span v-if="sharedTasks.kind === 'varies'" class="group-varies">Varies</span>
      <span v-else class="task-list">
        <span v-if="sharedTasks.value.length === 0">—</span>
        <template v-for="task in sharedTasks.value" :key="task">
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
      <UiTooltip
        v-if="sharedStatus.kind === 'varies'"
        class="tooltip-text-trigger table-status-trigger"
        tabindex="0"
        :content="variedStatusDescription"
        :aria-label="variedStatusDescription"
      >
        Varies
      </UiTooltip>
      <button
        v-else
        class="row-status"
        type="button"
        :aria-label="`Filter by status ${sharedStatus.value}`"
        @click="filterStatus"
      >
        <span aria-hidden="true"></span>
        {{ sharedStatus.value }}
      </button>
    </td>
    <td class="context-col numeric">{{ contextLabel }}</td>
    <template v-if="hasRepresentativeRate">
      <ModelPriceCell class="input-col" :price="sharedPricing?.input" />
      <ModelPriceCell class="cached-col" :price="sharedPricing?.cache" />
      <ModelPriceCell class="output-col" :price="sharedPricing?.output" />
    </template>
    <td v-else-if="sharedPricing === undefined" class="price-status-cell" colspan="3">
      <span class="price-status-band">
        <span class="group-varies">Varies</span>
      </span>
    </td>
    <td v-else-if="pricingStatus" class="price-status-cell" colspan="3">
      <span class="price-status-band">
        <UiTooltip
          class="tooltip-text-trigger table-status-trigger"
          tabindex="0"
          :content="pricingStatus.description"
          :aria-label="`Pricing: ${pricingStatus.label}. ${pricingStatus.description}`"
        >
          {{ pricingStatus.label }}
        </UiTooltip>
      </span>
    </td>
    <td v-else class="price-status-cell" colspan="3">
      <span class="price-status-band">—</span>
    </td>
    <td class="released-col numeric">{{ releasedLabel }}</td>
    <td class="disclosure-col">
      <button
        class="disclosure-button group-disclosure"
        type="button"
        :aria-expanded="expanded"
        :aria-label="toggleLabel"
        @click="emit('toggle')"
      >
        <UiIcon name="chevron-right" />
      </button>
    </td>
  </tr>
</template>
