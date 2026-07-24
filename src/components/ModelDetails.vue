<script setup lang="ts" vapor>
import { computed, nextTick, useTemplateRef, watch } from "vue";
import {
  formatPrice,
  formatRateUnit,
  formatSnakeCase,
  formatTokenCount,
  modelOperationList,
  primaryStatus,
} from "../catalog/presentation.ts";
import type { ProviderModel, SourceRecord } from "../catalog/schema.ts";
import { useOverlayScrollbars } from "../composables/useOverlayScrollbars.ts";
import ProviderIcon from "./ProviderIcon.vue";
import UiIcon from "./UiIcon.vue";

const props = defineProps<{
  model: ProviderModel | undefined;
  providerName: string;
  sources: SourceRecord[];
}>();

const emit = defineEmits<{
  close: [];
}>();

const dialog = useTemplateRef<HTMLDialogElement>("dialog");
const scrollHost = useTemplateRef<HTMLDivElement>("scrollHost");
const scrollViewport = useTemplateRef<HTMLDivElement>("scrollViewport");
const updateScrollbars = useOverlayScrollbars(() => ({
  target: scrollHost.value,
  viewport: scrollViewport.value,
}));
const modelSources = computed(() => {
  const ids = new Set(props.model?.source_refs ?? []);
  return props.sources.filter((source) => ids.has(source.id));
});
const positiveCapabilities = computed(() => {
  const model = props.model;
  if (model === undefined) return [];
  const labels: ReadonlyArray<[keyof ProviderModel["capabilities"], string]> = [
    ["reasoning", "Reasoning"],
    ["tool_call", "Tool calling"],
    ["structured_output", "Structured output"],
    ["streaming", "Streaming"],
    ["batch", "Batch"],
    ["prompt_cache", "Prompt cache"],
    ["fine_tuning", "Fine-tuning"],
    ["citations", "Citations"],
    ["code_execution", "Code execution"],
    ["context_management", "Context management"],
    ["effort_control", "Effort control"],
    ["computer_use", "Computer use"],
  ];
  return labels.filter(([key]) => model.capabilities[key] === true).map(([, label]) => label);
});

watch(
  () => props.model,
  async (model) => {
    await nextTick();
    const element = dialog.value;
    if (element === null) return;
    if (model !== undefined && !element.open) element.showModal();
    if (model === undefined && element.open) element.close();
    updateScrollbars();
  },
  { immediate: true },
);

function requestClose(): void {
  emit("close");
}

function closeFromBackdrop(event: MouseEvent): void {
  if (event.target === dialog.value) requestClose();
}

function conditions(rate: ProviderModel["pricing"][number]): string {
  const values = Object.entries(rate.conditions);
  if (values.length === 0) return "Standard conditions";
  return values.map(([key, value]) => `${formatSnakeCase(key)}: ${String(value)}`).join(" · ");
}
</script>

<template>
  <dialog
    ref="dialog"
    class="details-dialog"
    aria-labelledby="details-title"
    @cancel.prevent="requestClose"
    @click="closeFromBackdrop"
  >
    <article v-if="model" class="details-panel">
      <header class="details-header">
        <div>
          <p class="eyebrow">
            <ProviderIcon :provider-id="model.provider_id" :provider-name="providerName" />
            {{ providerName }}
          </p>
          <h2 id="details-title">{{ model.name }}</h2>
          <code
            >{{ model.model_id }}<span v-if="model.version"> · {{ model.version }}</span></code
          >
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
          <div class="status-line">
            <span class="status-badge" :data-status="primaryStatus(model)">
              {{ primaryStatus(model) }}
            </span>
            <span>{{ formatSnakeCase(model.scope) }}</span>
          </div>

          <p v-if="model.description" class="details-description">{{ model.description }}</p>

          <section class="detail-section" aria-labelledby="overview-heading">
            <h3 id="overview-heading">Overview</h3>
            <dl class="detail-grid">
              <div>
                <dt>Operations</dt>
                <dd>{{ modelOperationList(model) }}</dd>
              </div>
              <div>
                <dt>Lifecycle</dt>
                <dd>{{ model.status }}</dd>
              </div>
              <div>
                <dt>Release stage</dt>
                <dd>{{ model.release_stage }}</dd>
              </div>
              <div>
                <dt>Context window</dt>
                <dd>{{ formatTokenCount(model.limits.context_tokens) }}</dd>
              </div>
              <div>
                <dt>Maximum output</dt>
                <dd>{{ formatTokenCount(model.limits.max_output_tokens) }}</dd>
              </div>
              <div>
                <dt>Released</dt>
                <dd>{{ model.release_date ?? "Unknown" }}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{{ model.updated_date ?? "Unknown" }}</dd>
              </div>
              <div>
                <dt>Availability</dt>
                <dd>
                  {{
                    model.availability === undefined
                      ? "Not published"
                      : `${model.availability.length} observed deployment${model.availability.length === 1 ? "" : "s"}`
                  }}
                </dd>
              </div>
            </dl>
          </section>

          <section class="detail-section" aria-labelledby="modalities-heading">
            <h3 id="modalities-heading">Modalities & capabilities</h3>
            <div class="modality-flow">
              <span>{{ model.modalities.input.join(", ") || "Unknown input" }}</span>
              <UiIcon name="arrow-right" />
              <span>{{ model.modalities.output.join(", ") || "Unknown output" }}</span>
            </div>
            <ul v-if="positiveCapabilities.length > 0" class="capability-list">
              <li v-for="capability in positiveCapabilities" :key="capability">{{ capability }}</li>
            </ul>
            <p v-else class="unknown-note">
              No positive capability flags were published by the source.
            </p>
          </section>

          <section
            v-if="model.api_endpoints?.length"
            class="detail-section"
            aria-labelledby="routes-heading"
          >
            <h3 id="routes-heading">Published endpoints</h3>
            <ul class="endpoint-list">
              <li
                v-for="endpoint in model.api_endpoints"
                :key="`${endpoint.name}:${endpoint.path}`"
              >
                <span>{{ endpoint.name }}</span>
                <code>{{ endpoint.path }}</code>
              </li>
            </ul>
          </section>

          <section class="detail-section" aria-labelledby="pricing-heading">
            <h3 id="pricing-heading">Pricing</h3>
            <div v-if="model.pricing.length > 0" class="rate-list">
              <div
                v-for="rate in model.pricing"
                :key="`${rate.meter}:${rate.currency}:${rate.unit}:${JSON.stringify(rate.conditions)}`"
                class="rate-row"
              >
                <div>
                  <span>{{ formatSnakeCase(rate.meter) }}</span>
                  <small>{{ conditions(rate) }}</small>
                </div>
                <strong class="numeric">
                  {{ formatPrice(rate) }}
                  <small>{{ formatRateUnit(rate) }}</small>
                </strong>
              </div>
            </div>
            <p v-else class="unknown-note">
              {{ formatSnakeCase(model.pricing_status) }}
            </p>
          </section>

          <section class="detail-section" aria-labelledby="sources-heading">
            <h3 id="sources-heading">Evidence</h3>
            <ul class="evidence-list">
              <li v-for="source in modelSources" :key="source.id">
                <a :href="source.url" target="_blank" rel="noreferrer">
                  <span>
                    <strong>{{ source.id }}</strong>
                    <small
                      >{{ source.source.join(" + ") }} ·
                      {{ formatSnakeCase(source.stability) }}</small
                    >
                  </span>
                  <UiIcon name="external-link" />
                </a>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </article>
  </dialog>
</template>
