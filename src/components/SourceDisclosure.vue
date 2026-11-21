<script setup lang="ts" vapor>
import { computed, ref } from "vue";
import type { ModelClaimSource } from "../catalog/model-claim-details.ts";
import { formatLocalDateTime } from "../catalog/presentation.ts";
import { useSourceIcons } from "../composables/useSourceIcons.ts";
import UiIcon from "./UiIcon.vue";

const props = defineProps<{
  documents: readonly (Pick<ModelClaimSource, "document_url"> &
    Partial<Pick<ModelClaimSource, "locator" | "observed_at">>)[];
}>();

const icons = useSourceIcons();
const failedIcons = ref(new Set<string>());
const sources = computed(() => {
  const byDocument = new Map<
    string,
    { href: string; url: URL; locators: Set<string>; observedAt: string }
  >();
  for (const { document_url, locator, observed_at } of props.documents) {
    const url = URL.parse(document_url);
    if (
      url === null ||
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password
    )
      continue;
    const source = byDocument.get(url.href) ?? {
      href: document_url,
      url,
      locators: new Set<string>(),
      observedAt: "",
    };
    byDocument.set(url.href, source);
    if (locator) source.locators.add(locator);
    if (observed_at && observed_at > source.observedAt) source.observedAt = observed_at;
  }
  const documents = [...byDocument.values()];
  return documents.map(({ href, url, locators, observedAt }) => ({
    href,
    url,
    icon: failedIcons.value.has(url.origin) ? undefined : icons.value.get(url.origin),
    label: documents.some(({ url: other }) => other !== url && other.host === url.host)
      ? `${url.host}${url.pathname}${url.search}${url.hash}`
      : url.host,
    locators: [...locators].join(" · "),
    checked: observedAt ? `Checked ${formatLocalDateTime(observedAt)}` : "",
  }));
});
</script>

<template>
  <details v-if="sources.length" class="source-disclosure">
    <summary>
      Sources · {{ sources.length }}
      <UiIcon name="chevron-right" />
    </summary>
    <ul class="source-documents" role="list">
      <li v-for="{ href, url, icon, label, locators, checked } in sources" :key="href">
        <a :href="href" target="_blank" rel="noopener noreferrer">
          <span class="source-mark" aria-hidden="true">
            <img
              v-if="icon"
              :src="icon"
              alt=""
              loading="lazy"
              @error="failedIcons.add(url.origin)"
            />
            <span v-else>{{ url.hostname.charAt(0).toUpperCase() }}</span>
          </span>
          <span class="source-label">{{ label }}</span>
          <UiIcon name="external-link" />
        </a>
        <small v-if="locators">{{ locators }}</small>
        <small v-if="checked">{{ checked }}</small>
      </li>
    </ul>
  </details>
</template>

<style scoped>
.source-disclosure {
  min-width: 0;
  max-width: 100%;
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
}
.source-disclosure > summary {
  display: flex;
  width: fit-content;
  min-height: var(--target-size-minimum);
  align-items: center;
  gap: var(--space-1);
  list-style: none;
  cursor: pointer;
  white-space: nowrap;
}
.source-disclosure > summary::-webkit-details-marker {
  display: none;
}
.source-disclosure[open] > summary .ui-icon {
  transform: rotate(90deg);
}
.source-documents {
  display: grid;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border: var(--stroke-hairline) solid var(--color-border-subtle);
  border-radius: var(--list-surface-radius);
  list-style: none;
  overflow-wrap: anywhere;
}
.source-documents a {
  display: flex;
  width: fit-content;
  align-items: center;
  gap: var(--space-1);
  color: var(--color-text-primary);
  text-decoration: underline;
  text-decoration-color: var(--color-link-underline);
}
.source-documents small {
  display: block;
  padding-inline-start: calc(var(--icon-size-xs) + var(--space-1));
  font-size: inherit;
}
.source-label {
  min-width: 0;
}
.source-mark,
.source-disclosure .ui-icon {
  width: var(--icon-size-xs);
  height: var(--icon-size-xs);
  flex: none;
}
.source-mark {
  display: inline-grid;
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
</style>
