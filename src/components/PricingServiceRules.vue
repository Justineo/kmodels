<script setup lang="ts" vapor>
import { computed } from "vue";
import { formatRateUnit } from "../catalog/pricing-presentation.ts";
import type { ServiceRule } from "../catalog/website-pricing-query.ts";
import { serviceOperationCopy } from "../pricing/condition-presentation.ts";

const props = defineProps<{ items: ServiceRule[] }>();
const rules = computed(() =>
  props.items.map((rule) => ({
    ...rule,
    ...serviceOperationCopy(rule.operation.value, rule.operation.label),
    commonMeter:
      rule.rates.length > 1 && rule.rates.every(({ row }) => row.label === rule.rates[0]?.row.label)
        ? rule.rates[0]?.row.label
        : undefined,
    definitions: [
      ...new Set(
        rule.rates.flatMap(({ row }) => {
          if (!row.driver) return [];
          return row.driver.minimum
            ? [`Minimum billable usage · ${row.driver.minimum}`]
            : [row.driver.definition];
        }),
      ),
    ],
  })),
);

function serviceAmount(amount: string, currency?: string) {
  if (!currency || amount.startsWith(`${currency} `)) return amount;
  if (currency === "USD" && amount.startsWith("$")) return `USD ${amount.slice(1)}`;
  return `${amount} (${currency} billing)`;
}
</script>

<template>
  <dl class="service-rules">
    <div v-for="rule in rules" :key="rule.operation.key">
      <dt>{{ rule.label }}</dt>
      <dd>
        <strong v-if="!rule.rates.length">{{
          rule.state.state === "included" ? "No extra charge" : rule.state.label
        }}</strong>
        <template v-for="allowance in rule.allowances" :key="allowance.key">
          <small v-if="allowance.published_terms?.length === 1">{{
            allowance.published_terms[0]
          }}</small>
          <template v-else>
            <small
              >{{ allowance.value }} included · {{ allowance.reset }} ·
              {{ allowance.target }}</small
            >
            <small v-for="term in allowance.published_terms" :key="term">{{ term }}</small>
          </template>
        </template>
        <span v-if="rule.commonMeter">{{ rule.commonMeter }}</span>
        <div v-for="{ row, currency } in rule.rates" :key="currency ?? row.key">
          <span v-if="!rule.commonMeter">{{ row.label }} · </span>
          <strong :aria-label="row.accessible_text"
            >{{ serviceAmount(row.amount, currency) }} {{ formatRateUnit(row.unit) }}</strong
          >
        </div>
        <small v-if="rule.detail">{{ rule.detail }}</small>
        <small v-for="definition in rule.definitions" :key="definition">{{ definition }}</small>
      </dd>
    </div>
  </dl>
</template>

<style scoped>
.service-rules {
  display: grid;
  margin: var(--space-2) 0 0;
}

.service-rules > div {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
  gap: var(--space-3);
  padding-block: var(--space-2);
  border-top: var(--stroke-hairline) solid var(--color-border-subtle);
}

.service-rules dd {
  display: grid;
  gap: var(--space-1);
  margin: 0;
}

.service-rules small {
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
  overflow-wrap: anywhere;
}

@media (max-width: 640px) {
  .service-rules > div {
    grid-template-columns: 1fr;
    gap: var(--space-1);
  }
}
</style>
