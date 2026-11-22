<script setup lang="ts" vapor>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { canonicalJson, uniqueCanonicalValues } from "../catalog/canonical-value.ts";
import type { CommercialChoice } from "../catalog/pricing-schema.ts";
import { queryWebsiteCommercialOffer } from "../catalog/website-commercial-query.ts";
import {
  commercialConditionDimension,
  commercialDimensionLabels,
} from "../pricing/commercial-vocabulary.ts";
import {
  pricingConditionHeading,
  serviceOperationCopy,
} from "../pricing/condition-presentation.ts";
import {
  formatConditionValue,
  formatDimension,
  formatRateUnit,
  formatUnitExpression,
  isModelDimension,
} from "../catalog/pricing-presentation.ts";
import {
  evaluateApplicability,
  evaluateModelApplicability,
  type PricingSelection,
} from "../catalog/pricing-applicability.ts";
import { publishedValidityStatus } from "../catalog/pricing-time.ts";
import { formatLocalDateTime } from "../catalog/presentation.ts";
import {
  projectWebsitePricingNotes,
  projectWebsitePricingTimeline,
  projectWebsiteRateQuery,
} from "../catalog/website-pricing-query.ts";
import type {
  WebsitePriceApplicability,
  WebsitePriceCondition,
  WebsitePricingOffer,
  WebsitePricingSelector,
  WebsitePublishedValidity,
} from "../catalog/website-schema.ts";
import ChargeDriverFacts from "./ChargeDriverFacts.vue";
import UiIcon from "./UiIcon.vue";
import PricingControls from "./PricingControls.vue";
import {
  fixedPricingSelection,
  fixedPricingSelections,
  pricingSelection,
  retainCommercialChoices,
  retainPricingInputs,
  commercialControlChoices,
} from "../catalog/pricing-selector-input.ts";
import {
  linkedPricingSelections,
  serviceRegionPreference,
  type PricingRegion,
  type WebsitePricingContext,
} from "../catalog/website-pricing-context.ts";

const props = defineProps<{
  offer: WebsitePricingOffer;
  modelRef?: string | undefined;
  service?: boolean;
  serviceTitle?: string;
  boundSelectors?: readonly PricingSelection[] | undefined;
  showCandidateRates?: boolean;
  matchedRows?: readonly string[] | undefined;
  hideConditions?: boolean;
  shareContext?: boolean;
  pricingContext?: WebsitePricingContext | undefined;
  preferredRegion?: PricingRegion | undefined;
}>();
const emit = defineEmits<{ pricingContext: [context: WebsitePricingContext] }>();

interface ScopeCopy {
  primary: string;
  secondary?: string;
}

