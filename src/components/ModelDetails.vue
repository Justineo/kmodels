<script setup lang="ts" vapor>
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from "vue";
import {
  formatSnakeCase,
  formatTokenCount,
  modelTaskList,
  primaryStatus,
} from "../catalog/presentation.ts";
import type { WebsiteModel, WebsiteModelDetail } from "../catalog/website-schema.ts";
import { useOverlayScrollbars } from "../composables/useOverlayScrollbars.ts";
import ProviderIcon from "./ProviderIcon.vue";
import PricingDetails from "./PricingDetails.vue";
import UiIcon from "./UiIcon.vue";

const props = defineProps<{
  model: WebsiteModel | undefined;
  providerName: string;
  detail: WebsiteModelDetail | undefined;
  loading: boolean;
  error: string | undefined;
  pricingTarget: string | undefined;
}>();

const emit = defineEmits<{
  close: [];
  navigate: [offset: -1 | 1];
  pricingTargetReached: [];
}>();

const dialog = useTemplateRef<HTMLDialogElement>("dialog");
const scrollHost = useTemplateRef<HTMLDivElement>("scrollHost");
const scrollViewport = useTemplateRef<HTMLDivElement>("scrollViewport");
const closing = ref(false);
const updateScrollbars = useOverlayScrollbars(() => ({
  target: scrollHost.value,
  viewport: scrollViewport.value,
}));
const positiveCapabilities = computed(() => {
  const detail = props.detail;
  if (detail === undefined) return [];
  const labels: ReadonlyArray<[keyof WebsiteModelDetail["capabilities"], string]> = [
    ["reasoning", "Reasoning"],
    ["tool_call", "Tool calling"],
    ["structured_output", "Structured output"],
    ["prompt_cache", "Prompt cache"],
    ["fine_tuning", "Fine-tuning"],
    ["citations", "Citations"],
    ["code_execution", "Code execution"],
    ["context_management", "Context management"],
    ["effort_control", "Effort control"],
    ["computer_use", "Computer use"],
  ];
  return labels.filter(([key]) => detail.capabilities[key] === true).map(([, label]) => label);
});
const modelIdentifier = computed(() => {
  const model = props.model;
  if (model === undefined) return undefined;
  if (model.name !== model.model_id)
    return `${model.model_id}${model.version === undefined ? "" : ` · ${model.version}`}`;
  return model.version === undefined ? undefined : `Version ${model.version}`;
});
const deliveryModes = computed(
  () => props.detail?.delivery_modes?.map(formatSnakeCase).join(", ") || "Not published",
);
const availability = computed(() => {
  const count = props.detail?.availability_count;
  return count === undefined
    ? "Not published"
    : `${count} observed deployment${count === 1 ? "" : "s"}`;
});
const apiEndpoints = computed(() => props.detail?.api_endpoints ?? []);

watch(
  () => props.model,
  async (model) => {
    if (model !== undefined) closing.value = false;
    await nextTick();
    const element = dialog.value;
    if (element === null) return;
    if (model !== undefined) {
      if (!element.open) element.show();
      scrollViewport.value?.scrollTo({ top: 0 });
    }
    if (model === undefined) {
      if (element.open) element.close();
      closing.value = false;
    }
    updateScrollbars();
  },
  { immediate: true },
);

watch(
  [() => props.pricingTarget, () => props.loading, () => props.model?.uid],
  async ([target, loading, modelUid]) => {
    if (target === undefined || target !== modelUid || loading) return;
    await nextTick();
    if (props.pricingTarget !== target) return;
    scrollViewport.value
      ?.querySelector<HTMLElement>(".pricing-section")
      ?.scrollIntoView({ block: "start" });
    emit("pricingTargetReached");
  },
  { flush: "post" },
);

function requestClose(): void {
  if (props.model === undefined || closing.value) return;
  closing.value = true;
}

function finishClose(): void {
  if (!closing.value) return;
  emit("close");
}

const arrowKeyControlSelector = [
  "input",
  "textarea",
  "select",
  '[contenteditable]:not([contenteditable="false"])',
  '[role="textbox"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[role="tree"]',
  '[role="grid"]',
].join(",");

function handleKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented || props.model === undefined || closing.value) return;
  const target = event.target;

  if (event.key === "Escape") {
    if (
      target instanceof Element &&
      (target.matches("select") || target.closest(":popover-open") !== null)
    ) {
      return;
    }
    event.preventDefault();
    requestClose();
    return;
  }

  if (
    (event.key !== "ArrowUp" && event.key !== "ArrowDown") ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.isComposing ||
    (target instanceof Element &&
      (target.closest(arrowKeyControlSelector) !== null ||
        target.closest(":popover-open") !== null))
  ) {
    return;
  }

  event.preventDefault();
  emit("navigate", event.key === "ArrowUp" ? -1 : 1);
}

onMounted(() => document.addEventListener("keydown", handleKeydown));
onUnmounted(() => document.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <dialog
    ref="dialog"
    class="details-dialog"
    :data-closing="closing || undefined"
    aria-labelledby="details-title"
    aria-keyshortcuts="ArrowUp ArrowDown"
    @cancel.prevent="requestClose"
  >
    <article v-if="model" class="details-panel" @animationend.self="finishClose">
      <header class="details-header">
        <div>
          <p class="eyebrow">
            <ProviderIcon :provider-id="model.provider_id" :provider-name="providerName" />
            {{ providerName }}
          </p>
          <h2 id="details-title">{{ model.name }}</h2>
          <code v-if="modelIdentifier">{{ modelIdentifier }}</code>
        </div>
        <button
          class="icon-button"
          type="button"
          aria-label="Close model details"
          @click="requestClose"
        >
          <UiIcon name="x" />
        </button>
      </header>

      <div ref="scrollHost" class="details-scroll-host" data-overlayscrollbars-initialize>
        <div ref="scrollViewport" class="details-scroll">
          <div class="details-content">
            <div class="status-line">
              <span class="status-badge" :data-status="primaryStatus(model)">
                {{ primaryStatus(model) }}
              </span>
              <span>{{ detail ? formatSnakeCase(detail.scope) : "Loading details…" }}</span>
            </div>

            <p v-if="detail?.description" class="details-description">{{ detail.description }}</p>
            <p v-if="error" class="unknown-note" role="alert">{{ error }}</p>

            <section class="detail-section" aria-labelledby="overview-heading">
              <h3 id="overview-heading">Overview</h3>
              <dl class="detail-grid">
                <div>
                  <dt>Tasks</dt>
                  <dd>{{ modelTaskList(model) }}</dd>
                </div>
                <div>
                  <dt>Delivery modes</dt>
                  <dd>{{ deliveryModes }}</dd>
                </div>
                <div>
                  <dt>Context window</dt>
                  <dd>{{ formatTokenCount(model.context_tokens) }}</dd>
                </div>
                <div>
                  <dt>Maximum output</dt>
                  <dd>{{ formatTokenCount(detail?.max_output_tokens) }}</dd>
                </div>
                <div>
                  <dt>Released</dt>
                  <dd>{{ model.release_date ?? "Unknown" }}</dd>
                </div>
                <div>
                  <dt>Updated</dt>
                  <dd>{{ detail?.updated_date ?? "Unknown" }}</dd>
                </div>
                <div>
                  <dt>Availability</dt>
                  <dd>{{ availability }}</dd>
                </div>
              </dl>
            </section>

            <section v-if="detail" class="detail-section" aria-labelledby="modalities-heading">
              <h3 id="modalities-heading">Modalities & capabilities</h3>
              <div class="modality-flow">
                <span>{{ detail.modalities.input.join(", ") || "Unknown input" }}</span>
                <UiIcon name="arrow-right" />
                <span>{{ detail.modalities.output.join(", ") || "Unknown output" }}</span>
              </div>
              <ul v-if="positiveCapabilities.length > 0" class="capability-list">
                <li v-for="capability in positiveCapabilities" :key="capability">
                  {{ capability }}
                </li>
              </ul>
              <p v-else class="unknown-note">No supported capabilities published.</p>
            </section>

            <section
              v-if="apiEndpoints.length"
              class="detail-section"
              aria-labelledby="routes-heading"
            >
              <h3 id="routes-heading">Published endpoints</h3>
              <ul class="endpoint-list">
                <li v-for="endpoint in apiEndpoints" :key="`${endpoint.name}:${endpoint.path}`">
                  <span>{{ endpoint.name }}</span>
                  <code>{{ endpoint.path }}</code>
                </li>
              </ul>
            </section>

            <PricingDetails
              v-if="!error"
              :model="model"
              :detail="detail?.pricing"
              :loading="loading"
            />
          </div>
        </div>
      </div>
    </article>
  </dialog>
</template>
