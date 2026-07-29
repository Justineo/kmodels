<script setup lang="ts" vapor>
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from "vue";
import { modelLifecycles, modelReleaseStages } from "./catalog/catalog-vocabulary.ts";
import { formatCount, formatModelTask, versionBadgeModelUids } from "./catalog/presentation.ts";
import { orderedTasks } from "./catalog/task.ts";
import {
  websiteModelDetailSchema,
  type WebsiteCatalog,
  type WebsiteModel,
  type WebsiteModelDetail,
} from "./catalog/website-schema.ts";
import {
  formatRouteSearch,
  parseRouteSearch,
  type SortDirection,
  type SortKey,
  type SortState,
} from "./catalog/route.ts";
import { indexModels, searchModels } from "./catalog/search.ts";
import { calculateVirtualRange, nearestItemScrollOffset } from "./catalog/virtualization.ts";
import ColumnSortButton from "./components/ColumnSortButton.vue";
import IconSprite from "./components/IconSprite.vue";
import ModelDetails from "./components/ModelDetails.vue";
import ModelRow from "./components/ModelRow.vue";
import ProviderSelect from "./components/ProviderSelect.vue";
import UiIcon from "./components/UiIcon.vue";
import UiTooltip from "./components/UiTooltip.vue";
import { useOverlayScrollbars } from "./composables/useOverlayScrollbars.ts";

const OVERSCAN_ROWS = 8;
const INITIAL_VIRTUAL_ITEM_SIZE = 1;

type Theme = "light" | "dark";
const LIFECYCLE_OPTIONS = modelLifecycles;
const RELEASE_STAGE_OPTIONS = modelReleaseStages;
const root = document.documentElement;
const initialRoute = parseRouteSearch(location.search);
const props = defineProps<{ catalog: WebsiteCatalog }>();

const { models, providers, generated_at: generatedAt } = props.catalog;
const modelDetail = ref<WebsiteModelDetail>();
const detailLoading = ref(false);
const detailError = ref<string>();
const query = ref(initialRoute.query);
const selectedProvider = ref(initialRoute.provider);
const selectedTasks = ref(initialRoute.tasks);
const selectedLifecycles = ref(initialRoute.lifecycles);
const selectedReleaseStages = ref(initialRoute.releaseStages);
const selectedModelUid = ref(initialRoute.modelUid);
const theme = ref<Theme>(root.dataset.theme === "dark" ? "dark" : "light");
const sort = ref(initialRoute.sort);
const searchInput = useTemplateRef<HTMLInputElement>("searchInput");
const filterScrollHost = useTemplateRef<HTMLDivElement>("filterScrollHost");
const filterScrollViewport = useTemplateRef<HTMLDivElement>("filterScrollViewport");
const tableScrollHost = useTemplateRef<HTMLDivElement>("tableScrollHost");
const tableShell = useTemplateRef<HTMLDivElement>("tableShell");
const tableScrollOffset = ref(0);
const tableViewportSize = ref(0);
let tableResizeObserver: ResizeObserver | undefined;
const detailCache = new Map<string, WebsiteModelDetail>();
let detailRequest = "";
let applyingRoute = false;
let virtualItemSize = INITIAL_VIRTUAL_ITEM_SIZE;
let tableHeaderHeight = 0;
const updateFilterScrollbars = useOverlayScrollbars(() => ({
  target: filterScrollHost.value,
  viewport: filterScrollViewport.value,
}));
useOverlayScrollbars(() => ({
  target: tableScrollHost.value,
  viewport: tableShell.value,
}));