const inputs = ref<Record<string, string>>({});
const commercialChoices = ref<CommercialChoice[]>([]);
const liveNow = ref(new Date().toISOString());
const viewingUpcoming = ref(false);
const timeline = computed(() => projectWebsitePricingTimeline(props.offer, liveNow.value));
const unfilteredOffer = computed(() =>
  props.matchedRows !== undefined
    ? props.offer
    : viewingUpcoming.value && timeline.value.upcoming !== undefined
      ? timeline.value.upcoming.offer
      : timeline.value.current,
);
const inherited = computed(() => {
  const context = props.pricingContext;
  if (context === undefined) return [];
  return linkedPricingSelections(
    props.offer,
    context,
    viewingUpcoming.value
      ? (timeline.value.upcoming?.effective_at ?? liveNow.value)
      : liveNow.value,
  );
});
const boundSelections = computed(() => [...(props.boundSelectors ?? []), ...inherited.value]);
function automaticNativeSelections(
  choices: readonly CommercialChoice[],
  supplied: readonly PricingSelection[],
) {
  return fixedPricingSelections(
    unfilteredOffer.value.selectors.filter(
      ({ dimension }) =>
        !(unfilteredOffer.value.commercial_selection?.claims ?? []).some(
          (claim) =>
            (claim.dimension === "account_plan" ||
              choices.some((choice) => choice.dimension === claim.dimension)) &&
            dimension.namespace === "kmodels" &&
            dimension.value === commercialConditionDimension(claim.dimension),
        ),
    ),
    supplied,
  );
}
function queryCommercial(choices: CommercialChoice[], values = inputs.value) {
  return querySelections(
    choices,
    unfilteredOffer.value.selectors.flatMap(
      (option) => pricingSelection(option, values[option.key] ?? "") ?? [],
    ),
  );
}
function querySelections(choices: CommercialChoice[], selected: readonly PricingSelection[]) {
  return queryWebsiteCommercialOffer(
    unfilteredOffer.value,
    uniqueCanonicalValues([
      ...boundSelections.value,
      ...automaticNativeSelections(choices, [...boundSelections.value, ...selected]),
      ...selected,
      ...(props.modelRef === undefined
        ? []
        : [
            {
              kind: "categorical" as const,
              dimension: { namespace: "kmodels" as const, value: "model" as const },
              value: { namespace: "kmodels" as const, value: props.modelRef },
            },
          ]),
    ]),
    props.hideConditions ? [] : choices,
    viewingUpcoming.value && timeline.value.upcoming
      ? timeline.value.upcoming.effective_at
      : liveNow.value,
  );
}
const commercialContext = computed(() => queryCommercial(commercialChoices.value));
const commercialOptions = computed(() => {
  const fixed = automaticNativeSelections(commercialChoices.value, boundSelections.value);
  return commercialControlChoices(
    queryCommercial([], {}).available_choices,
    queryCommercial(commercialChoices.value, {}).available_choices,
    commercialChoices.value,
  ).filter(
    (choice) =>
      !fixed.some(
        ({ dimension }) =>
          dimension.namespace === "kmodels" &&
          dimension.value === commercialConditionDimension(choice.dimension),
      ),
  );
});
const commercialQuery = computed(() =>
  queryCommercial(
    [
      ...commercialChoices.value,
      ...commercialContext.value.fixed_choices.filter(
        (fixed) => !commercialChoices.value.some(({ dimension }) => dimension === fixed.dimension),
      ),
    ],
    {},
  ),
);
const displayOffer = computed(() =>
  props.hideConditions ? unfilteredOffer.value : commercialQuery.value.offer,
);
function selectCommercial(choices: CommercialChoice[]): void {
  commercialChoices.value = retainCommercialChoices(commercialChoices.value, choices, (next) => {
    const result = queryCommercial(next, {});
    return (
      result.offer.rates.length > 0 ||
      result.offer.states.length > 0 ||
      result.offer.unnormalized.length > 0
    );
  });
  const next = queryCommercial(commercialChoices.value, {}).offer;
  inputs.value = retainPricingInputs(
    unfilteredOffer.value.selectors,
    next.selectors,
    inputs.value,
    (selections) => {
      const result = querySelections(commercialChoices.value, selections).offer;
      return result.rates.length > 0 || result.states.length > 0 || result.unnormalized.length > 0;
    },
  );
}
const selectors = computed(() => {
  if (props.hideConditions) return [];
  const bound = new Set(boundSelections.value.map(({ dimension }) => canonicalJson(dimension)));
  return displayOffer.value.selectors.filter(
    ({ dimension }) =>
      !bound.has(canonicalJson(dimension)) &&
      !commercialOptions.value.some(
        (choice) =>
          dimension.namespace === "kmodels" &&
          dimension.value === commercialConditionDimension(choice.dimension),
      ),
  );
});
const configurableSelectors = computed(() =>
  selectors.value.filter((selector) => fixedPricingSelection(selector) === undefined),
);
const fixedSelectionValues = computed(() =>
  uniqueCanonicalValues([
    ...fixedPricingSelections(selectors.value),
    ...boundSelections.value,
    ...(props.hideConditions ? [] : commercialQuery.value.selectors),
  ]),
);
const followedRegion = computed(() => {
  const region = props.preferredRegion;
  if (region === undefined) return;
  return serviceRegionPreference(
    displayOffer.value,
    configurableSelectors.value,
    region,
    props.modelRef,
    fixedSelectionValues.value,
  );
});
const selectionValues = computed(() =>
  uniqueCanonicalValues([
    ...configurableSelectors.value.flatMap((selector) => {
      const value = selection(selector);
      return value === undefined ? [] : [value];
    }),
    ...fixedSelectionValues.value,
  ]),
);
const visibleStates = computed(() => matchingRows(displayOffer.value.states));
const rateProjection = computed(() =>
  projectWebsiteRateQuery(displayOffer.value, props.modelRef, selectionValues.value),
);
function remainingDimensions(
  selections: readonly PricingSelection[],
  projection = projectWebsiteRateQuery(displayOffer.value, props.modelRef, selections),
) {
  const dimensions = new Map(projection.unresolved_dimensions.map((d) => [canonicalJson(d), d]));
  for (const row of [
    ...displayOffer.value.states.filter((row) => row.state !== "numeric"),
    ...displayOffer.value.allowances,
    ...displayOffer.value.contributions,
  ]) {
    const result = evaluate(row.applicability, selections);
    if (result.state === "missing")
      for (const dimension of result.missing_dimensions)
        dimensions.set(canonicalJson(dimension), dimension);
  }
  return dimensions;
}
const missingDimensions = computed(() =>
  remainingDimensions(selectionValues.value, rateProjection.value),
);
const rateSelectors = computed(() =>
  selectors.value.filter((selector) => {
    const key = canonicalJson(selector.dimension);
    if (fixedPricingSelection(selector) || missingDimensions.value.has(key)) return true;
    if (!inputs.value[selector.key] && followedRegion.value?.key !== selector.key) return false;
    if (!visibleRates.value.length && showUnmatchedRates.value) return true;
    const others = selectionValues.value.filter((value) => canonicalJson(value.dimension) !== key);
    return remainingDimensions(others).has(key);
  }),
);
const visibleRates = computed(() =>
  props.showCandidateRates
    ? displayOffer.value.rates
        .filter(({ key, applicability }) => selectedRow(key) && applies(applicability))
        .map((row) => ({
          ...row,
          qualifier:
            [
              evaluate(row.applicability).state === "missing"
                ? applicabilityLabel(row.applicability, true)
                : undefined,
              validityNote(row.validity),
            ]
              .filter(Boolean)
              .join(" · ") || undefined,
        }))
    : rateProjection.value.rates.map(({ row }) => ({
        ...row,
        qualifier: validityNote(row.validity),
      })),
);
const chargeDrivers = computed(() => [
  ...new Map(
    visibleRates.value.flatMap(({ driver }) =>
      driver !== undefined ? [[canonicalJson(driver), driver] as const] : [],
    ),
  ).values(),
]);
const visibleAllowances = computed(() => matchingRows(displayOffer.value.allowances));
const visibleContributions = computed(() => matchingRows(displayOffer.value.contributions));
const visibleUnnormalized = computed(() =>
  projectWebsitePricingNotes(displayOffer.value)
    .filter(
      ({ key, possible_scope }) =>
        selectedRow(key) && (possible_scope === undefined || applies(possible_scope)),
    )
    .map((row) => ({
      ...row,
      scope:
        row.possible_scope === undefined
          ? qualifiedScope("Applicability not normalized", row.validity)
          : scopeCopy(row.possible_scope, row.validity),
    })),
);
const incompletePrices = computed(() => [
  ...new Map(
    visibleUnnormalized.value
      .filter(({ impact }) => impact === "base_price")
      .map((note) => [canonicalJson([note.label, note.reason]), note]),
  ).values(),
]);
const hasConflictingPrices = computed(() =>
  visibleUnnormalized.value.some(
    ({ impact, reason }) => impact === "base_price" && reason === "Conflicting values",
  ),
);
const pricingNoteGroups = computed(() => {
  const groups = new Map<
    string,
    { key: string; label: string; notes: typeof visibleUnnormalized.value }
  >();
  for (const note of visibleUnnormalized.value) {
    const key =
      note.impact === "base_price" && note.reason === "Conflicting values"
        ? `conflict:${note.label}`
        : note.key;
    const group = groups.get(key) ?? { key, label: note.label, notes: [] };
    group.notes.push(note);
    groups.set(key, group);
  }
  return [...groups.values()];
});
const showOfferStates = computed(
  () =>
    visibleStates.value.length > 0 &&
    (unfilteredOffer.value.states.length > 1 ||
      (props.service && visibleStates.value.some((row) => row.state !== "numeric"))),
);
const showUnmatchedRates = computed(
  () =>
    displayOffer.value.rates.length > 0 &&
    missingDimensions.value.size === 0 &&
    visibleStates.value.every(({ state }) => state === "numeric"),
);
const showPublishedStatus = computed(
  () =>
    displayOffer.value.rates.length === 0 &&
    !(props.service && unfilteredOffer.value.states.length) &&
    !showOfferStates.value &&
    displayOffer.value.state_summary !== "Metered pricing" &&
    displayOffer.value.state_summary !== "Incomplete" &&
    displayOffer.value.state_summary !== "Included",
);

