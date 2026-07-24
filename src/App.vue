<script setup lang="ts" vapor>
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from "vue";
import { formatCount, formatModelOperation } from "./catalog/presentation.ts";
import {
  catalogEnvelopeSchema,
  modelLifecycleSchema,
  modelReleaseStageSchema,
  type ModelLifecycle,
  type ModelOperation,
  type ModelReleaseStage,
  type Provider,
  type ProviderModel,
  type SourceRecord,
} from "./catalog/schema.ts";
import { orderedOperations } from "./catalog/operation.ts";
import { indexModels, searchModels } from "./catalog/search.ts";
import { calculateVirtualRange } from "./catalog/virtualization.ts";
import ColumnSortButton from "./components/ColumnSortButton.vue";
import IconSprite from "./components/IconSprite.vue";
import ModelDetails from "./components/ModelDetails.vue";
import ModelRow from "./components/ModelRow.vue";
import ProviderSelect from "./components/ProviderSelect.vue";
import UiIcon from "./components/UiIcon.vue";
import { useOverlayScrollbars } from "./composables/useOverlayScrollbars.ts";

const ROW_HEIGHT = 48;
const TABLE_HEADER_HEIGHT = 34;
const OVERSCAN_ROWS = 8;

type Theme = "light" | "dark";
type SortKey = "name" | "provider" | "context" | "updated";
type SortDirection = "ascending" | "descending";
type SortState = {
  key: SortKey;
  direction: SortDirection;
};
const LIFECYCLE_OPTIONS = modelLifecycleSchema.options;
const RELEASE_STAGE_OPTIONS = modelReleaseStageSchema.options;
const root = document.documentElement;

const models = ref<ProviderModel[]>([]);
const providers = ref<Provider[]>([]);
const sources = ref<SourceRecord[]>([]);
const generatedAt = ref("");
const query = ref("");
const selectedProvider = ref("");
const selectedOperations = ref<ModelOperation[]>([]);
const selectedLifecycles = ref<ModelLifecycle[]>([]);
const selectedReleaseStages = ref<ModelReleaseStage[]>([]);
const loading = ref(true);
const loadError = ref<string>();
const selectedModel = ref<ProviderModel>();
const theme = ref<Theme>(root.dataset.theme === "dark" ? "dark" : "light");
const sort = ref<SortState>();
const searchInput = useTemplateRef<HTMLInputElement>("searchInput");
const filterScrollHost = useTemplateRef<HTMLDivElement>("filterScrollHost");
const filterScrollViewport = useTemplateRef<HTMLDivElement>("filterScrollViewport");
const tableScrollHost = useTemplateRef<HTMLDivElement>("tableScrollHost");
const tableShell = useTemplateRef<HTMLDivElement>("tableShell");
const virtualRange = ref(
  calculateVirtualRange({
    count: 0,
    itemSize: ROW_HEIGHT,
    overscan: OVERSCAN_ROWS,
    scrollOffset: 0,
    viewportSize: 0,
  }),
);
let tableResizeObserver: ResizeObserver | undefined;
const updateFilterScrollbars = useOverlayScrollbars(() => ({
  target: filterScrollHost.value,
  viewport: filterScrollViewport.value,
}));
useOverlayScrollbars(() => ({
  target: tableScrollHost.value,
  viewport: tableShell.value,
}));

