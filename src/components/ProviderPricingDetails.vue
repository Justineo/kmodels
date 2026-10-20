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
import PricingOfferBreakdown from "./PricingOfferBreakdown.vue";
import RelativeTime from "./RelativeTime.vue";
import UiIcon from "./UiIcon.vue";

const props = defineProps<{
  provider: WebsiteProvider;
  detail: WebsiteProviderPricingDetail | undefined;
  loading: boolean;
  error: string | undefined;
}>();
const emit = defineEmits<{ retry: [] }>();
const resources = ref<WebsiteProviderPricingDetail["resources"]>([]);
const nextChunk = ref(1);
const loadingMore = ref(false);
const loadingAll = ref(false);
const chunkError = ref<string>();
const query = ref("");
const openOfferIds = ref<string[]>([]);
const offerLoads = ref<
  Record<string, { offer?: WebsitePricingOffer; loading: boolean; error?: string }>
>({});
const hasMoreChunks = computed(
  () => nextChunk.value < props.provider.pricing_coverage.detail_chunks,
);
const filteredResources = computed(() => {
  const normalized = query.value.trim().toLocaleLowerCase();
  if (normalized === "") return resources.value;
  return resources.value.filter((resource) =>
    [
      resource.title,
      resource.kind,
      ...resource.offers.flatMap((offer) => [
        offer.title,
        offer.billing_mode.label,
        offer.state_summary,
      ]),
    ]
      .join(" ")
      .toLocaleLowerCase()
      .includes(normalized),
  );
});
const resourceGroups = computed(() =>
  [
    {
      id: "normalized",
      rawOnly: false,
      title: "Services",
      description: "Published rates and billing conditions.",
    },
    {
      id: "raw-only",
      rawOnly: true,
      title: "Pricing needing clarification",
      description: "Published prices with conditions that cannot yet be compared directly.",
    },
  ]
    .map((group) => ({
      ...group,
      resources: filteredResources.value.filter(({ raw_only }) => raw_only === group.rawOnly),
    }))
    .filter(({ resources: groupedResources }) => groupedResources.length > 0),
);
watch(
  () => props.detail,
  (detail) => {
    resources.value = detail?.resources ?? [];
    nextChunk.value = 1;
    loadingMore.value = false;
    loadingAll.value = false;
    chunkError.value = undefined;
    query.value = "";
    openOfferIds.value = [];
    offerLoads.value = {};
  },
  { immediate: true },
);

watch([query, loadingMore], async ([value, alreadyLoading]) => {
  if (value.trim() === "" || alreadyLoading || loadingAll.value) return;
  loadingAll.value = true;
  try {
    while (hasMoreChunks.value && chunkError.value === undefined) await loadMoreResources();
  } finally {
    loadingAll.value = false;
  }
});

function loadedOffer(offerId: string): WebsitePricingOffer[] {
  const offer = offerLoads.value[offerId]?.offer;
  return offer === undefined ? [] : [offer];
}

function offerLoading(offerId: string): boolean {
  return offerLoads.value[offerId]?.loading === true;
}

function offerError(offerId: string): string | undefined {
  return offerLoads.value[offerId]?.error;
}

function offerOpen(offerId: string): boolean {
  return openOfferIds.value.includes(offerId);
}

async function toggleOffer(summary: WebsiteProviderPricingOffer, event: Event): Promise<void> {
  if (!(event.currentTarget instanceof HTMLDetailsElement)) return;
  const open = event.currentTarget.open;
  openOfferIds.value = open
    ? [...new Set([...openOfferIds.value, summary.id])]
    : openOfferIds.value.filter((id) => id !== summary.id);
  if (!open || offerLoads.value[summary.id]?.offer !== undefined) return;
  const detail = props.detail;
  if (detail === undefined || offerLoads.value[summary.id]?.loading === true) return;
  offerLoads.value = { ...offerLoads.value, [summary.id]: { loading: true } };
  try {
    const offer = await loadWebsiteProviderPricingOffer(
      detail.data_version,
      detail.provider_id,
      summary,
    );
    if (props.detail !== detail) return;
    offerLoads.value = { ...offerLoads.value, [summary.id]: { offer, loading: false } };
  } catch {
    if (props.detail !== detail) return;
    offerLoads.value = {
      ...offerLoads.value,
      [summary.id]: { loading: false, error: "Offer details are temporarily unavailable." },
    };
  }
}

async function loadMoreResources(): Promise<void> {
  const detail = props.detail;
  if (detail === undefined || !hasMoreChunks.value || loadingMore.value) return;
  loadingMore.value = true;
  chunkError.value = undefined;
  try {
    const chunk = await loadWebsiteProviderPricingChunk(
      detail.data_version,
      detail.provider_id,
      nextChunk.value,
    );
    if (props.detail !== detail) return;
    resources.value = [...resources.value, ...chunk.resources];
    nextChunk.value += 1;
  } catch {
    if (props.detail !== detail) return;
    chunkError.value = "More resources are temporarily unavailable.";
  } finally {
    if (props.detail === detail) loadingMore.value = false;
  }
}
</script>