const serviceSummary = computed(() => {
  if (hasConflictingPrices.value) return "Conflicting prices";
  if (incompletePrices.value.length) return "Partial pricing";
  if (timeline.value.upcoming) return "Upcoming rates";
  const conditions = new Set<string>();
  for (const { dimension } of commercialOptions.value) {
    const fixed = commercialContext.value.fixed_choices.some(
      (choice) => choice.dimension === dimension,
    );
    if (
      !fixed ||
      commercialOptions.value.filter((choice) => choice.dimension === dimension).length > 1
    )
      conditions.add(commercialDimensionLabels[dimension]);
  }
  for (const selector of rateSelectors.value)
    if (!fixedPricingSelection(selector)) conditions.add(pricingConditionHeading(selector).label);
  const [firstCondition] = conditions;
  if (firstCondition) return conditions.size === 1 ? firstCondition : "View conditions";
  if (
    commercialQuery.value.unresolved_choices.length ||
    displayOffer.value.unnormalized_count > displayOffer.value.unnormalized.length
  )
    return "View pricing";
  const [rate] = visibleRates.value;
  if (visibleRates.value.length === 1 && rate && !rate.qualifier)
    return `${rate.amount} ${formatRateUnit(rate.unit)}`;
  const [state] = visibleStates.value;
  if (visibleStates.value.length === 1 && state && state.state !== "numeric" && !state.qualifier)
    return state.state === "included" ? "No extra charge" : state.label;
  return "View pricing";
});
const operationDetail = computed(() => {
  for (const selected of selectionValues.value)
    if (
      selected.kind === "categorical" &&
      selected.dimension.namespace === "kmodels" &&
      selected.dimension.value === "operation"
    )
      return serviceOperationCopy(selected.value, selected.value.value).detail;
});