const providerNames = new Map(providers.map((provider) => [provider.id, provider.name]));
const selectedModel = computed(() => {
  const uid = selectedModelUid.value;
  return uid === undefined ? undefined : models.find((model) => model.uid === uid);
});
const providerOptions = [...providers].sort((left, right) => left.name.localeCompare(right.name));
const taskOptions = orderedTasks(models.flatMap((model) => model.tasks));
const versionBadgeUids = versionBadgeModelUids(models);
const searchIndex = indexModels(models);
const filteredModels = computed(() => {
  const values = searchModels(searchIndex, query.value).filter(
    (model) =>
      (selectedProvider.value === "" || model.provider_id === selectedProvider.value) &&
      (selectedTasks.value.length === 0 ||
        model.tasks.some((task) => selectedTasks.value.includes(task))) &&
      (selectedLifecycles.value.length === 0 || selectedLifecycles.value.includes(model.status)) &&
      (selectedReleaseStages.value.length === 0 ||
        selectedReleaseStages.value.includes(model.release_stage)),
  );
  const activeSort = sort.value;
  if (activeSort) values.sort((left, right) => compareModels(left, right, activeSort));
  return values;
});
const virtualRange = computed(() =>
  calculateVirtualRange({
    count: filteredModels.value.length,
    itemSize: virtualItemSize,
    overscan: OVERSCAN_ROWS,
    scrollOffset: tableScrollOffset.value,
    viewportSize: tableViewportSize.value,
  }),
);
const virtualModels = computed(() =>
  filteredModels.value.slice(virtualRange.value.start, virtualRange.value.end),
);
const hasResults = computed(() => filteredModels.value.length > 0);
const hasFilters = computed(
  () =>
    query.value !== "" ||
    selectedProvider.value !== "" ||
    selectedTasks.value.length > 0 ||
    selectedLifecycles.value.length > 0 ||
    selectedReleaseStages.value.length > 0,
);
const advancedFilterCount = computed(
  () =>
    selectedTasks.value.length +
    selectedLifecycles.value.length +
    selectedReleaseStages.value.length,
);
const generatedAtLabel = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
}).format(new Date(generatedAt));
const resultCountLabel = computed(() => {
  const count = filteredModels.value.length;
  return `${formatCount(count)} ${count === 1 ? "result" : "results"}`;
});
const themeToggleLabel = computed(() =>
  theme.value === "dark" ? "Switch to light mode" : "Switch to dark mode",
);

watch(
  [query, selectedProvider, selectedTasks, selectedLifecycles, selectedReleaseStages, sort],
  () => void nextTick(resetVirtualScroll),
  { deep: true, flush: "post" },
);

watch(
  [
    query,
    selectedProvider,
    selectedTasks,
    selectedLifecycles,
    selectedReleaseStages,
    sort,
    selectedModelUid,
  ],
  syncRoute,
  { deep: true, flush: "post" },
);

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
  left: WebsiteModel,
  right: WebsiteModel,
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
      comparison = compareOptionalNumber(left.context_tokens, right.context_tokens, direction);
      break;
    case "released":
      comparison = compareOptionalString(left.release_date, right.release_date, direction);
      break;
  }
  return comparison === 0 ? left.uid.localeCompare(right.uid) : comparison;
}

function providerName(providerId: string): string {
  return providerNames.get(providerId) ?? providerId;
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
  selectedTasks.value = [];
  selectedLifecycles.value = [];
  selectedReleaseStages.value = [];
}

function handleFilterToggle(event: ToggleEvent): void {
  if (event.newState !== "open") return;
  void nextTick(updateFilterScrollbars);
}

function updateVirtualRange(): void {
  const element = tableShell.value;
  tableScrollOffset.value = element?.scrollTop ?? 0;
  tableViewportSize.value = Math.max(0, (element?.clientHeight ?? 0) - tableHeaderHeight);
}

