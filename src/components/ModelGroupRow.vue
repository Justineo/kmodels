<script setup lang="ts" vapor>
import { computed } from "vue";
import type { ModelGroup } from "../catalog/model-groups.ts";
import {
  formatModelTask,
  formatSentenceCase,
  formatTableTask,
  formatTokenCount,
  modelTaskList,
  primaryStatus,
} from "../catalog/presentation.ts";
import type { WebsiteModel } from "../catalog/website-schema.ts";
import ModelGroupVariation from "./ModelGroupVariation.vue";
import ModelPriceCell from "./ModelPriceCell.vue";
import ProviderIcon from "./ProviderIcon.vue";
import UiIcon from "./UiIcon.vue";
import UiTooltip from "./UiTooltip.vue";

type ModelTask = WebsiteModel["tasks"][number];
type ModelLifecycle = WebsiteModel["status"];
type ModelReleaseStage = WebsiteModel["release_stage"];
type PricingCell = WebsiteModel["pricing"]["input"];
type PricingStatus = WebsiteModel["pricing"]["status"];
type Shared<T> = { kind: "shared"; value: T } | { kind: "varies" };

const priceColumnDefinitions = [
  ["input", "input-col", "Input price varies"],
  ["cache", "cached-col", "Cache price varies"],
  ["output", "output-col", "Output price varies"],
] as const;

const props = defineProps<{
  group: ModelGroup<WebsiteModel>;
  modelName: string;
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

function variationDescription<T>(
  label: string,
  project: (model: WebsiteModel) => T,
  format: (value: T) => string,
): string {
  const values = [...new Set(props.group.models.map((model) => format(project(model))))];
  return `${label} by version: ${values.join("; ")}.`;
}

function formatOptionalTokenCount(value: number | undefined): string {
  return value === undefined ? "Not published" : formatTokenCount(value);
}

function formatPrice(price: PricingCell): string {
  return price === undefined ? "Not published" : price.accessibleText;
}

function formatPricingStatus(status: PricingStatus): string {
  return status === undefined ? "Not published" : `${status.label} — ${status.description}`;
}

const firstModel = computed(() => {
  const model = props.group.models[0];
  if (model === undefined) throw new Error("Model group is empty");
  return model;
});
const sharedTasks = computed(() => sharedBy((model) => model.tasks));
const variedTasksDescription = computed(() =>
  variationDescription("Tasks vary", (model) => model, modelTaskList),
);
const sharedStatus = computed(() => sharedBy((model) => primaryStatus(model)));
const variedStatusDescription = computed(() =>
  variationDescription("Status varies", (model) => primaryStatus(model), formatSentenceCase),
);
const sharedContext = computed(() => sharedBy((model) => model.context_tokens));
const variedContextDescription = computed(() =>
  variationDescription("Context varies", (model) => model.context_tokens, formatOptionalTokenCount),
);
const sharedReleased = computed(() => sharedBy((model) => model.release_date));
const variedReleasedDescription = computed(() =>
  variationDescription(
    "Release date varies",
    (model) => model.release_date,
    (value) => value ?? "Not published",
  ),
);
const sharedPricingStatus = computed(() => sharedBy((model) => model.pricing.status));
const variedPricingStatusDescription = computed(() =>
  variationDescription(
    "Pricing status varies",
    (model) => model.pricing.status,
    formatPricingStatus,
  ),
);
const priceColumns = computed(() =>
  priceColumnDefinitions.map(([key, className, label]) => ({
    key,
    className,
    value: sharedBy((model) => model.pricing[key]),
    description: variationDescription(label, (model) => model.pricing[key], formatPrice),
  })),
);
const hasRepresentativeRate = computed(() =>
  props.group.models.some((model) =>
    priceColumnDefinitions.some(([key]) => model.pricing[key] !== undefined),
  ),
);
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
          <strong>{{ modelName }}</strong>
          <code>{{ group.model_id }}</code>
        </button>
        <button
          class="version-badge version-count-badge"
          type="button"
          :aria-expanded="expanded"
          :aria-label="toggleLabel"
          @click="emit('toggle')"
        >
          {{ group.models.length }} versions
        </button>
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
      <ModelGroupVariation
        v-if="sharedTasks.kind === 'varies'"
        :expanded
        :toggle-label
        :description="variedTasksDescription"
        @toggle="emit('toggle')"
      />
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
      <ModelGroupVariation
        v-if="sharedStatus.kind === 'varies'"
        :expanded
        :toggle-label
        :description="variedStatusDescription"
        @toggle="emit('toggle')"
      />
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
    <td class="context-col numeric">
      <template v-if="sharedContext.kind === 'shared'">
        {{ formatTokenCount(sharedContext.value) }}
      </template>
      <ModelGroupVariation
        v-else
        :expanded
        :toggle-label
        :description="variedContextDescription"
        @toggle="emit('toggle')"
      />
    </td>
    <template v-if="hasRepresentativeRate">
      <template v-for="column in priceColumns" :key="column.key">
        <ModelPriceCell
          v-if="column.value.kind === 'shared'"
          :class="column.className"
          :price="column.value.value"
        />
        <td v-else class="price-cell numeric" :class="column.className">
          <ModelGroupVariation
            :expanded
            :toggle-label
            :description="column.description"
            @toggle="emit('toggle')"
          />
        </td>
      </template>
    </template>
    <td v-else-if="sharedPricingStatus.kind === 'varies'" class="price-status-cell" colspan="3">
      <span class="price-status-band">
        <ModelGroupVariation
          :expanded
          :toggle-label
          :description="variedPricingStatusDescription"
          @toggle="emit('toggle')"
        />
      </span>
    </td>
    <td v-else-if="sharedPricingStatus.value" class="price-status-cell" colspan="3">
      <span class="price-status-band">
        <UiTooltip
          class="tooltip-text-trigger table-status-trigger"
          tabindex="0"
          :content="sharedPricingStatus.value.description"
          :aria-label="`Pricing: ${sharedPricingStatus.value.label}. ${sharedPricingStatus.value.description}`"
        >
          {{ sharedPricingStatus.value.label }}
        </UiTooltip>
      </span>
    </td>
    <td v-else class="price-status-cell" colspan="3">
      <span class="price-status-band">—</span>
    </td>
    <td class="released-col numeric">
      <template v-if="sharedReleased.kind === 'shared'">
        {{ sharedReleased.value ?? "—" }}
      </template>
      <ModelGroupVariation
        v-else
        :expanded
        :toggle-label
        :description="variedReleasedDescription"
        @toggle="emit('toggle')"
      />
    </td>
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