watch([() => props.offer.id, () => props.modelRef], () => {
  inputs.value = {};
  commercialChoices.value = [];
  viewingUpcoming.value = false;
  scheduleClockRefresh();
});

watch(
  () =>
    props.shareContext && props.modelRef !== undefined
      ? {
          modelRef: props.modelRef,
          offerRefs: [props.offer.id],
          selections: selectionValues.value,
        }
      : undefined,
  (context) => {
    if (context !== undefined) emit("pricingContext", context);
  },
  { immediate: true },
);

watch(unfilteredOffer, (next, previous) => {
  inputs.value = retainPricingInputs(previous.selectors, next.selectors, inputs.value);
});

watch(
  () => timeline.value.upcoming?.effective_at,
  () => {
    viewingUpcoming.value = false;
  },
);

let clockTimer: ReturnType<typeof setTimeout> | undefined;

onMounted(scheduleClockRefresh);
onBeforeUnmount(() => {
  if (clockTimer !== undefined) clearTimeout(clockTimer);
});

function scheduleClockRefresh(): void {
  if (clockTimer !== undefined) clearTimeout(clockTimer);
  clockTimer = undefined;
  liveNow.value = new Date().toISOString();
  const nextChangeAt = timeline.value.next_change_at;
  if (nextChangeAt === undefined) return;
  const delay = Math.min(Math.max(Date.parse(nextChangeAt) - Date.now() + 1, 1), 2_147_483_647);
  clockTimer = setTimeout(scheduleClockRefresh, delay);
}

function toggleUpcoming(): void {
  viewingUpcoming.value = !viewingUpcoming.value;
}

function applies(applicability: WebsitePriceApplicability): boolean {
  return evaluate(applicability).state !== "false";
}

function selectedRow(key: string): boolean {
  return props.matchedRows === undefined || props.matchedRows.includes(key);
}

function matches(applicability: WebsitePriceApplicability): boolean {
  return evaluate(applicability).state === "true";
}

function evaluate(
  applicability: WebsitePriceApplicability,
  selections: readonly PricingSelection[] = selectionValues.value,
) {
  return props.modelRef === undefined
    ? evaluateApplicability(applicability, selections)
    : evaluateModelApplicability(applicability, props.modelRef, selections);
}

function matchingRows<
  T extends {
    applicability: WebsitePriceApplicability;
    key: string;
    validity?: WebsitePublishedValidity | undefined;
  },
>(rows: readonly T[]): Array<T & { qualifier: string | undefined }> {
  return rows
    .filter(
      ({ key, applicability }) =>
        selectedRow(key) &&
        (props.showCandidateRates ? applies(applicability) : matches(applicability)),
    )
    .map((row) => ({
      ...row,
      qualifier:
        [
          props.showCandidateRates && evaluate(row.applicability).state === "missing"
            ? applicabilityLabel(row.applicability, true)
            : undefined,
          validityNote(row.validity),
        ]
          .filter(Boolean)
          .join(" · ") || undefined,
    }));
}

