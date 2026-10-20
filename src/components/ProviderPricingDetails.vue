<script setup lang="ts" vapor>
import { computed, ref, watch } from "vue";
import {
  loadWebsiteProviderPricingChunk,
  loadWebsiteProviderPricingOffer,
} from "../catalog/website-loader.ts";
import type {
  WebsitePricingOffer,
  WebsiteProvider,
  WebsiteProviderPricingDetail,
  WebsiteProviderPricingOffer,
} from "../catalog/website-schema.ts";
import PricingServiceOffer from "./PricingServiceOffer.vue";
import RelativeTime from "./RelativeTime.vue";

const PAGE_SIZE = 12;
const props = defineProps<{
  provider: WebsiteProvider;
  detail: WebsiteProviderPricingDetail | undefined;
  loading: boolean;
  error: string | undefined;
  active: boolean;
  excludedOfferIds: readonly string[];
}>();
const emit = defineEmits<{ retry: [] }>();
const resources = ref<WebsiteProviderPricingDetail["resources"]>([]);
const nextChunk = ref(1);
const loadingMore = ref(false);
const chunkError = ref<string>();
const query = ref("");
const visibleCount = ref(PAGE_SIZE);
const offerLoads = ref<Record<string, { offer?: WebsitePricingOffer; error?: string }>>({});
const hasMoreChunks = computed(
  () => nextChunk.value < props.provider.pricing_coverage.detail_chunks,
);
const entries = computed(() => {
  const seen = new Set(props.excludedOfferIds);
  return resources.value.flatMap((resource) =>
    resource.offers.flatMap((summary) => {
      if (seen.has(summary.id)) return [];
      seen.add(summary.id);
      return [{ summary, resourceTitle: resource.title }];
    }),
  );
});
const filteredEntries = computed(() => {
  const text = query.value.trim().toLocaleLowerCase();
  return text === ""
    ? entries.value
    : entries.value.filter(({ summary, resourceTitle }) =>
        [resourceTitle, summary.title, summary.billing_mode.label, summary.state_summary]
          .join(" ")
          .toLocaleLowerCase()
          .includes(text),
      );
});
const visibleEntries = computed(() => filteredEntries.value.slice(0, visibleCount.value));
const hasMore = computed(
  () => hasMoreChunks.value || filteredEntries.value.length > visibleCount.value,
);
const showSearch = computed(
  () => entries.value.length > PAGE_SIZE || hasMoreChunks.value || query.value !== "",
);

watch(
  () => props.detail,
  (detail) => {
    resources.value = detail?.resources ?? [];
    nextChunk.value = 1;
    loadingMore.value = false;
    chunkError.value = undefined;
    query.value = "";
    visibleCount.value = PAGE_SIZE;
    offerLoads.value = {};
  },
  { immediate: true },
);

watch(query, () => {
  visibleCount.value = PAGE_SIZE;
});

watch(
  [visibleEntries, () => props.active],
  ([values, active]) => {
    if (active) for (const { summary } of values) void loadOffer(summary);
  },
  { immediate: true },
);

watch(
  [query, visibleCount, () => props.detail, () => props.active],
  () => {
    void fillVisibleEntries();
  },
  { immediate: true },
);

async function loadOffer(summary: WebsiteProviderPricingOffer): Promise<void> {
  const detail = props.detail;
  const existing = offerLoads.value[summary.id];
  if (detail === undefined || existing !== undefined) return;
  offerLoads.value = { ...offerLoads.value, [summary.id]: {} };
  try {
    const offer = await loadWebsiteProviderPricingOffer(
      detail.data_version,
      detail.provider_id,
      summary,
    );
    if (props.detail === detail)
      offerLoads.value = { ...offerLoads.value, [summary.id]: { offer } };
  } catch {
    if (props.detail === detail)
      offerLoads.value = {
        ...offerLoads.value,
        [summary.id]: { error: "Pricing is temporarily unavailable." },
      };
  }
}

function retryOffer(summary: WebsiteProviderPricingOffer): void {
  delete offerLoads.value[summary.id];
  void loadOffer(summary);
}

async function fillVisibleEntries(): Promise<void> {
  const detail = props.detail;
  if (detail === undefined || !props.active || loadingMore.value) return;
  loadingMore.value = true;
  chunkError.value = undefined;
  try {
    while (
      props.detail === detail &&
      props.active &&
      hasMoreChunks.value &&
      (query.value.trim() !== "" || filteredEntries.value.length < visibleCount.value)
    ) {
      const chunk = await loadWebsiteProviderPricingChunk(
        detail.data_version,
        detail.provider_id,
        nextChunk.value,
      );
      if (props.detail !== detail) return;
      resources.value = [...resources.value, ...chunk.resources];
      nextChunk.value += 1;
    }
  } catch {
    if (props.detail === detail)
      chunkError.value = "More service pricing is temporarily unavailable.";
  } finally {
    if (props.detail === detail) loadingMore.value = false;
  }
}
</script>

<template>
  <div class="provider-service-offers">
    <p v-if="loading" class="service-status" aria-live="polite">Loading other service pricing…</p>
    <p v-else-if="error" class="service-status" role="alert">
      {{ error }} <button type="button" @click="emit('retry')">Retry</button>
    </p>
    <template v-else-if="detail">
      <p v-if="entries.length > 0" class="service-status">
        Provider services are offered independently; their published scope does not establish
        availability for this model.
      </p>
      <p v-if="detail.snapshot?.publication === 'retained'" class="service-status" role="status">
        Service prices were last verified <RelativeTime :value="detail.snapshot.observed_at" />.
        {{ detail.snapshot.refresh_failure.message }}
      </p>
      <label v-if="showSearch" class="service-search">
        <span>Find a service</span>
        <input v-model="query" type="search" placeholder="Search services…" />
      </label>
      <p
        v-if="query.trim() !== '' && filteredEntries.length === 0 && !loadingMore"
        class="service-status"
      >
        No services match this search.
      </p>
      <PricingServiceOffer
        v-for="entry in visibleEntries"
        :key="entry.summary.id"
        :offer="offerLoads[entry.summary.id]?.offer ?? entry.summary"
        :resource-title="entry.resourceTitle"
        :error="offerLoads[entry.summary.id]?.error"
        @retry="retryOffer(entry.summary)"
      />
      <p v-if="chunkError" class="service-status" role="alert">
        {{ chunkError }} <button type="button" @click="fillVisibleEntries">Retry</button>
      </p>
      <button
        v-if="hasMore"
        class="load-more-services"
        type="button"
        :disabled="loadingMore"
        @click="visibleCount += PAGE_SIZE"
      >
        {{ loadingMore ? "Loading…" : "Show more services" }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.provider-service-offers {
  display: contents;
}

.service-status {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
}

.service-search {
  display: grid;
  gap: var(--space-1);
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
}

.service-search input {
  height: var(--control-height-comfortable);
  padding: 0 var(--space-3);
  border: var(--stroke-hairline) solid var(--color-border-default);
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  background: var(--color-surface);
  font: inherit;
}

.load-more-services {
  justify-self: start;
}
</style>
