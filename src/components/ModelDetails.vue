<script setup lang="ts" vapor>
import { computed, nextTick, useTemplateRef, watch } from "vue";
import {
  formatPrice,
  formatRateUnit,
  formatSnakeCase,
  formatTokenCount,
  modelTypeList,
} from "../catalog/presentation.ts";
import type { ProviderModel, SourceRecord } from "../catalog/schema.ts";

const props = defineProps<{
  model: ProviderModel | undefined;
  providerName: string;
  sources: SourceRecord[];
}>();

const emit = defineEmits<{
  close: [];
}>();

const dialog = useTemplateRef<HTMLDialogElement>("dialog");
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
    @close="requestClose"
    @click="closeFromBackdrop"
  >
    <article v-if="model" class="details-panel">
      <header class="details-header">
        <div>
          <p class="eyebrow">{{ providerName }}</p>
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
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="m5 5 10 10M15 5 5 15" />
          </svg>
        </button>
      </header>

      <div class="details-scroll">
        <div class="status-line">
          <span class="status-badge" :data-status="model.status">{{ model.status }}</span>
          <span>{{ formatSnakeCase(model.scope) }}</span>
        </div>

        <p v-if="model.description" class="details-description">{{ model.description }}</p>

        <section class="detail-section" aria-labelledby="overview-heading">
          <h3 id="overview-heading">Overview</h3>
          <dl class="detail-grid">
            <div>
              <dt>Operations</dt>
              <dd>{{ modelTypeList(model) }}</dd>
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
            <svg viewBox="0 0 28 12" aria-hidden="true">
              <path d="M1 6h24M21 2l4 4-4 4" />
            </svg>
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
            <li v-for="endpoint in model.api_endpoints" :key="`${endpoint.name}:${endpoint.path}`">
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
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M6 3h7v7M13 3 4 12" />
                </svg>
              </a>
            </li>
          </ul>
        </section>
      </div>
    </article>
  </dialog>
</template>