function scopeCopy(
  applicability: WebsitePriceApplicability,
  validity: WebsitePublishedValidity | undefined,
): ScopeCopy {
  const result = evaluate(applicability);
  const scope = applicabilityLabel(applicability);
  if (result.state !== "missing") return qualifiedScope(scope, validity);
  return {
    primary: `Choose ${result.missing_dimensions.map(formatDimension).join(", ")}`,
    secondary: [scope, validityNote(validity)]
      .filter((value): value is string => value !== undefined)
      .join(" · "),
  };
}

function qualifiedScope(
  primary: string,
  validity: WebsitePublishedValidity | undefined,
): ScopeCopy {
  const secondary = validityNote(validity);
  return secondary === undefined ? { primary } : { primary, secondary };
}

function applicabilityLabel(
  applicability: WebsitePriceApplicability,
  omitSelected = false,
): string {
  const selected = new Set(
    omitSelected ? selectionValues.value.map(({ dimension }) => canonicalJson(dimension)) : [],
  );
  const clauses = applicability.any_of
    .filter((clause) => !omitSelected || applies({ any_of: [clause] }))
    .map(({ all_of }) =>
      all_of.filter(
        ({ dimension }) => !isModelDimension(dimension) && !selected.has(canonicalJson(dimension)),
      ),
    );
  if (clauses.some((conditions) => conditions.length === 0)) return "All contexts";
  if (omitSelected && clauses.length > 1) {
    const common = (clauses[0] ?? []).filter((condition) =>
      clauses.every((clause) =>
        clause.some((other) => canonicalJson(other) === canonicalJson(condition)),
      ),
    );
    const commonKeys = new Set(common.map(canonicalJson));
    const variableDimensions = new Map(
      clauses.flatMap((clause) =>
        clause
          .filter((condition) => !commonKeys.has(canonicalJson(condition)))
          .map(({ dimension }) => [canonicalJson(dimension), formatDimension(dimension)] as const),
      ),
    );
    return [
      ...common.map(conditionLabel),
      ...(variableDimensions.size === 0
        ? []
        : [
            `${[...variableDimensions.values()].join(", ")}: ${clauses.length} published combinations`,
          ]),
    ].join(" · ");
  }
  const labels = clauses.map((conditions) => conditions.map(conditionLabel).join(" · "));
  if (labels.length <= 2) return labels.join(" or ");
  return `${labels[0]} or ${labels[1]} · +${labels.length - 2} alternatives`;
}

function conditionLabel(condition: WebsitePriceCondition): string {
  const label = formatDimension(condition.dimension);
  if (condition.kind === "categorical")
    return `${label}: ${condition.values.map((value) => formatConditionValue(condition.dimension, value)).join(", ")}`;
  if (condition.kind === "boolean") return condition.value ? label : `No ${label.toLowerCase()}`;
  const bounds = [
    condition.lower === undefined
      ? undefined
      : `${condition.lower.inclusive ? "≥" : ">"} ${condition.lower.value}`,
    condition.upper === undefined
      ? undefined
      : `${condition.upper.inclusive ? "≤" : "<"} ${condition.upper.value}`,
  ].filter((value): value is string => value !== undefined);
  return `${label}: ${bounds.join(" · ")} ${formatUnitExpression(condition.unit)}`;
}

function validityNote(validity: WebsitePublishedValidity | undefined): string | undefined {
  if (validity === undefined || publishedValidityStatus(validity, liveNow.value) !== "unresolved")
    return undefined;
  const from = validity.from === undefined ? undefined : `From ${formatBoundary(validity.from)}`;
  const until =
    validity.until === undefined ? undefined : `Until ${formatBoundary(validity.until)}`;
  return [from, until].filter((value): value is string => value !== undefined).join(" · ");
}

function formatBoundary(boundary: NonNullable<WebsitePublishedValidity["from"]>): string {
  return boundary.precision === "datetime" ? formatLocalDateTime(boundary.value) : boundary.value;
}

function setInput(key: string, value: string): void {
  if (value === "") delete inputs.value[key];
  else inputs.value[key] = value;
}

function selection(selector: WebsitePricingSelector): PricingSelection | undefined {
  const preferred = followedRegion.value;
  return pricingSelection(
    selector,
    inputs.value[selector.key] ?? (preferred?.key === selector.key ? preferred.value : ""),
  );
}

