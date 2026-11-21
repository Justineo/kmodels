<script setup lang="ts" vapor>
import { computed, ref } from "vue";
import type { ModelClaimSource } from "../catalog/model-claim-details.ts";
import { formatLocalDateTime } from "../catalog/presentation.ts";
import { useSourceIcons } from "../composables/useSourceIcons.ts";
import UiIcon from "./UiIcon.vue";
import UiTooltip from "./UiTooltip.vue";

const props = defineProps<{
  documents: readonly ModelClaimSource[];
  /** Site icons only; the host joins the tooltip. */
  compact?: boolean;
}>();
const icons = useSourceIcons();
const failedIcons = ref(new Set<string>());

/**
 * One link per cited document, or per site when compact; locators and the latest check move into
 * the tooltip.
 */
const sources = computed(() => {
  const byDocument = new Map<
    string,
    { href: string; url: URL; locators: string[]; observedAt: string }
  >();
  for (const { document_url, locator, observed_at } of props.documents) {
    const url = new URL(document_url);
    const key = props.compact ? url.origin : document_url;
    const source = byDocument.get(key) ?? {
      href: document_url,
      url,
      locators: [],
      observedAt: observed_at,
    };
    byDocument.set(key, source);
    if (!source.locators.includes(locator)) source.locators.push(locator);
    if (observed_at > source.observedAt) source.observedAt = observed_at;
  }
  const hosts = [...byDocument.values()].map(({ url }) => url.host);
  return [...byDocument.values()].map((source) => ({
    ...source,
    icon: failedIcons.value.has(source.url.origin) ? undefined : icons.value.get(source.url.origin),
    label:
      hosts.filter((host) => host === source.url.host).length > 1
        ? `${source.url.host}${source.url.pathname}`
        : source.url.host,
    tooltip: `${props.compact ? source.url.host + " · " : ""}${source.locators.join("; ")} · Checked ${formatLocalDateTime(source.observedAt)}`,
  }));
});
</script>

<template>
  <ul class="claim-sources" :data-compact="compact || undefined" role="list" aria-label="Sources">
    <li v-for="{ href, url, label, tooltip, icon } in sources" :key="href">
      <UiTooltip
        as="a"
        :href="href"
        target="_blank"
        rel="noopener noreferrer"
        :aria-label="`${label}: ${tooltip}`"
        :content="tooltip"
      >
        <span class="source-mark" aria-hidden="true">
          <img v-if="icon" :src="icon" alt="" loading="lazy" @error="failedIcons.add(url.origin)" />
          <span v-else>{{ url.hostname.charAt(0).toUpperCase() }}</span>
        </span>
        <template v-if="!compact">
          <span class="source-label">{{ label }}</span>
          <UiIcon name="external-link" />
        </template>
      </UiTooltip>
    </li>
  </ul>
</template>

<style scoped>
.claim-sources {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  margin: 0;
  padding: 0;
  font-size: var(--font-size-meta);
  line-height: var(--line-height-body);
  list-style: none;
}
.claim-sources li {
  min-width: 0;
}
.claim-sources[data-compact] {
  gap: var(--space-1);
  margin-inline-start: auto;
}

.claim-sources :deep(a) {
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  gap: var(--space-1);
  color: var(--color-text-muted);
}
.claim-sources :deep(a:hover) .source-label {
  color: var(--color-accent);
  text-decoration: underline;
  text-decoration-color: var(--color-link-underline);
  text-underline-offset: 2px;
}
.source-mark {
  display: inline-grid;
  width: var(--icon-size-xs);
  height: var(--icon-size-xs);
  flex: none;
  place-items: center;
  overflow: hidden;
  border-radius: var(--radius-xs);
  font-weight: var(--font-weight-semibold);
}
.source-mark img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.source-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.claim-sources .ui-icon {
  width: var(--icon-size-xs);
  height: var(--icon-size-xs);
  flex: none;
}
</style>