function pixelToken(name: `--${string}`): number {
  const value = Number.parseFloat(getComputedStyle(root).getPropertyValue(name));
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid pixel token ${name}`);
  return value;
}

function resetVirtualScroll(): void {
  const element = tableShell.value;
  if (element !== null) element.scrollTop = 0;
  updateVirtualRange();
}

function syncRoute(): void {
  if (applyingRoute) return;
  const search = formatRouteSearch({
    query: query.value,
    provider: selectedProvider.value,
    tasks: selectedTasks.value,
    lifecycles: selectedLifecycles.value,
    releaseStages: selectedReleaseStages.value,
    sort: sort.value,
    modelUid: selectedModelUid.value,
  });
  if (search === location.search) return;
  history.pushState(history.state, "", `${location.pathname}${search}${location.hash}`);
}

function reconcileRouteSelections(): void {
  if (
    selectedProvider.value !== "" &&
    !providers.some((provider) => provider.id === selectedProvider.value)
  ) {
    selectedProvider.value = "";
  }
  if (
    selectedModelUid.value !== undefined &&
    !models.some((model) => model.uid === selectedModelUid.value)
  ) {
    selectedModelUid.value = undefined;
  }
}

function applyRoute(): void {
  const state = parseRouteSearch(location.search);
  applyingRoute = true;
  query.value = state.query;
  selectedProvider.value = state.provider;
  selectedTasks.value = state.tasks;
  selectedLifecycles.value = state.lifecycles;
  selectedReleaseStages.value = state.releaseStages;
  sort.value = state.sort;
  selectedModelUid.value = state.modelUid;
  reconcileRouteSelections();
  void nextTick(() => {
    applyingRoute = false;
    syncRoute();
  });
}

function selectRelativeModel(offset: -1 | 1): void {
  const current = selectedModel.value;
  if (current === undefined) return;
  const index = filteredModels.value.findIndex((model) => model.uid === current.uid);
  if (index === -1) return;
  const nextIndex = index + offset;
  const next = filteredModels.value[nextIndex];
  if (next === undefined) return;
  selectedModelUid.value = next.uid;
  scrollModelIntoView(nextIndex);
}

function scrollModelIntoView(index: number): void {
  const element = tableShell.value;
  if (element === null) return;
  element.scrollTop = nearestItemScrollOffset({
    index,
    itemSize: virtualItemSize,
    scrollOffset: element.scrollTop,
    viewportSize: Math.max(0, element.clientHeight - tableHeaderHeight),
  });
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

async function loadModelDetail(model: WebsiteModel | undefined): Promise<void> {
  detailRequest = model?.detail_ref ?? "";
  modelDetail.value = undefined;
  detailError.value = undefined;
  if (model === undefined) {
    detailLoading.value = false;
    return;
  }
  const reference = model.detail_ref;
  const cached = detailCache.get(reference);
  if (cached !== undefined) {
    modelDetail.value = cached;
    detailLoading.value = false;
    return;
  }
  detailLoading.value = true;
  try {
    const response = await fetch(`/ui/models/${reference}.json`, {
      cache: "no-cache",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Model detail request failed with ${response.status}`);
    const detail = websiteModelDetailSchema.parse(await response.json());
    if (detail.model_ref !== model.uid)
      throw new Error("Model detail response belongs to another model");
    detailCache.set(reference, detail);
    if (detailRequest === reference) modelDetail.value = detail;
  } catch (error) {
    if (detailRequest === reference)
      detailError.value = error instanceof Error ? error.message : "Model details unavailable";
  } finally {
    if (detailRequest === reference) detailLoading.value = false;
  }
}

watch(selectedModel, (model) => void loadModelDetail(model), { immediate: true });

