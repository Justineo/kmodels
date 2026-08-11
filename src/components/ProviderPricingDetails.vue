<script setup lang="ts" vapor>
import { computed, nextTick, ref, useTemplateRef, watch } from "vue";
import { formatSnapshotAt } from "../catalog/presentation.ts";
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
import { useOverlayScrollbars } from "../composables/useOverlayScrollbars.ts";
import ProviderIcon from "./ProviderIcon.vue";
import ProviderPricingOfferDetails from "./ProviderPricingOfferDetails.vue";
import UiIcon from "./UiIcon.vue";

const props = defineProps<{
  provider: WebsiteProvider | undefined;
  detail: WebsiteProviderPricingDetail | undefined;
  loading: boolean;
  error: string | undefined;
}>();
const emit = defineEmits<{ close: [] }>();
const dialog = useTemplateRef<HTMLDialogElement>("dialog");
const scrollHost = useTemplateRef<HTMLDivElement>("scrollHost");
const scrollViewport = useTemplateRef<HTMLDivElement>("scrollViewport");
const closing = ref(false);
const resources = ref<WebsiteProviderPricingDetail["resources"]>([]);
const nextChunk = ref(1);
const loadingMore = ref(false);
const chunkError = ref<string>();
const openOfferIds = ref<string[]>([]);
const offerLoads = ref<
  Record<string, { offer?: WebsitePricingOffer; loading: boolean; error?: string }>
>({});
const hasMoreChunks = computed(
  () => nextChunk.value < (props.provider?.pricing_coverage.detail_chunks ?? 0),
);
const resourceGroups = computed(() =>
  [
    {
      id: "normalized",
      rawOnly: false,
      title: "Normalized resources",
      description: "Reviewed rates and commercial states.",
    },
    {
      id: "raw-only",
      rawOnly: true,
      title: "Unresolved official rows",
      description: "Official pricing facts retained for audit without normalized terms.",
    },
  ]
    .map((group) => ({
      ...group,
      resources: resources.value.filter(({ raw_only }) => raw_only === group.rawOnly),
    }))
    .filter(({ resources: groupedResources }) => groupedResources.length > 0),
);
const updateScrollbars = useOverlayScrollbars(() => ({
  target: scrollHost.value,
  viewport: scrollViewport.value,
}));

watch(
  () => props.provider,
  async (provider) => {
    if (provider !== undefined) closing.value = false;
    await nextTick();
    const element = dialog.value;
    if (element === null) return;
    if (provider !== undefined) {
      if (!element.open) element.show();
      scrollViewport.value?.scrollTo({ top: 0 });
    } else if (element.open) {
      element.close();
    }
    updateScrollbars();
  },
  { immediate: true },
);

watch(
  () => props.detail,
  (detail) => {
    resources.value = detail?.resources ?? [];
    nextChunk.value = 1;
    loadingMore.value = false;
    chunkError.value = undefined;
    openOfferIds.value = [];
    offerLoads.value = {};
  },
  { immediate: true },
);

function requestClose(): void {
  if (props.provider === undefined || closing.value) return;
  closing.value = true;
}

function finishClose(): void {
  if (closing.value) emit("close");
}

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
    offerLoads.value = { ...offerLoads.value, [summary.id]: { offer, loading: false } };
  } catch {
    offerLoads.value = {
      ...offerLoads.value,
      [summary.id]: { loading: false, error: "Offer details are temporarily unavailable." },
    };
  }
  updateScrollbars();
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
    resources.value = [...resources.value, ...chunk.resources];
    nextChunk.value += 1;
  } catch {
    chunkError.value = "More resources are temporarily unavailable.";
  } finally {
    loadingMore.value = false;
  }
  updateScrollbars();
}
</script>