const providerNames = computed(
  () => new Map(providers.value.map((provider) => [provider.id, provider.name])),
);
const providerOptions = computed(() =>
  [...providers.value].sort((left, right) => left.name.localeCompare(right.name)),
);
const operationOptions = computed(() =>
  orderedOperations(models.value.flatMap((model) => model.operations)),
);
const searchIndex = computed(() => indexModels(models.value));
const filteredModels = computed(() => {
  const values = searchModels(searchIndex.value, query.value).filter(
    (model) =>
      (selectedProvider.value === "" || model.provider_id === selectedProvider.value) &&
      (selectedOperations.value.length === 0 ||
        model.operations.some((operation) => selectedOperations.value.includes(operation))) &&
      (selectedLifecycles.value.length === 0 || selectedLifecycles.value.includes(model.status)) &&
      (selectedReleaseStages.value.length === 0 ||
        selectedReleaseStages.value.includes(model.release_stage)),
  );
  const activeSort = sort.value;
  if (activeSort) values.sort((left, right) => compareModels(left, right, activeSort));
  return values;
});
const virtualModels = computed(() =>
  filteredModels.value.slice(virtualRange.value.start, virtualRange.value.end),
);
const hasFilters = computed(
  () =>
    query.value !== "" ||
    selectedProvider.value !== "" ||
    selectedOperations.value.length > 0 ||
    selectedLifecycles.value.length > 0 ||
    selectedReleaseStages.value.length > 0,
);
const advancedFilterCount = computed(
  () =>
    selectedOperations.value.length +
    selectedLifecycles.value.length +
    selectedReleaseStages.value.length,
);
const generatedAtLabel = computed(() => {
  if (generatedAt.value === "") return "—";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(generatedAt.value));
});
const resultCountLabel = computed(() => {
  const count = filteredModels.value.length;
  return `${formatCount(count)} ${count === 1 ? "result" : "results"}`;
});
const themeToggleLabel = computed(() =>
  theme.value === "dark" ? "Switch to light mode" : "Switch to dark mode",
);

watch(filteredModels, () => {
  void nextTick(resetVirtualScroll);
});

function compareOptionalNumber(
  left: number | undefined,
  right: number | undefined,
  direction: SortDirection,
): number {
  if (left === undefined) return right === undefined ? 0 : 1;
  if (right === undefined) return -1;
  return direction === "ascending" ? left - right : right - left;
}

function compareOptionalString(
  left: string | undefined,
  right: string | undefined,
  direction: SortDirection,
): number {
  if (left === undefined) return right === undefined ? 0 : 1;
  if (right === undefined) return -1;
  const comparison = left.localeCompare(right);
  return direction === "ascending" ? comparison : -comparison;
}

function compareModels(
  left: ProviderModel,
  right: ProviderModel,
  { key, direction }: SortState,
): number {
  let comparison: number;
  switch (key) {
    case "name":
      comparison = left.name.localeCompare(right.name);
      if (direction === "descending") comparison *= -1;
      break;
    case "provider":
      comparison = providerName(left.provider_id).localeCompare(providerName(right.provider_id));
      if (direction === "descending") comparison *= -1;
      break;
    case "context":
      comparison = compareOptionalNumber(
        left.limits.context_tokens,
        right.limits.context_tokens,
        direction,
      );
      break;
    case "updated":
      comparison = compareOptionalString(
        left.updated_date ?? left.release_date,
        right.updated_date ?? right.release_date,
        direction,
      );
      break;
  }
  return comparison === 0 ? left.uid.localeCompare(right.uid) : comparison;
}

function providerName(providerId: string): string {
  return providerNames.value.get(providerId) ?? providerId;
}

function setSort(nextKey: SortKey): void {
  const current = sort.value;
  if (current?.key !== nextKey) {
    sort.value = { key: nextKey, direction: "ascending" };
    return;
  }

  sort.value =
    current.direction === "ascending" ? { key: nextKey, direction: "descending" } : undefined;
}

function ariaSort(key: SortKey): "ascending" | "descending" | "none" {
  return sort.value?.key === key ? sort.value.direction : "none";
}

function resetFilters(): void {
  query.value = "";
  selectedProvider.value = "";
  clearAdvancedFilters();
}

function clearAdvancedFilters(): void {
  selectedOperations.value = [];
  selectedLifecycles.value = [];
  selectedReleaseStages.value = [];
}