onMounted(() => {
  reconcileRouteSelections();
  virtualItemSize = pixelToken("--layout-table-row-height");
  tableHeaderHeight = pixelToken("--layout-table-header-height");
  window.addEventListener("keydown", handleShortcut);
  window.addEventListener("popstate", applyRoute);
  const element = tableShell.value;
  if (element !== null) {
    tableResizeObserver = new ResizeObserver(updateVirtualRange);
    tableResizeObserver.observe(element);
  }
  updateVirtualRange();
  syncRoute();
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleShortcut);
  window.removeEventListener("popstate", applyRoute);
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
        <strong>{{ formatCount(models.length) }}</strong>
        models
        <span aria-hidden="true">·</span>
        <strong>{{ providers.length }}</strong>
        providers
      </span>
      <time class="generated-at" :datetime="generatedAt"> Updated {{ generatedAtLabel }} </time>
      <a class="json-link" href="/catalog/index.json">
        Catalog JSON
        <UiIcon name="external-link" />
      </a>
      <a class="json-link" href="/pricing/index.json">
        Pricing JSON
        <UiIcon name="external-link" />
      </a>
      <UiTooltip
        as="button"
        class="theme-toggle"
        type="button"
        :aria-label="themeToggleLabel"
        :content="themeToggleLabel"
        @click="toggleTheme"
      >
        <UiIcon :name="theme === 'dark' ? 'sun' : 'moon'" />
      </UiTooltip>
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

        <UiTooltip
          as="button"
          class="clear-button"
          type="button"
          :disabled="!hasFilters"
          aria-label="Clear filters"
          content="Clear filters"
          @click="resetFilters"
        >
          <UiIcon name="x" />
        </UiTooltip>

        <output class="result-count" aria-live="polite">{{ resultCountLabel }}</output>

        <dialog
          id="catalog-filters"
          class="filter-popover"
          popover="auto"
          aria-labelledby="filter-popover-title"
          @toggle="handleFilterToggle"
        >
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

          <div ref="filterScrollHost" class="filter-scroll-host" data-overlayscrollbars-initialize>
            <div ref="filterScrollViewport" class="filter-scroll-viewport">
              <div class="filter-popover-body">
                <fieldset class="filter-group">
                  <legend>Tasks</legend>
                  <div class="filter-options">
                    <label v-for="task in taskOptions" :key="task" class="filter-option">
                      <input v-model="selectedTasks" type="checkbox" :value="task" />
                      <span>{{ formatModelTask(task) }}</span>
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
          :aria-label="`Model results, ${resultCountLabel}`"
          tabindex="0"
          @scroll.passive="updateVirtualRange"
        >
          <div v-if="!hasResults" class="table-state">
            <p>No observed models match these filters.</p>
            <button v-if="hasFilters" type="button" @click="resetFilters">Clear filters</button>
          </div>
          <table v-else class="model-table" :aria-rowcount="filteredModels.length + 1">
            <caption class="visually-hidden">
              Observed models and representative published rates
            </caption>
            <colgroup>
              <col class="model-col" />
              <col class="provider-col" />
              <col class="tasks-col" />
              <col class="status-col" />
              <col class="context-col" />
              <col class="input-col" />
              <col class="cached-col" />
              <col class="output-col" />
              <col class="released-col" />
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
                <th class="tasks-col" scope="col">Tasks</th>
                <th class="status-col" scope="col">Status</th>
                <th class="context-col numeric" scope="col" :aria-sort="ariaSort('context')">
                  <ColumnSortButton
                    label="Context"
                    :direction="sort?.key === 'context' ? sort.direction : undefined"
                    @sort="setSort('context')"
                  />
                </th>
                <th class="input-col numeric" scope="col" aria-label="Representative input rate">
                  <UiTooltip
                    class="pricing-header-trigger"
                    tabindex="0"
                    content="Representative input price. Token rates use 1M tokens; other meters show their native unit in the cell."
                  >
                    Input
                  </UiTooltip>
                </th>
                <th class="cached-col numeric" scope="col" aria-label="Representative cache rate">
                  <UiTooltip
                    class="pricing-header-trigger"
                    tabindex="0"
                    content="Representative cache price. Token rates use 1M tokens; other meters show their native unit in the cell."
                  >
                    Cache
                  </UiTooltip>
                </th>
                <th class="output-col numeric" scope="col" aria-label="Representative output rate">
                  <UiTooltip
                    class="pricing-header-trigger"
                    tabindex="0"
                    content="Representative output price. Token rates use 1M tokens; other meters show their native unit in the cell."
                  >
                    Output
                  </UiTooltip>
                </th>
                <th class="released-col numeric" scope="col" :aria-sort="ariaSort('released')">
                  <ColumnSortButton
                    label="Released"
                    :direction="sort?.key === 'released' ? sort.direction : undefined"
                    @sort="setSort('released')"
                  />
                </th>
                <th class="disclosure-col" scope="col">
                  <span class="visually-hidden">Details</span>
                </th>
              </tr>
            </thead>

            <tbody>
              <tr v-if="virtualRange.paddingBefore > 0" class="virtual-spacer" aria-hidden="true">
                <td colspan="10" :style="{ height: `${virtualRange.paddingBefore}px` }"></td>
              </tr>
              <ModelRow
                v-for="(model, index) in virtualModels"
                :key="model.uid"
                :model="model"
                :provider-name="providerName(model.provider_id)"
                :row-index="virtualRange.start + index + 2"
                :selected="selectedModelUid === model.uid"
                :show-version-badge="versionBadgeUids.has(model.uid)"
                @select="selectedModelUid = $event.uid"
                @filter-provider="selectedProvider = $event"
                @filter-task="selectedTasks = [$event]"
                @filter-lifecycle="selectedLifecycles = [$event]"
                @filter-release-stage="selectedReleaseStages = [$event]"
              />
              <tr v-if="virtualRange.paddingAfter > 0" class="virtual-spacer" aria-hidden="true">
                <td colspan="10" :style="{ height: `${virtualRange.paddingAfter}px` }"></td>
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
    :detail="modelDetail"
    :loading="detailLoading"
    :error="detailError"
    @close="selectedModelUid = undefined"
    @navigate="selectRelativeModel"
  />
</template>