<template>
  <dialog
    ref="dialog"
    class="details-dialog"
    :data-closing="closing || undefined"
    aria-labelledby="provider-pricing-title"
    @cancel.prevent="requestClose"
  >
    <article v-if="provider" class="details-panel" @animationend.self="finishClose">
      <header class="details-header">
        <div>
          <p class="eyebrow">
            <ProviderIcon :provider-id="provider.id" :provider-name="provider.name" />
            Provider pricing
          </p>
          <h2 id="provider-pricing-title">{{ provider.name }}</h2>
          <code>{{ provider.pricing_coverage.standalone_resources }} standalone resources</code>
        </div>
        <button
          class="icon-button"
          type="button"
          aria-label="Close provider pricing"
          @click="requestClose"
        >
          <UiIcon name="x" />
        </button>
      </header>

      <div ref="scrollHost" class="details-scroll-host" data-overlayscrollbars-initialize>
        <div ref="scrollViewport" class="details-scroll">
          <div class="details-content provider-pricing-content">
            <p v-if="loading" class="provider-pricing-status">Loading provider pricing…</p>
            <p v-else-if="error" class="unknown-note" role="alert">{{ error }}</p>
            <template v-else-if="detail">
              <p v-if="detail.snapshot" class="provider-pricing-status">
                <template v-if="detail.snapshot.publication === 'fresh'">Verified</template>
                <template v-else>Retained snapshot verified</template>
                <time :datetime="detail.snapshot.observed_at">
                  {{ formatSnapshotAt(detail.snapshot.observed_at) }}
                </time>
              </p>
              <p
                v-if="detail.snapshot?.publication === 'retained'"
                class="unknown-note"
                role="status"
              >
                Latest refresh
                <time :datetime="detail.snapshot.refresh_failure.attempted_at">
                  {{ formatSnapshotAt(detail.snapshot.refresh_failure.attempted_at) }} </time
                >: {{ detail.snapshot.refresh_failure.message }}
              </p>

              <section
                v-for="group in resourceGroups"
                :key="group.id"
                class="provider-resource-group"
                :aria-labelledby="`provider-resource-group-${group.id}`"
              >
                <header>
                  <h3 :id="`provider-resource-group-${group.id}`">{{ group.title }}</h3>
                  <p>{{ group.description }}</p>
                </header>

                <section
                  v-for="resource in group.resources"
                  :key="resource.id"
                  class="provider-resource"
                >
                  <header>
                    <div>
                      <span class="provider-resource-kind">{{ resource.kind }}</span>
                      <h4>{{ resource.title }}</h4>
                    </div>
                    <span
                      >{{ resource.offers.length }} offer{{
                        resource.offers.length === 1 ? "" : "s"
                      }}</span
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
                        <h5>{{ summary.title }}</h5>
                        <small
                          >{{ summary.billing_mode.label }} · {{ summary.state_summary }}</small
                        >
                      </div>
                    </summary>

                    <template v-if="offerOpen(summary.id)">
                      <p v-if="offerLoading(summary.id)" class="provider-pricing-status">
                        Loading offer details…
                      </p>
                      <p v-else-if="offerError(summary.id)" class="unknown-note" role="alert">
                        {{ offerError(summary.id) }}
                      </p>
                    </template>

                    <ProviderPricingOfferDetails
                      v-for="offer in offerOpen(summary.id) ? loadedOffer(summary.id) : []"
                      :key="offer.id"
                      :offer
                    />
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
        </div>
      </div>
    </article>
  </dialog>
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

.provider-resource-group {
  padding-top: var(--space-4);
  border-top: 1px solid var(--color-border-subtle);
}

.provider-resource-group > header h3,
.provider-resource-group > header p,
.provider-resource h4,
.provider-offer h5 {
  margin: 0;
}

.provider-resource-group > header p {
  color: var(--color-text-muted);
  font-size: var(--font-size-micro);
}

.provider-resource > header,
.provider-offer-summary {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}

.provider-resource-kind,
.provider-resource > header > span,
.provider-offer small {
  color: var(--color-text-muted);
  font-size: var(--font-size-micro);
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