<template>
  <div class="provider-pricing-content">
    <p v-if="loading" class="provider-pricing-status">Loading service pricing…</p>
    <div v-else-if="error" class="unknown-note" role="alert">
      <p>{{ error }}</p>
      <button type="button" @click="emit('retry')">Retry</button>
    </div>
    <template v-else-if="detail">
      <p v-if="detail.snapshot" class="provider-pricing-status">
        <template v-if="detail.snapshot.publication === 'fresh'">Verified</template>
        <template v-else>Retained snapshot verified</template>
        <RelativeTime :value="detail.snapshot.observed_at" />
      </p>
      <p v-if="detail.snapshot?.publication === 'retained'" class="unknown-note" role="status">
        Latest refresh
        <RelativeTime :value="detail.snapshot.refresh_failure.attempted_at" />:
        {{ detail.snapshot.refresh_failure.message }}
      </p>

      <label class="provider-resource-search">
        <span>Find a resource or offer</span>
        <input v-model="query" type="search" placeholder="Search pricing…" />
      </label>
      <p v-if="query.trim() !== ''" class="provider-pricing-status" aria-live="polite">
        {{ filteredResources.length }} matching resource{{
          filteredResources.length === 1 ? "" : "s"
        }}
      </p>

      <p
        v-if="query.trim() !== '' && filteredResources.length === 0 && !loadingMore"
        class="unknown-note"
      >
        No loaded pricing resource matches this search.
      </p>

      <section
        v-for="group in resourceGroups"
        :key="group.id"
        class="provider-resource-group"
        :aria-labelledby="`provider-resource-group-${group.id}`"
      >
        <header>
          <h4 :id="`provider-resource-group-${group.id}`">{{ group.title }}</h4>
          <p>{{ group.description }}</p>
        </header>

        <section v-for="resource in group.resources" :key="resource.id" class="provider-resource">
          <header>
            <div>
              <span class="provider-resource-kind">{{ resource.kind }}</span>
              <h5>{{ resource.title }}</h5>
            </div>
            <span
              >{{ resource.offers.length }} offer{{ resource.offers.length === 1 ? "" : "s" }}</span
            >
          </header>

          <details
            v-for="summary in resource.offers"
            :key="summary.id"
            class="provider-offer"
            @toggle="toggleOffer(summary, $event)"
          >
            <summary class="provider-offer-summary">
              <div>
                <h6>{{ summary.title }}</h6>
                <small>{{ summary.billing_mode.label }} · {{ summary.state_summary }}</small>
              </div>
              <UiIcon name="chevron-right" />
            </summary>

            <template v-if="offerOpen(summary.id)">
              <p v-if="offerLoading(summary.id)" class="provider-pricing-status">
                Loading offer details…
              </p>
              <p v-else-if="offerError(summary.id)" class="unknown-note" role="alert">
                {{ offerError(summary.id) }}
              </p>
            </template>

            <div
              v-for="offer in offerOpen(summary.id) ? loadedOffer(summary.id) : []"
              :key="offer.id"
              class="provider-offer-body"
            >
              <PricingOfferBreakdown :offer explain-charges />
              <p
                v-if="offer.unnormalized_count > offer.unnormalized.length"
                class="provider-pricing-status"
              >
                Showing {{ offer.unnormalized.length }} of {{ offer.unnormalized_count }} pricing
                facts. The complete pricing download contains every official fact.
              </p>
            </div>
          </details>
        </section>
      </section>

      <p v-if="chunkError" class="unknown-note" role="alert">{{ chunkError }}</p>
      <button
        v-if="hasMoreChunks"
        class="provider-load-more"
        type="button"
        :disabled="loadingMore"
        @click="loadMoreResources"
      >
        {{ loadingMore ? "Loading…" : "Load more resources" }}
      </button>
      <a class="provider-audit-link" href="/pricing/index.json">
        Inspect the complete canonical pricing audit
      </a>
    </template>
  </div>
</template>

<style scoped>
.provider-pricing-content,
.provider-resource-group,
.provider-resource {
  display: grid;
  gap: var(--space-3);
}

.provider-pricing-status,
.provider-offer p {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-body);
}

.provider-resource-search {
  display: grid;
  gap: var(--space-1);
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
}

.provider-resource-search input {
  height: var(--control-height-comfortable);
  padding: 0 var(--space-3);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  background: var(--color-surface);
  font: inherit;
}

.provider-resource-search input:focus-visible {
  border-color: var(--color-accent);
  outline: var(--stroke-focus) solid var(--color-accent);
  outline-offset: calc(var(--stroke-focus) * -1);
}

.provider-resource-group {
  padding-top: var(--space-4);
  border-top: 1px solid var(--color-border-subtle);
}

.provider-resource-group > header h4,
.provider-resource-group > header p,
.provider-resource h5,
.provider-offer h6 {
  margin: 0;
}

.provider-resource-group > header p {
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
}

.provider-resource-group > header h4,
.provider-resource h5,
.provider-offer h6 {
  font-size: var(--font-size-body);
}

.provider-offer[open] > summary > .ui-icon {
  transform: rotate(90deg);
}

.provider-resource > header,
.provider-offer-summary {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}

.provider-offer-body {
  padding: 0 var(--space-3) var(--space-3);
}

.provider-resource-kind,
.provider-resource > header > span,
.provider-offer small {
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
}

.provider-offer {
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-subtle);
}

.provider-offer-summary {
  padding: var(--space-3);
  cursor: pointer;
}

.provider-load-more,
.provider-audit-link {
  justify-self: start;
}
</style>