function noteExplanation(reason: string, impact: string): string {
  if (impact === "base_price" && reason === "Conflicting values")
    return "Published prices conflict in this context. No single rate is available.";
  if (reason === "Unknown amount") return "This catalog has no exact price for this charge.";
  if (reason === "Unknown unit") return "The billing unit for this charge is unresolved.";
  if (reason === "Unknown applicability")
    return "The published evidence does not establish when this charge applies.";
  if (impact === "base_price") return "May change the price in the matching context.";
  if (impact === "allowance") return "May change the included usage in the matching context.";
  if (reason === "Requires usage aggregation")
    return "Exact cost depends on usage measured separately by the provider.";
  if (reason === "Unsupported structure")
    return "Published condition shown for context; it is not a separate rate.";
  return "Published provider detail that cannot be expressed as a standalone rate.";
}

function showNoteScope(scope: ScopeCopy): boolean {
  return !["All contexts", "Applicability not normalized"].includes(scope.primary);
}
</script>

<template>
  <component :is="serviceTitle ? 'details' : 'div'" class="offer-breakdown">
    <summary v-if="serviceTitle" class="rate-offer-heading">
      <h5>{{ serviceTitle }}</h5>
      <span>{{ serviceSummary }}</span>
      <UiIcon name="chevron-right" />
    </summary>
    <div v-if="matchedRows === undefined && timeline.upcoming" class="pricing-change">
      <span class="pricing-change-icon"><UiIcon name="calendar-clock" /></span>
      <p>
        <strong>{{ viewingUpcoming ? "Previewing upcoming rates" : "Upcoming rates" }}</strong>
        <time :datetime="timeline.upcoming.effective_at">
          {{ formatLocalDateTime(timeline.upcoming.effective_at) }}
        </time>
      </p>
      <button type="button" @click="toggleUpcoming">
        {{ viewingUpcoming ? "Current rates" : "Preview rates" }}
      </button>
    </div>

    <p v-if="!hideConditions && commercialQuery.unresolved_choices.length">
      Commercial selection evidence is incomplete for this offer.
    </p>
    <PricingControls
      v-if="!hideConditions"
      :prefix="offer.id"
      :inferred="commercialContext.fixed_choices"
      :choices="commercialOptions"
      :selected="commercialChoices"
      :selectors="rateSelectors"
      :inputs="inputs"
      :follow-region="followedRegion"
      :selection-prompt="
        visibleRates.length === 0 && missingDimensions.size > 0
          ? { dimensions: [...missingDimensions.values()] }
          : undefined
      "
      @change="selectCommercial"
      @input="setInput"
    />
    <p v-if="inherited.length" class="context-prompt">
      From Pricing ·
      {{
        inherited
          .map((selection) =>
            selection.kind === "categorical"
              ? `${formatDimension(selection.dimension)} · ${formatConditionValue(selection.dimension, selection.value)}`
              : formatDimension(selection.dimension),
          )
          .join(", ")
      }}
    </p>

    <section
      v-if="visibleRates.length > 0 || showUnmatchedRates"
      class="offer-section"
      aria-label="Published rates"
    >
      <dl v-if="visibleRates.length > 0" class="rate-grid fact-grid">
        <div v-for="rate in visibleRates" :key="rate.key">
          <dt>
            <span class="rate-name">{{ rate.label }}</span>
            <small v-if="rate.qualifier">{{ rate.qualifier }}</small>
          </dt>
          <dd class="numeric" :aria-label="rate.accessible_text">
            <span class="exact-rate">{{ rate.amount }}</span>
            <small>{{ formatRateUnit(rate.unit) }}</small>
          </dd>
        </div>
      </dl>
      <p v-else class="context-prompt">No rates match the selected context.</p>
    </section>

    <div v-if="showPublishedStatus" class="published-status">
      <small>Status</small>
      <strong>{{ displayOffer.state_summary }}</strong>
    </div>

    <div v-if="hasConflictingPrices" class="pricing-warning" role="status">
      <strong>Conflicting published prices</strong>
      <span>No single rate is available for the affected contexts. Review the pricing notes.</span>
    </div>
    <div v-else-if="incompletePrices.length" class="pricing-warning" role="status">
      <strong>Some prices are unresolved</strong>
      <span v-for="note in incompletePrices" :key="note.key">
        {{ note.label }}: {{ noteExplanation(note.reason, note.impact) }}
      </span>
      <span>See Pricing notes for the published details.</span>
    </div>

    <section v-if="visibleAllowances.length > 0" class="offer-section">
      <header class="pricing-subheading"><h6>Included usage</h6></header>
      <div class="allowance-list">
        <div v-for="allowance in visibleAllowances" :key="allowance.key">
          <div>
            <span class="allowance-value">{{ allowance.value }}</span>
            <small>{{ allowance.target }} · {{ allowance.reset }}</small>
            <small v-if="allowance.qualifier">{{ allowance.qualifier }}</small>
            <details v-if="allowance.published_terms?.length">
              <summary>Allowance terms</summary>
              <small v-for="term in allowance.published_terms" :key="term">{{ term }}</small>
            </details>
          </div>
        </div>
      </div>
    </section>

    <section v-if="visibleContributions.length > 0" class="offer-section">
      <header class="pricing-subheading"><h6>Additional usage</h6></header>
      <div class="allowance-list">
        <div v-for="contribution in visibleContributions" :key="contribution.key">
          <div>
            <span class="allowance-value">{{ contribution.label }}</span>
            <small>{{ contribution.target }}</small>
            <template v-if="contribution.drivers.length > 0">
              <ChargeDriverFacts
                v-for="(driver, index) in contribution.drivers"
                :key="index"
                :driver="driver"
              />
            </template>
            <small v-else>No exact public quantity signal is bound.</small>
            <small v-if="contribution.qualifier">{{ contribution.qualifier }}</small>
          </div>
        </div>
      </div>
    </section>

    <section v-if="showOfferStates" class="offer-section">
      <header v-if="!service || visibleStates.length > 1" class="pricing-subheading">
        <h6>Pricing states</h6>
      </header>
      <div class="state-list">
        <div
          v-for="state in visibleStates"
          :key="state.key"
          class="state-row"
          :data-state="state.state"
        >
          <span class="state-marker"></span>
          <div>
            <span class="state-label">{{
              service && state.state === "included" ? "No extra charge" : state.label
            }}</span>
            <small v-if="state.qualifier">{{ state.qualifier }}</small>
          </div>
        </div>
      </div>
    </section>

    <p v-if="operationDetail" class="context-prompt">{{ operationDetail }}</p>

    <details v-if="visibleUnnormalized.length > 0" class="pricing-disclosure">
      <summary>
        <span><UiIcon name="chevron-right" />Pricing notes</span>
        <strong>{{ pricingNoteGroups.length }}</strong>
      </summary>
      <div class="raw-fact-list">
        <details
          v-for="group in pricingNoteGroups"
          :key="group.key"
          class="pricing-note-group"
          :open="group.notes.length === 1"
        >
          <summary>
            <span><UiIcon name="chevron-right" /><strong>{{ group.label }}</strong></span>
            <small v-if="group.notes.length > 1">{{ group.notes.length }} conflicting quotes</small>
          </summary>
          <div v-for="fact in group.notes" :key="fact.key" class="pricing-note">
            <small v-for="detail in fact.details ?? []" :key="detail">{{ detail }}</small>
            <small>{{ noteExplanation(fact.reason, fact.impact) }}</small>
            <small v-if="showNoteScope(fact.scope)">Applies when: {{ fact.scope.primary }}</small>
            <small v-if="fact.scope.secondary">{{ fact.scope.secondary }}</small>
          </div>
        </details>
      </div>
    </details>

    <details v-if="service && chargeDrivers.length > 0" class="pricing-disclosure">
      <summary>
        <span><UiIcon name="chevron-right" />Billing details</span>
      </summary>
      <ChargeDriverFacts v-for="(driver, index) in chargeDrivers" :key="index" :driver />
    </details>
  </component>
