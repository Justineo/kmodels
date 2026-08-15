<script setup lang="ts" vapor>
import { computed } from "vue";
import { formatDailyTimeSchedule } from "../catalog/pricing-presentation.ts";
import { formatRateUnit } from "../catalog/presentation.ts";
import type { WebsitePricingOffer, WebsitePricingSelector } from "../catalog/website-schema.ts";
import ChargeDriverFacts from "./ChargeDriverFacts.vue";

const props = defineProps<{ offer: WebsitePricingOffer }>();
const showStates = computed(
  () =>
    props.offer.states.length > 1 ||
    props.offer.states.some(
      ({ applicability_label, validity }) =>
        applicability_label !== "All contexts" || validity !== undefined,
    ),
);

function selectorSummary(selector: WebsitePricingSelector): string {
  if (selector.kind === "categorical")
    return summarize(
      selector.values.map(({ label, schedule }) =>
        schedule === undefined ? label : `${label} (${formatDailyTimeSchedule(schedule)} UTC)`,
      ),
    );
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
  <div class="provider-offer-body">
    <p v-if="offer.composition">{{ offer.composition }}</p>

    <dl v-if="offer.selectors.length > 0" class="provider-context-list">
      <div v-for="selector in offer.selectors" :key="selector.key">
        <dt>{{ selector.label }}</dt>
        <dd>{{ selectorSummary(selector) }}</dd>
      </div>
    </dl>

    <div v-if="showStates" class="provider-state-section">
      <strong>Pricing states</strong>
      <ul class="provider-state-list" aria-label="Pricing states">
        <li v-for="state in offer.states" :key="state.key">
          <strong>{{ state.label }}</strong>
          <small v-if="state.applicability_label !== 'All contexts'">
            {{ state.applicability_label }}
          </small>
          <small v-if="state.validity">Validity-qualified</small>
        </li>
      </ul>
    </div>

    <div v-if="offer.rates.length > 0" class="provider-rate-list">
      <div v-for="rate in offer.rates" :key="rate.key">
        <div>
          <strong>{{ rate.label }}</strong>
          <small v-if="rate.applicability_label !== 'All contexts'">
            {{ rate.applicability_label }}
          </small>
          <small v-if="rate.validity">Validity-qualified</small>
        </div>
        <div class="provider-rate-value" :aria-label="rate.accessible_text">
          <strong>{{ rate.amount }}</strong>
          <small>{{ formatRateUnit(rate.unit) }}</small>
        </div>
        <details v-if="rate.driver">
          <summary>What this rate charges for</summary>
          <ChargeDriverFacts :driver="rate.driver" />
        </details>
        <small v-else class="provider-binding-status">Usage binding unavailable</small>
      </div>
    </div>

    <ul v-if="offer.allowances.length > 0" class="provider-fact-list">
      <li v-for="allowance in offer.allowances" :key="allowance.key">
        Allowance: {{ allowance.value }} · {{ allowance.target }} · {{ allowance.reset }}
        <small v-if="allowance.applicability_label !== 'All contexts'">
          {{ allowance.applicability_label }}
        </small>
      </li>
    </ul>
    <ul v-if="offer.contributions.length > 0" class="provider-fact-list">
      <li v-for="entry in offer.contributions" :key="entry.key">
        {{ entry.label }} → {{ entry.target }}
        <small v-if="entry.applicability_label !== 'All contexts'">
          {{ entry.applicability_label }}
        </small>
        <ChargeDriverFacts v-for="(driver, index) in entry.drivers" :key="index" :driver="driver" />
      </li>
    </ul>
    <ul v-if="offer.enrollment.length > 0" class="provider-fact-list">
      <li v-for="entry in offer.enrollment" :key="entry.key">
        {{ entry.label }}
        <small v-if="entry.applicability_label !== 'All contexts'">
          {{ entry.applicability_label }}
        </small>
      </li>
    </ul>
    <ul v-if="offer.settlement.length > 0" class="provider-fact-list">
      <li v-for="entry in offer.settlement" :key="entry.key">
        {{ entry.channel }} · {{ entry.biller }} · {{ entry.payment_sources.join(" → ") }}
        <small v-if="entry.applicability_label !== 'All contexts'">
          {{ entry.applicability_label }}
        </small>
      </li>
    </ul>
    <details v-if="offer.unnormalized_count > 0">
      <summary>
        {{ offer.unnormalized_count }} unnormalized official fact{{
          offer.unnormalized_count === 1 ? "" : "s"
        }}
      </summary>
      <ul class="provider-fact-list">
        <li v-for="fact in offer.unnormalized" :key="fact.key">
          <strong>{{ fact.label }}</strong> · {{ fact.reason }}
          <small v-for="factDetail in fact.details ?? []" :key="factDetail">
            {{ factDetail }}
          </small>
        </li>
      </ul>
      <p
        v-if="offer.unnormalized_count > offer.unnormalized.length"
        class="provider-pricing-status"
      >
        Showing {{ offer.unnormalized.length }} representative facts.
      </p>
    </details>
  </div>
</template>

<style scoped>
.provider-offer-body,
.provider-context-list,
.provider-state-section,
.provider-rate-list {
  display: grid;
  gap: var(--space-3);
}

.provider-offer-body {
  padding: 0 var(--space-3) var(--space-3);
}

.provider-context-list,
.provider-state-list,
.provider-fact-list,
.provider-binding-status {
  margin: 0;
}

.provider-offer-body > p,
.provider-pricing-status {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-body);
}

.provider-offer-body small,
.provider-context-list,
.provider-state-list,
.provider-rate-list small,
.provider-fact-list {
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
}

.provider-context-list > div {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
  gap: var(--space-3);
}

.provider-context-list dd {
  margin: 0;
}

.provider-state-list,
.provider-fact-list {
  display: grid;
  gap: var(--space-1);
  padding-left: var(--space-4);
}

.provider-state-list li,
.provider-state-list small,
.provider-fact-list li,
.provider-fact-list small {
  display: block;
}

.provider-state-list strong {
  color: var(--color-text-primary);
}

.provider-rate-list > div {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
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

.provider-rate-list summary,
.provider-offer-body > details > summary {
  cursor: pointer;
}
</style>
