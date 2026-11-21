<script setup lang="ts" vapor>
import { computed } from "vue";
import type { CapabilityRow } from "../catalog/capability-presentation.ts";
import type { WebsiteModelDetail } from "../catalog/website-schema.ts";
import CapabilityValues from "./CapabilityValues.vue";
import UiIcon from "./UiIcon.vue";
import UiTooltip from "./UiTooltip.vue";

const props = defineProps<{
  modalities: WebsiteModelDetail["modalities"];
  rows: readonly CapabilityRow[];
}>();

const hasValues = (row: CapabilityRow) =>
  row.values !== undefined || row.byEndpoint.size > 0 || row.unplaced.length > 0;
const supported = computed(() => props.rows.filter((row) => !hasValues(row)));
const detailed = computed(() => props.rows.filter(hasValues));
</script>

<template>
  <div class="modality-flow">
    <div>
      <small>Input</small>
      <ul class="tag-list" role="list">
        <li v-for="value in modalities.input" :key="value" class="tag">{{ value }}</li>
        <li v-if="!modalities.input.length" class="tag-empty">Unknown</li>
      </ul>
    </div>
    <UiIcon name="arrow-right" aria-hidden="true" />
    <div>
      <small>Output</small>
      <ul class="tag-list" role="list">
        <li v-for="value in modalities.output" :key="value" class="tag">{{ value }}</li>
        <li v-if="!modalities.output.length" class="tag-empty">Unknown</li>
      </ul>
    </div>
  </div>

  <template v-if="rows.length">
    <ul v-if="supported.length" class="tag-list capability-tags" role="list" aria-label="Supported">
      <li v-for="row in supported" :key="row.key" class="tag">{{ row.label }}</li>
    </ul>
    <dl v-if="detailed.length" class="capability-details">
      <div v-for="row in detailed" :key="row.key">
        <dt>
          {{ row.label }}
          <UiTooltip
            v-if="row.conflict"
            as="button"
            type="button"
            class="conflict-mark"
            aria-label="Sources disagree"
            content="Sources disagree for the same API"
            >!</UiTooltip
          >
        </dt>
        <dd>
          <CapabilityValues v-if="row.values" :values="row.values" />
          <span v-else-if="row.byEndpoint.size" class="varies">Varies by endpoint</span>
          <dl v-if="row.unplaced.length" class="variants">
            <div v-for="(variant, index) in row.unplaced" :key="index">
              <dt v-if="variant.label">{{ variant.label }}</dt>
              <dd><CapabilityValues :values="variant.values" /></dd>
            </div>
          </dl>
        </dd>
      </div>
    </dl>
  </template>
  <p v-else class="unknown-note">No capability information published.</p>
</template>

<style scoped>
.modality-flow {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  gap: var(--space-2);
}
.modality-flow > div {
  display: grid;
  min-width: 0;
  align-content: start;
  gap: var(--space-1-5);
  padding: var(--space-2) var(--space-2-5);
  border: var(--stroke-hairline) solid var(--color-border-subtle);
  border-radius: var(--list-surface-radius);
  background: var(--color-surface-subtle);
}
.modality-flow small {
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
}
.modality-flow > .ui-icon {
  width: var(--icon-size-lg);
  height: var(--icon-size-lg);
  align-self: center;
  color: var(--color-text-muted);
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}
.tag {
  display: inline-flex;
  min-height: var(--tag-height);
  align-items: center;
  padding-inline: var(--tag-padding-inline);
  border-radius: var(--tag-radius);
  color: var(--tag-text);
  background: var(--tag-background);
  font-size: var(--tag-font-size);
  font-weight: var(--tag-font-weight);
  line-height: var(--line-height-none);
}
.tag-empty {
  color: var(--color-text-muted);
  font-size: var(--font-size-body);
}
.capability-tags {
  margin-block-start: var(--space-3);
}
.capability-tags .tag {
  color: var(--color-text-primary);
}

.capability-details {
  margin: var(--space-3) 0 0;
  border: var(--stroke-hairline) solid var(--color-border-subtle);
  border-radius: var(--list-surface-radius);
  overflow-wrap: anywhere;
}
.capability-details > div {
  display: grid;
  min-height: var(--target-size-minimum);
  grid-template-columns: minmax(120px, 0.45fr) minmax(0, 1fr);
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-2) var(--space-2-5);
}
.capability-details > div + div {
  border-block-start: var(--stroke-hairline) solid var(--color-border-subtle);
}
.capability-details > div > dt {
  display: flex;
  align-items: center;
  gap: var(--space-1-5);
  color: var(--color-text-secondary);
  font-size: var(--font-size-meta);
}
.capability-details > div > dd {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1-5) var(--space-3);
  margin: 0;
}
.varies {
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
}
.variants {
  display: grid;
  gap: var(--space-1);
  margin: 0;
}
.variants > div {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
.variants dt {
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
}
.variants dd {
  margin: 0;
}
.conflict-mark {
  display: inline-grid;
  width: var(--icon-size-sm);
  height: var(--icon-size-sm);
  place-items: center;
  border-radius: var(--radius-full);
  color: var(--color-surface);
  background: var(--color-status-warning);
  font-size: var(--font-size-meta);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-none);
}

@media (width <= 580px) {
  .capability-details > div {
    grid-template-columns: 1fr;
    gap: var(--space-1);
  }
}
</style>