</template>

<style scoped>
.rate-offer-heading {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  cursor: pointer;
  list-style: none;
}
.rate-offer-heading::-webkit-details-marker {
  display: none;
}
.rate-offer-heading h5 {
  flex: 1;
  margin: 0;
  font-size: var(--font-size-body);
}
.rate-offer-heading > span,
.rate-offer-heading .ui-icon {
  color: var(--color-text-muted);
}
.rate-offer-heading > span {
  font-size: var(--font-size-meta);
}
.offer-breakdown[open] > .rate-offer-heading > span {
  display: none;
}
.offer-breakdown[open] > .rate-offer-heading {
  margin-bottom: var(--space-2);
}
.offer-breakdown[open] > .rate-offer-heading .ui-icon {
  transform: rotate(90deg);
}
.offer-breakdown {
  min-width: 0;
}

.pricing-subheading,
.state-row,
.allowance-list > div,
.pricing-note-group > summary,
.pricing-disclosure > summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.pricing-change {
  display: grid;
  min-height: var(--target-size-minimum);
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-2);
  padding: var(--space-2) var(--space-2-5);
  border: var(--stroke-hairline) solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-subtle);
}

.pricing-change-icon {
  display: grid;
  width: var(--control-height-compact);
  height: var(--control-height-compact);
  place-items: center;
  border-radius: var(--radius-full);
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

.pricing-change-icon .ui-icon {
  width: var(--icon-size-sm);
  height: var(--icon-size-sm);
}

.pricing-change p {
  display: grid;
  min-width: 0;
  gap: var(--space-0-5);
  margin: 0;
  font-size: var(--font-size-body);
}

.pricing-change time {
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
}

.pricing-change button {
  min-height: var(--control-height-compact);
  padding-inline: var(--space-2);
  border: var(--stroke-hairline) solid var(--color-border-default);
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  background: var(--color-surface);
  font: inherit;
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  white-space: nowrap;
}

.pricing-change button:hover {
  border-color: var(--color-border-interactive);
  background: var(--color-surface-hover);
}

.offer-section {
  margin-top: var(--space-3);
}

.pricing-subheading {
  min-height: var(--control-height-compact);
  gap: var(--space-3);
}

.pricing-subheading h6 {
  margin: 0;
  font-size: var(--font-size-body);
}

.pricing-warning,
.published-status {
  display: grid;
  gap: var(--space-1);
  margin-top: var(--space-4);
  padding: var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-subtle);
}