function handleFilterToggle(event: ToggleEvent): void {
  if (event.newState !== "open") return;
  void nextTick(updateFilterScrollbars);
}

function updateVirtualRange(): void {
  const element = tableShell.value;
  virtualRange.value = calculateVirtualRange({
    count: filteredModels.value.length,
    itemSize: ROW_HEIGHT,
    overscan: OVERSCAN_ROWS,
    scrollOffset: element?.scrollTop ?? 0,
    viewportSize: Math.max(0, (element?.clientHeight ?? 0) - TABLE_HEADER_HEIGHT),
  });
}

function resetVirtualScroll(): void {
  const element = tableShell.value;
  if (element !== null) element.scrollTop = 0;
  updateVirtualRange();
}

function handleShortcut(event: KeyboardEvent): void {
  if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
  event.preventDefault();
  searchInput.value?.focus();
}

function toggleTheme(): void {
  theme.value = theme.value === "dark" ? "light" : "dark";
  root.dataset.theme = theme.value;
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", getComputedStyle(root).backgroundColor);
  try {
    localStorage.setItem("theme", theme.value);
  } catch {}
}

async function loadCatalog(): Promise<void> {
  loading.value = true;
  loadError.value = undefined;
  try {
    const response = await fetch("/v1/catalog/index.json", {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Catalog request failed with ${response.status}`);
    const value: unknown = await response.json();
    const catalog = catalogEnvelopeSchema.parse(value);
    models.value = catalog.data.models;
    providers.value = catalog.data.providers;
    sources.value = catalog.data.sources;
    generatedAt.value = catalog.generated_at;
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : "Catalog unavailable";
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  window.addEventListener("keydown", handleShortcut);
  const element = tableShell.value;
  if (element !== null) {
    tableResizeObserver = new ResizeObserver(updateVirtualRange);
    tableResizeObserver.observe(element);
  }
  updateVirtualRange();
  void loadCatalog();
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleShortcut);
  tableResizeObserver?.disconnect();
});
</script>

<template>
  <IconSprite />

  <header class="site-header">
    <h1 id="page-title">
      <a class="brand" href="/" aria-label="Kmodels home">Kmodels</a>
    </h1>
    <div class="header-actions">
      <span class="catalog-summary" aria-label="Catalog summary">
        <strong>{{ loading ? "—" : formatCount(models.length) }}</strong>
        models
        <span aria-hidden="true">·</span>
        <strong>{{ loading ? "—" : providers.length }}</strong>
        providers
      </span>
      <time class="generated-at" :datetime="generatedAt || undefined">
        Updated {{ generatedAtLabel }}
      </time>
      <a class="json-link" href="/v1/catalog/index.json">
        JSON
        <UiIcon name="external-link" />
      </a>
      <button
        class="theme-toggle"
        type="button"
        :aria-label="themeToggleLabel"
        :title="themeToggleLabel"
        @click="toggleTheme"
      >
        <UiIcon :name="theme === 'dark' ? 'sun' : 'moon'" />
      </button>
    </div>
  </header>

  <main class="workspace" aria-labelledby="page-title">
    <section class="catalog-section" aria-label="Model catalog">
      <div class="filter-bar">
        <label class="search-field">
          <span class="visually-hidden">Search model IDs and display names</span>
          <UiIcon name="search" />
          <input
            ref="searchInput"
            v-model="query"
            type="search"
            placeholder="Model ID or name…"
            autocomplete="off"
          />
          <kbd>/</kbd>
        </label>

        <ProviderSelect v-model="selectedProvider" :options="providerOptions" />

        <button
          class="filter-trigger"
          type="button"
          popovertarget="catalog-filters"
          :aria-label="
            advancedFilterCount === 0
              ? 'More filters'
              : `More filters, ${advancedFilterCount} selected`
          "
        >
          <UiIcon name="list-filter" />
          <span>Filters</span>
          <span v-if="advancedFilterCount > 0" class="filter-count">
            {{ advancedFilterCount }}
          </span>
        </button>

        <button
          class="clear-button"
          type="button"
          :disabled="!hasFilters"
          aria-label="Clear filters"
          title="Clear filters"
          @click="resetFilters"
        >
          <UiIcon name="x" />
        </button>

        <output class="result-count" aria-live="polite">{{ resultCountLabel }}</output>

        <dialog
          id="catalog-filters"
          class="filter-popover"
          popover="auto"
          aria-labelledby="filter-popover-title"
          @toggle="handleFilterToggle"
        >
          <div ref="filterScrollHost" class="filter-scroll-host" data-overlayscrollbars-initialize>
            <div ref="filterScrollViewport" class="filter-scroll-viewport">
              <header class="filter-popover-header">
                <div>
                  <h2 id="filter-popover-title">Filters</h2>
                  <p>Matches any selected value within each group.</p>
                </div>
                <div class="filter-popover-actions">
                  <button
                    type="button"
                    :disabled="advancedFilterCount === 0"
                    @click="clearAdvancedFilters"
                  >
                    Clear
                  </button>
                  <button
                    class="filter-popover-close"
                    type="button"
                    popovertarget="catalog-filters"
                    popovertargetaction="hide"
                    aria-label="Close filters"
                  >
                    <UiIcon name="x" />
                  </button>
                </div>
              </header>

              <div class="filter-popover-body">
                <fieldset class="filter-group">
                  <legend>Operations</legend>
                  <div class="filter-options">
                    <label
                      v-for="operation in operationOptions"
                      :key="operation"
                      class="filter-option"
                    >
                      <input v-model="selectedOperations" type="checkbox" :value="operation" />
                      <span>{{ formatModelOperation(operation) }}</span>
                    </label>
                  </div>
                </fieldset>

                <fieldset class="filter-group">
                  <legend>Lifecycle</legend>
                  <div class="filter-options">
                    <label
                      v-for="lifecycle in LIFECYCLE_OPTIONS"
                      :key="lifecycle"
                      class="filter-option"
                    >
                      <input v-model="selectedLifecycles" type="checkbox" :value="lifecycle" />
                      <span
                        class="filter-status-dot"
                        :data-status="lifecycle"
                        aria-hidden="true"
                      ></span>
                      <span class="status-filter-label">{{ lifecycle }}</span>
                    </label>
                  </div>
                </fieldset>

                <fieldset class="filter-group">
                  <legend>Release stage</legend>
                  <div class="filter-options">
                    <label
                      v-for="releaseStage in RELEASE_STAGE_OPTIONS"
                      :key="releaseStage"
                      class="filter-option"
                    >
                      <input
                        v-model="selectedReleaseStages"
                        type="checkbox"
                        :value="releaseStage"
                      />
                      <span
                        class="filter-status-dot"
                        :data-status="releaseStage"
                        aria-hidden="true"
                      ></span>
                      <span class="status-filter-label">{{ releaseStage }}</span>
                    </label>
                  </div>
                </fieldset>
              </div>
            </div>
          </div>
        </dialog>
      </div>

      <div ref="tableScrollHost" class="table-scroll-host" data-overlayscrollbars-initialize>
        <div
          ref="tableShell"
          class="table-shell"
          :aria-busy="loading"
          :aria-label="`Model results, ${resultCountLabel}`"
          tabindex="0"
          @scroll.passive="updateVirtualRange"
        >
          <table class="model-table" :aria-rowcount="filteredModels.length + 1">
            <caption class="visually-hidden">
              Observed models and representative published rates
            </caption>
            <colgroup>
              <col class="model-col" />
              <col class="provider-col" />
              <col class="operations-col" />
              <col class="status-col" />
              <col class="context-col" />
              <col class="input-col" />
              <col class="cached-col" />
              <col class="output-col" />
              <col class="updated-col" />
              <col class="disclosure-col" />
            </colgroup>
            <thead>
              <tr>
                <th class="model-col" scope="col" :aria-sort="ariaSort('name')">
                  <ColumnSortButton
                    label="Model"
                    :direction="sort?.key === 'name' ? sort.direction : undefined"
                    @sort="setSort('name')"
                  />
                </th>
                <th class="provider-col" scope="col" :aria-sort="ariaSort('provider')">
                  <ColumnSortButton
                    label="Provider"
                    :direction="sort?.key === 'provider' ? sort.direction : undefined"
                    @sort="setSort('provider')"
                  />
                </th>
                <th class="operations-col" scope="col">Operations</th>
                <th class="status-col" scope="col">Status</th>
                <th class="context-col numeric" scope="col" :aria-sort="ariaSort('context')">
                  <ColumnSortButton
                    label="Context"
                    :direction="sort?.key === 'context' ? sort.direction : undefined"
                    @sort="setSort('context')"
                  />
                </th>
                <th
                  class="input-col numeric"
                  scope="col"
                  aria-label="Input rate per 1 million tokens"
                  title="Default unit: per 1M tokens"
                >
                  Input / 1M
                </th>
                <th
                  class="cached-col numeric"
                  scope="col"
                  aria-label="Cached input rate per 1 million tokens"
                  title="Default unit: per 1M tokens"
                >
                  Cached / 1M
                </th>
                <th
                  class="output-col numeric"
                  scope="col"
                  aria-label="Output rate per 1 million tokens"
                  title="Default unit: per 1M tokens"
                >
                  Output / 1M
                </th>
                <th class="updated-col numeric" scope="col" :aria-sort="ariaSort('updated')">
                  <ColumnSortButton
                    label="Updated"
                    :direction="sort?.key === 'updated' ? sort.direction : undefined"
                    @sort="setSort('updated')"
                  />
                </th>
                <th class="disclosure-col" scope="col">
                  <span class="visually-hidden">Details</span>
                </th>
              </tr>
            </thead>

            <tbody v-if="filteredModels.length > 0">
              <tr v-if="virtualRange.paddingBefore > 0" class="virtual-spacer" aria-hidden="true">
                <td colspan="10" :style="{ height: `${virtualRange.paddingBefore}px` }"></td>
              </tr>
              <ModelRow
                v-for="(model, index) in virtualModels"
                :key="model.uid"
                :model="model"
                :provider-name="providerName(model.provider_id)"
                :row-index="virtualRange.start + index + 2"
                :selected="selectedModel?.uid === model.uid"
                @select="selectedModel = $event"
                @filter-provider="selectedProvider = $event"
                @filter-operation="selectedOperations = [$event]"
                @filter-lifecycle="selectedLifecycles = [$event]"
                @filter-release-stage="selectedReleaseStages = [$event]"
              />
              <tr v-if="virtualRange.paddingAfter > 0" class="virtual-spacer" aria-hidden="true">
                <td colspan="10" :style="{ height: `${virtualRange.paddingAfter}px` }"></td>
              </tr>
            </tbody>
            <tbody v-else>
              <tr>
                <td colspan="10">
                  <div v-if="loading" class="table-state">
                    <UiIcon class="loader" name="loader-circle" />
                    <p>Loading validated catalog…</p>
                  </div>
                  <div v-else-if="loadError" class="table-state error-state">
                    <p>{{ loadError }}</p>
                    <button type="button" @click="loadCatalog">Try again</button>
                  </div>
                  <div v-else class="table-state">
                    <p>No observed models match these filters.</p>
                    <button v-if="hasFilters" type="button" @click="resetFilters">
                      Clear filters
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  </main>

  <ModelDetails
    :model="selectedModel"
    :provider-name="selectedModel ? providerName(selectedModel.provider_id) : ''"
    :sources="sources"
    @close="selectedModel = undefined"
  />
</template>
