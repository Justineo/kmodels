<script setup lang="ts" vapor>
import { computed } from "vue";
import { canonicalJson } from "../catalog/canonical-value.ts";
import type { ServiceRule } from "../catalog/website-pricing-query.ts";
import { serviceOperationCopy } from "../pricing/condition-presentation.ts";
import ChargeDriverFacts from "./ChargeDriverFacts.vue";
import UiIcon from "./UiIcon.vue";

const props = defineProps<{ title: string; items: ServiceRule[] }>();
const rules = computed(() =>
  props.items.map((rule) => {
    const operation =
      rule.operation && serviceOperationCopy(rule.operation.value, rule.operation.label);
    const meters = new Map<
      string,
      { row: ServiceRule["rates"][number]["row"]; amounts: string[] }
    >();
    for (const { row, currency } of rule.rates) {
      const key = canonicalJson([row.term_ref, row.label, row.unit, row.driver ?? null]);
      const meter = meters.get(key) ?? { row, amounts: [] };
      meter.amounts.push(displayAmount(row.amount, currency));
      meters.set(key, meter);
    }
    return {
      ...rule,
      label: operation?.label,
      detail: operation?.detail,
      meters: [...meters.values()],
    };
  }),
);
const details = computed(() =>
  rules.value.flatMap((rule) => {
    const meters = rule.meters.filter(
      ({ row }) =>
        row.driver ||
        (rule.meters.length === 1 && row.label.toLowerCase() !== props.title.toLowerCase()),
    );
    return rule.detail || meters.length || rule.allowances.length
      ? [{ ...rule, meters, multipleMeters: rule.meters.length > 1 }]
      : [];
  }),
);

function displayAmount(amount: string, currency?: string) {
  if (!currency || amount.startsWith(`${currency} `)) return amount;
  if (currency === "USD" && amount.startsWith("$")) return `USD ${amount.slice(1)}`;
  return `${amount} (${currency} billing)`;
}
</script>

<template>
  <component :is="details.length ? 'details' : 'div'" class="service-disclosure">
    <component
      :is="details.length ? 'summary' : 'div'"
      class="service-overview"
      :class="{ conditional: rules.some((rule) => rule.label) }"
    >
      <h5>{{ title }}</h5>
      <span class="service-rules">
        <span
          v-for="rule in rules"
          :key="rule.operation?.key ?? rule.state.key"
          class="service-rule"
        >
          <span v-if="rule.label" class="condition">{{ rule.label }}</span>
          <span class="outcome">
            <strong v-if="!rule.meters.length">{{
              rule.state.state === "included" ? "No extra charge" : rule.state.label
            }}</strong>
            <span v-for="meter in rule.meters" :key="meter.row.key" class="quote">
              <span v-if="rule.meters.length > 1" class="basis">{{ meter.row.label }}</span>
              <span class="amounts">
                <strong v-for="(amount, i) in meter.amounts" :key="i">{{ amount }}</strong>
              </span>
              <small>{{ meter.row.unit }}</small>
            </span>
          </span>
          <small v-for="allowance in rule.allowances" :key="allowance.key" class="allowance">
            {{
              allowance.published_terms?.length === 1
                ? allowance.published_terms[0]
                : `${allowance.value} included · ${allowance.reset}`
            }}
          </small>
        </span>
      </span>
      <UiIcon v-if="details.length" class="billing-chevron" name="chevron-right" />
    </component>
    <div v-if="details.length" class="billing-details">
      <section v-for="rule in details" :key="rule.operation?.key ?? rule.state.key">
        <h6 v-if="rule.label">{{ rule.label }}</h6>
        <p v-if="rule.detail">{{ rule.detail }}</p>
        <template v-for="meter in rule.meters" :key="meter.row.key">
          <p v-if="rule.multipleMeters">
            {{ meter.row.label }} · {{ meter.amounts.join(" / ") }} {{ meter.row.unit }}
          </p>
          <ChargeDriverFacts v-if="meter.row.driver" :driver="meter.row.driver" />
          <p v-else-if="!rule.multipleMeters">Billing meter · {{ meter.row.label }}</p>
        </template>
        <div v-for="a in rule.allowances" :key="a.key">
          <p>{{ a.value }} included · {{ a.reset }} · {{ a.target }}</p>
          <template v-if="a.published_terms && a.published_terms.length > 1"
            ><p v-for="term in a.published_terms" :key="term">{{ term }}</p></template
          >
        </div>
      </section>
    </div>
  </component>
</template>

<style scoped>
.service-overview {
  display: grid;
  grid-template-columns: minmax(0, 1fr) fit-content(68%) var(--space-4);
  align-items: baseline;
  gap: var(--space-1) var(--space-2);
}
.service-overview h5,
.billing-details h6,
.billing-details p {
  margin: 0;
}
.service-overview h5 {
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-semibold);
}
.service-rules,
.service-rule,
.outcome,
.quote,
.billing-details,
.billing-details section {
  display: grid;
}
.service-rules,
.outcome {
  gap: var(--space-2);
}
.service-rule {
  grid-template-columns: minmax(0, 1fr);
  align-items: baseline;
  gap: var(--space-1) var(--space-2);
}
.conditional .service-rules {
  grid-column: 1 / 3;
  grid-row: 2;
}
.conditional h5 {
  grid-column: 1 / 3;
}
.conditional .service-rule {
  grid-template-columns: minmax(0, 1fr) fit-content(68%);
}
.outcome {
  text-align: right;
}
.amounts {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  column-gap: var(--space-2);
}
.amounts strong {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
@media (min-width: 641px) {
  .amounts strong + strong {
    border-inline-start: var(--stroke-hairline) solid var(--color-border-default);
    padding-inline-start: var(--space-2);
  }
}
.service-rule strong {
  font-weight: var(--font-weight-semibold);
}
.service-rule small,
.basis,
.billing-details {
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
}
.condition {
  color: var(--color-text-secondary);
}
.allowance {
  grid-column: 1 / -1;
}
summary.service-overview {
  cursor: pointer;
  list-style: none;
}
.service-overview::-webkit-details-marker {
  display: none;
}
.billing-chevron {
  grid-column: 3;
  grid-row: 1;
  color: var(--color-text-muted);
}
.service-disclosure[open] .billing-chevron {
  transform: rotate(90deg);
}
summary.service-overview:hover h5 {
  color: var(--color-accent);
}
.billing-details {
  margin-top: var(--space-2);
  padding: var(--space-3);
  background: var(--color-surface-subtle);
  border-radius: var(--radius-sm);
  gap: var(--space-3);
}
.billing-details section {
  gap: var(--space-1);
}
.billing-details h6 {
  color: var(--color-text-primary);
  font-size: inherit;
}
</style>