.pricing-warning {
  border-color: var(--color-status-warning);
}

.pricing-warning span,
.published-status small {
  color: var(--color-text-muted);
  font-size: var(--font-size-body);
}

.context-prompt {
  margin: var(--space-2) 0 0;
  padding: var(--space-2-5) var(--space-3);
  border-left: var(--stroke-focus) solid var(--color-border-default);
  color: var(--color-text-muted);
  background: var(--color-surface-subtle);
  font-size: var(--font-size-body);
  line-height: var(--line-height-body);
}

.state-list,
.allowance-list,
.raw-fact-list {
  display: grid;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.state-row,
.allowance-list > div,
.pricing-note-group {
  gap: var(--space-3);
  padding: var(--space-2-5) var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
}

.state-row > div,
.allowance-list > div > div {
  display: grid;
  flex: 1;
  gap: var(--space-0-5);
}

.state-marker {
  width: var(--space-2);
  height: var(--space-2);
  border-radius: var(--radius-full);
  background: var(--color-accent);
}

.state-label,
.allowance-value {
  color: var(--color-text-primary);
  font-weight: var(--font-weight-medium);
}

.state-row small,
.allowance-list small,
.raw-fact-list small {
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
}

.rate-grid {
  margin-top: var(--space-2);
  padding: 0;
}

.rate-grid dt > * {
  display: block;
}

.rate-grid dt small {
  margin-top: var(--space-0-5);
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
}

.rate-grid dd {
  display: flex;
  align-items: baseline;
  gap: var(--space-1);
  white-space: nowrap;
}

.rate-grid dd small {
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
}

.pricing-disclosure {
  margin-top: var(--space-4);
}

.pricing-disclosure > summary {
  min-height: var(--control-height-comfortable);
  list-style: none;
  cursor: pointer;
}

.pricing-disclosure > summary::-webkit-details-marker {
  display: none;
}

.pricing-disclosure > summary > span,
.pricing-note-group > summary > span {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}

.pricing-disclosure > summary .ui-icon,
.pricing-note-group > summary .ui-icon {
  transition: transform var(--duration-fast) var(--easing-standard);
}

.pricing-disclosure[open] > summary .ui-icon,
.pricing-note-group[open] > summary .ui-icon {
  transform: rotate(90deg);
}

.pricing-note {
  display: grid;
  gap: var(--space-1);
  margin-top: var(--space-2);
}

.pricing-note-group > summary {
  min-height: var(--control-height-compact);
  gap: var(--space-3);
  cursor: pointer;
}

@media (max-width: 640px) {
  .pricing-change {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .pricing-change button {
    grid-column: 2;
    justify-self: start;
  }
}
</style>
