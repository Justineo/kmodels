<script setup lang="ts" vapor>
import { computed, ref } from "vue";
import type { ModelDetailEvidence } from "../catalog/model-claim-details.ts";
import { formatLocalDateTime } from "../catalog/presentation.ts";
import UiIcon from "./UiIcon.vue";
import UiTooltip from "./UiTooltip.vue";

const props = defineProps<{ documents: ModelDetailEvidence[] }>();
const sources = computed(() =>
  props.documents.map((evidence) => ({ evidence, url: new URL(evidence.document_url) })),
);
const sites = computed(() => [
  ...new Map(sources.value.map(({ url }) => [url.origin, url])).values(),
]);
const failedIcons = ref(new Set<string>());
const sourceCount = computed(() => new Set(props.documents.map((e) => e.document_url)).size);
</script>

<template>
  <details class="claim-sources">
    <summary>
      <span class="source-stack" aria-hidden="true">
        <span v-for="site in sites" :key="site.origin" class="source-mark">
          <img
            v-if="site.protocol === 'https:' && !failedIcons.has(site.origin)"
            :src="`${site.origin}/favicon.ico`"
            alt=""
            loading="lazy"
            referrerpolicy="no-referrer"
            @error="failedIcons.add(site.origin)"
          />
          <span v-else>{{ site.hostname.charAt(0).toUpperCase() }}</span>
        </span>
      </span>
      <span>{{ sourceCount }} {{ sourceCount === 1 ? "source" : "sources" }}</span>
    </summary>
    <div class="detail-disclosure-body claim-evidence">
      <div v-for="({ evidence, url }, index) in sources" :key="index">
        <div class="evidence-source">
          <a :href="evidence.document_url" target="_blank" rel="noopener noreferrer">
            <small>{{ url.host }}</small>
            {{ evidence.locator }}
            <UiIcon name="external-link" />
          </a>
          <UiTooltip
            as="button"
            type="button"
            class="icon-button"
            aria-label="When this source was checked"
            :content="`Source checked ${formatLocalDateTime(evidence.observed_at)}`"
          >
            <time :datetime="evidence.observed_at"><UiIcon name="calendar-clock" /></time>
          </UiTooltip>
        </div>
        <dl class="availability-list">
          <div>
            <dt>Evidence</dt>
            <dd>{{ evidence.excerpt }}</dd>
          </div>
          <div>
            <dt>Document SHA-256</dt>
            <dd>
              <code>{{ evidence.content_hash }}</code>
            </dd>
          </div>
        </dl>
      </div>
    </div>
  </details>
</template>

<style scoped>
.claim-sources > summary {
  display: flex;
  width: fit-content;
  align-items: center;
  gap: var(--space-1-5);
  min-height: var(--control-height-default);
  padding-inline: var(--space-2);
  border-radius: var(--radius-full);
  color: var(--color-text-secondary);
  background: var(--color-surface-subtle);
  cursor: pointer;
  font-size: var(--font-size-meta);
  list-style: none;
}
.claim-sources > summary::-webkit-details-marker {
  display: none;
}
.claim-sources > summary:hover,
.claim-sources[open] > summary {
  background: var(--color-surface-hover);
}
.source-stack,
.source-mark {
  box-sizing: content-box;
  height: var(--icon-size-md);
  justify-content: center;
  display: inline-flex;
  align-items: center;
}
.source-mark img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.source-mark {
  width: var(--icon-size-md);
  flex: none;
  padding: var(--space-0-5);
  border-radius: var(--radius-full);
  background: var(--color-surface);
  overflow: hidden;
}
.source-mark + .source-mark {
  margin-inline-start: calc(-1 * var(--space-1));
}
.claim-evidence {
  display: grid;
  gap: var(--space-3);
  overflow-wrap: anywhere;
}
.claim-evidence .availability-list dd {
  font-family: inherit;
  white-space: pre-wrap;
}
.evidence-source {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
  font-size: var(--font-size-meta);
}
.evidence-source time {
  display: flex;
}
.evidence-source a {
  min-width: 0;
}
.evidence-source a small {
  display: block;
  color: var(--color-text-muted);
}
.evidence-source .ui-icon {
  width: var(--icon-size-xs);
  height: var(--icon-size-xs);
  vertical-align: middle;
}
.evidence-source :deep(.icon-button) {
  min-width: var(--control-height-default);
}
</style>
