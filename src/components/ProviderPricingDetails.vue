<script setup lang="ts" vapor>
import { nextTick, ref, useTemplateRef, watch } from "vue";
import { formatSnapshotAt } from "../catalog/presentation.ts";
import type {
  WebsitePricingSelector,
  WebsiteProvider,
  WebsiteProviderPricingDetail,
} from "../catalog/website-schema.ts";
import { useOverlayScrollbars } from "../composables/useOverlayScrollbars.ts";
import ProviderIcon from "./ProviderIcon.vue";
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

function requestClose(): void {
  if (props.provider === undefined || closing.value) return;
  closing.value = true;
}

function finishClose(): void {
  if (closing.value) emit("close");
}

function selectorSummary(selector: WebsitePricingSelector): string {
  if (selector.kind === "categorical") return summarize(selector.values.map(({ label }) => label));
  if (selector.kind === "boolean") return "Yes or no";
  if (selector.kind === "decimal_values") return summarize(selector.values);
  if (selector.kind === "decimal_buckets")
    return summarize(selector.values.map(({ label }) => label));
  return "Published numeric range";
}

function summarize(values: string[]): string {
  return values.length <= 3
    ? values.join(", ")
    : `${values.slice(0, 3).join(", ")} +${values.length - 3}`;
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
                v-for="resource in detail.resources"
                :key="resource.id"
                class="provider-resource"
              >
                <header>
                  <div>
                    <span class="provider-resource-kind">{{ resource.kind }}</span>
                    <h3>{{ resource.title }}</h3>
                  </div>
                  <span
                    >{{ resource.offers.length }} offer{{
                      resource.offers.length === 1 ? "" : "s"
                    }}</span
                  >
                </header>

                <article v-for="offer in resource.offers" :key="offer.id" class="provider-offer">
                  <header>
                    <div>
                      <h4>{{ offer.title }}</h4>
                      <small>{{ offer.billing_mode.label }} · {{ offer.state_summary }}</small>
                    </div>
                  </header>
                  <p v-if="offer.composition">{{ offer.composition }}</p>

                  <dl v-if="offer.selectors.length > 0" class="provider-context-list">
                    <div v-for="selector in offer.selectors" :key="selector.key">
                      <dt>{{ selector.label }}</dt>
                      <dd>{{ selectorSummary(selector) }}</dd>
                    </div>
                  </dl>

                  <div v-if="offer.rates.length > 0" class="provider-rate-list">
                    <div v-for="rate in offer.rates" :key="rate.key">
                      <div>
                        <strong>{{ rate.label }}</strong>
                        <small v-if="rate.validity">Validity-qualified</small>
                      </div>
                      <div class="provider-rate-value" :aria-label="rate.accessible_text">
                        <strong>{{ rate.amount }}</strong>
                        <small>{{ rate.unit }}</small>
                      </div>
                      <details v-if="rate.driver">
                        <summary>{{ rate.driver.label }}</summary>
                        <small>{{ rate.driver.definition }}</small>
                        <small
                          >{{ rate.driver.aggregation }} · {{ rate.driver.resolution_phase }}</small
                        >
                      </details>
                      <small v-else class="provider-binding-status"
                        >Usage binding unavailable</small
                      >
                    </div>
                  </div>

                  <ul v-if="offer.allowances.length > 0" class="provider-fact-list">
                    <li v-for="allowance in offer.allowances" :key="allowance.key">
                      Allowance: {{ allowance.value }} · {{ allowance.target }} ·
                      {{ allowance.reset }}
                    </li>
                  </ul>
                  <ul v-if="offer.contributions.length > 0" class="provider-fact-list">
                    <li v-for="entry in offer.contributions" :key="entry.key">
                      {{ entry.label }} → {{ entry.target }}
                      <small v-for="driver in entry.drivers" :key="driver.label">
                        {{ driver.label }} · {{ driver.aggregation }} ·
                        {{ driver.resolution_phase }}
                      </small>
                    </li>
                  </ul>
                  <ul v-if="offer.enrollment.length > 0" class="provider-fact-list">
                    <li v-for="entry in offer.enrollment" :key="entry.key">{{ entry.label }}</li>
                  </ul>
                  <ul v-if="offer.settlement.length > 0" class="provider-fact-list">
                    <li v-for="entry in offer.settlement" :key="entry.key">
                      {{ entry.channel }} · {{ entry.biller }} ·
                      {{ entry.payment_sources.join(" → ") }}
                    </li>
                  </ul>
                  <details v-if="offer.unnormalized.length > 0">
                    <summary>
                      {{ offer.unnormalized.length }} unnormalized official fact{{
                        offer.unnormalized.length === 1 ? "" : "s"
                      }}
                    </summary>
                    <ul class="provider-fact-list">
                      <li v-for="fact in offer.unnormalized" :key="fact.key">
                        <strong>{{ fact.label }}</strong> · {{ fact.reason }}
                        <small v-for="detail in fact.details ?? []" :key="detail">{{
                          detail
                        }}</small>
                      </li>
                    </ul>
                  </details>
                </article>
              </section>
            </template>
          </div>
        </div>
      </div>
    </article>
  </dialog>
</template>

<style scoped>
.provider-pricing-content,
.provider-resource,
.provider-offer,
.provider-context-list,
.provider-rate-list {
  display: grid;
  gap: var(--space-3);
}

.provider-pricing-status,
.provider-offer p,
.provider-fact-list,
.provider-binding-status {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-body);
}

.provider-resource {
  padding-top: var(--space-4);
  border-top: 1px solid var(--color-border-subtle);
}

.provider-resource > header,
.provider-offer > header,
.provider-rate-list > div {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}

.provider-resource h3,
.provider-offer h4 {
  margin: 0;
}

.provider-resource-kind,
.provider-resource > header > span,
.provider-offer small,
.provider-context-list,
.provider-rate-list small,
.provider-fact-list {
  color: var(--color-text-muted);
  font-size: var(--font-size-micro);
}

.provider-offer {
  padding: var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-subtle);
}

.provider-context-list {
  margin: 0;
}

.provider-context-list > div {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
  gap: var(--space-3);
}

.provider-context-list dd {
  margin: 0;
}

.provider-rate-list > div {
  flex-wrap: wrap;
  padding-top: var(--space-2);
  border-top: 1px solid var(--color-border-subtle);
}

.provider-rate-list > div > div,
.provider-rate-list details {
  display: grid;
  gap: var(--space-0-5);
}

.provider-rate-value {
  margin-left: auto;
  text-align: right;
}

.provider-rate-list details {
  flex-basis: 100%;
}

.provider-rate-list summary {
  cursor: pointer;
}

.provider-fact-list {
  display: grid;
  gap: var(--space-1);
  padding-left: var(--space-4);
}

.provider-fact-list li,
.provider-fact-list small {
  display: block;
}
</style>
