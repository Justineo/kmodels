<script setup lang="ts" vapor>
import { computed, ref, watch } from "vue";
import { canonicalJson } from "../catalog/canonical-value.ts";
import { formatCategoricalValue, formatDimension } from "../catalog/pricing-presentation.ts";
import type { PriceCategoricalValue } from "../catalog/pricing-schema.ts";
import type { WebsiteInvocationSelection } from "../catalog/website-invocation-context.ts";
import type { WebsitePricingOffer } from "../catalog/website-schema.ts";
import { resolveInvocationPriceSelectors } from "../pricing/v2/binding.ts";
import type { Selector } from "../pricing/schema.ts";
import UiSelect from "./UiSelect.vue";

const props = defineProps<{
  selection: WebsiteInvocationSelection;
  offers: WebsitePricingOffer[];
}>();
const emit = defineEmits<{ resolve: [value: { selectors: Selector[]; ready: boolean }] }>();
const values = ref<Record<string, string>>({});
const fields = computed(() =>
  (props.selection.binding?.selectors ?? []).map((selector) => {
    const key = canonicalJson(selector.dimension);
    const choices = new Map<string, { key: string; label: string; value: PriceCategoricalValue }>();
    for (const offer of props.offers)
      for (const item of offer.selectors)
        if (item.kind === "categorical" && canonicalJson(item.dimension) === key)
          for (const option of item.values)
            choices.set(canonicalJson(option.value), {
              key: canonicalJson(option.value),
              label: option.label,
              value: option.value,
            });
    const label =
      props.offers
        .flatMap(({ selectors }) => selectors)
        .find((item) => canonicalJson(item.dimension) === key)?.label ??
      formatDimension(selector.dimension);
    return { selector, key, label, choices: [...choices.values()] };
  }),
);
const resolved = computed(() => {
  const binding = props.selection.binding;
  if (binding === undefined) return { selectors: [], ready: false, mismatch: false };
  const inputs: Record<string, PriceCategoricalValue> = {};
  const observed: Record<string, PriceCategoricalValue> = {};
  let mismatch = false;
  for (const field of fields.value) {
    const source = field.selector.value;
    if (source.kind === "fixed") continue;
    const value = field.choices.find(({ key }) => key === values.value[field.key])?.value;
    if (value === undefined) continue;
    if (source.kind === "observed") observed[source.input_ref] = value;
    else {
      inputs[source.input] = value;
      const requestValue =
        Object.entries(props.selection.query.context ?? {}).find(
          ([key]) => key === source.input,
        )?.[1] ?? props.selection.query.inputs?.[source.input];
      if (requestValue !== undefined && requestValue !== value.value) mismatch = true;
    }
  }
  const result = resolveInvocationPriceSelectors(binding, { selectors: [], inputs, observed });
  return {
    selectors: result.selectors,
    ready: result.missingInputs.length === 0 && !mismatch,
    mismatch,
  };
});
watch(
  () => props.selection.key,
  () => {
    values.value = {};
  },
  { flush: "sync" },
);
watch(resolved, ({ selectors, ready }) => emit("resolve", { selectors, ready }), {
  immediate: true,
  flush: "sync",
});
function select(key: string, value: string) {
  values.value = { ...values.value, [key]: value };
}
</script>

<template>
  <div class="invocation-price-inputs">
    <p class="unknown-note">
      Conditional rates for the selected target and case. Account access and request execution
      remain unverified.
    </p>
    <dl v-if="fields.some(({ selector }) => selector.value.kind === 'fixed')" class="fact-grid">
      <template v-for="field in fields" :key="field.key"
        ><div v-if="field.selector.value.kind === 'fixed'">
          <dt>{{ field.label }} · fixed by target</dt>
          <dd>
            {{
              field.choices.find(
                ({ value }) =>
                  canonicalJson(value) ===
                  canonicalJson(
                    field.selector.value.kind === "fixed" ? field.selector.value.value : null,
                  ),
              )?.label ?? formatCategoricalValue(field.selector.value.value)
            }}
          </dd>
        </div></template
      >
    </dl>
    <template v-for="(field, index) in fields" :key="field.key">
      <div v-if="field.selector.value.kind !== 'fixed'" class="price-input">
        <label :for="`invocation-price-${index}`"
          >{{ field.label }} ·
          {{
            field.selector.value.kind === "observed" ? "observed response value" : "request context"
          }}</label
        >
        <UiSelect
          :id="`invocation-price-${index}`"
          :model-value="values[field.key] ?? ''"
          :options="field.choices.map(({ key, label }) => ({ value: key, label }))"
          placeholder="Choose a verified value"
          @update:model-value="select(field.key, $event)"
        />
        <p v-if="field.selector.value.kind === 'observed'" class="unknown-note">
          Use the served value from the documented response or log; the requested route does not
          establish it.
        </p>
        <p v-if="field.choices.length === 0" class="unknown-note">
          No selectable price values are available in this detail.
        </p>
      </div>
    </template>
    <p v-if="resolved.mismatch" class="unknown-note" role="status">
      The price value does not match the selected request context. Rates are withheld.
    </p>
    <p v-else-if="!resolved.ready" class="unknown-note" role="status">
      Choose all required price inputs to see rates.
    </p>
  </div>
</template>

<style scoped>
.invocation-price-inputs,
.price-input {
  display: grid;
  gap: var(--space-2);
}
.price-input label {
  font-size: var(--font-size-meta);
  color: var(--color-text-muted);
}
.price-input :deep(.ui-select-control) {
  padding: var(--space-2);
  border: var(--stroke-hairline) solid var(--color-border-default);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
}
.price-input :deep(.ui-select-control:has(:focus-visible)) {
  outline: var(--stroke-focus) solid var(--color-accent);
}
</style>
