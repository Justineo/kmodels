<script setup lang="ts" vapor>
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from "vue";
import { afterFirstPaint } from "./after-first-paint.ts";
import { modelLifecycles, modelReleaseStages } from "./catalog/catalog-vocabulary.ts";
import { loadWebsiteModelDetail, preloadWebsiteDetails } from "./catalog/website-loader.ts";
import {
  groupModels,
  modelGroupKey,
  modelTableRows,
  type ModelGroup,
} from "./catalog/model-groups.ts";
import { formatCount, formatModelTask, versionBadgeModelUids } from "./catalog/presentation.ts";
import { orderedTasks } from "./catalog/task.ts";
import type { WebsiteCatalog, WebsiteModel } from "./catalog/website-schema.ts";
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
import ModelGroupRow from "./components/ModelGroupRow.vue";
import ModelRow from "./components/ModelRow.vue";
import ProviderSelect from "./components/ProviderSelect.vue";
import UiIcon from "./components/UiIcon.vue";
import UiTooltip from "./components/UiTooltip.vue";
import { useOverlayScrollbars } from "./composables/useOverlayScrollbars.ts";
import { detailsState } from "./details-state.ts";

const OVERSCAN_ROWS = 8;
const INITIAL_VIRTUAL_ITEM_SIZE = 1;
const COARSE_TOUCH_QUERY = "(any-hover: none) and (any-pointer: coarse)";

type Theme = "light" | "dark";
const LIFECYCLE_OPTIONS = modelLifecycles;
const RELEASE_STAGE_OPTIONS = modelReleaseStages;
const root = document.documentElement;
const initialRoute = parseRouteSearch(location.search);
const props = defineProps<{ catalog: WebsiteCatalog }>();

const { providers, generated_at: generatedAt } = props.catalog;
const models = ref(props.catalog.models);
const query = ref(initialRoute.query);
const selectedProvider = ref(initialRoute.provider);
const selectedTasks = ref(initialRoute.tasks);
const selectedLifecycles = ref(initialRoute.lifecycles);
const selectedReleaseStages = ref(initialRoute.releaseStages);
const selectedModelUid = ref(initialRoute.modelUid);
const expandedModelGroupKeys = ref<ReadonlySet<string>>(new Set());
const theme = ref<Theme>(root.dataset.theme === "dark" ? "dark" : "light");
const sort = ref(initialRoute.sort);
const searchInput = useTemplateRef<HTMLInputElement>("searchInput");
const filterScrollHost = useTemplateRef<HTMLDivElement>("filterScrollHost");
const filterScrollViewport = useTemplateRef<HTMLDivElement>("filterScrollViewport");
const tableScrollHost = useTemplateRef<HTMLDivElement>("tableScrollHost");
const tableShell = useTemplateRef<HTMLDivElement>("tableShell");
const tableBody = useTemplateRef<HTMLTableSectionElement>("tableBody");
const tableScrollbarSlot = useTemplateRef<HTMLDivElement>("tableScrollbarSlot");
const tableScrollOffset = ref(0);
const tableViewportSize = ref(0);
const usesNestedTableScroll = ref(window.matchMedia(COARSE_TOUCH_QUERY).matches);
let tableResizeObserver: ResizeObserver | undefined;
let tableScrollMedia: MediaQueryList | undefined;
const detailCache = new Map<string, NonNullable<typeof detailsState.detail>>();
let detailRequest = "";
let applyingRoute = false;
let virtualItemSize = INITIAL_VIRTUAL_ITEM_SIZE;
let tableHeaderHeight = 0;
const updateFilterScrollbars = useOverlayScrollbars(() => ({
  target: filterScrollHost.value,
  viewport: filterScrollViewport.value,
}));
const updateTableScrollbars = useOverlayScrollbars(() => {
  const coarseTouch = usesNestedTableScroll.value;
  return {
    target: tableScrollHost.value,
    viewport: tableShell.value,
    coarseTouch,
    axis: coarseTouch ? "horizontal" : "both",
  };
});
const updateTableBodyScrollbar = useOverlayScrollbars(() => {
  const coarseTouch = usesNestedTableScroll.value;
  return {
    target: coarseTouch ? tableBody.value : null,
    viewport: coarseTouch ? tableBody.value : null,
    slot: coarseTouch ? tableScrollbarSlot.value : null,
    coarseTouch,
    axis: "vertical",
  };
});

const providerNames = new Map(providers.map((provider) => [provider.id, provider.name]));
const selectedModel = computed(() => {
  const uid = selectedModelUid.value;
  return uid === undefined ? undefined : models.value.find((model) => model.uid === uid);
});
const providerOptions = [...providers].sort((left, right) => left.name.localeCompare(right.name));
const taskOptions = orderedTasks(models.value.flatMap((model) => model.tasks));
const versionBadgeUids = versionBadgeModelUids(models.value);
const allModelGroups = computed(() => groupModels(models.value));
const searchIndex = indexModels(models.value);
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
const filteredModelGroups = computed(() => groupModels(filteredModels.value));
const tableRows = computed(() =>
  modelTableRows(filteredModelGroups.value, expandedModelGroupKeys.value),
);
const virtualRange = computed(() =>
  calculateVirtualRange({
    count: tableRows.value.length,
    itemSize: virtualItemSize,
    overscan: OVERSCAN_ROWS,
    scrollOffset: tableScrollOffset.value,
    viewportSize: tableViewportSize.value,
  }),
);
const virtualRows = computed(() =>
  tableRows.value.slice(virtualRange.value.start, virtualRange.value.end),
);
const hasResults = computed(() => filteredModelGroups.value.length > 0);
const hasFilters = computed(
  () =>
    query.value !== "" ||
    selectedProvider.value !== "" ||
    selectedTasks.value.length > 0 ||
    selectedLifecycles.value.length > 0 ||
    selectedReleaseStages.value.length > 0,
);
const hasAdvancedFilters = computed(
  () =>
    selectedTasks.value.length > 0 ||
    selectedLifecycles.value.length > 0 ||
    selectedReleaseStages.value.length > 0,
);
const generatedAtLabel = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
}).format(new Date(generatedAt));
const resultCountLabel = computed(() => {
  const count = filteredModelGroups.value.length;
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
  const element = tableVerticalScrollElement();
  tableScrollOffset.value = element?.scrollTop ?? 0;
  const headerOffset = element === tableShell.value ? tableHeaderHeight : 0;
  tableViewportSize.value = Math.max(0, (element?.clientHeight ?? 0) - headerOffset);
}

function handleTableBodyScroll(): void {
  updateVirtualRange();
}

function tableVerticalScrollElement(): HTMLElement | null {
  return usesNestedTableScroll.value ? tableBody.value : tableShell.value;
}

function pixelToken(name: `--${string}`): number {
  const value = Number.parseFloat(getComputedStyle(root).getPropertyValue(name));
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid pixel token ${name}`);
  return value;
}

function resetVirtualScroll(): void {
  tableShell.value?.scrollTo({ top: 0 });
  tableBody.value?.scrollTo({ top: 0 });
  updateVirtualRange();
  updateTableScrollbars();
  updateTableBodyScrollbar();
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
    !models.value.some((model) => model.uid === selectedModelUid.value)
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
  const orderedModels = filteredModelGroups.value.flatMap((group) => group.models);
  const index = orderedModels.findIndex((model) => model.uid === current.uid);
  if (index === -1) return;
  const nextIndex = index + offset;
  const next = orderedModels[nextIndex];
  if (next === undefined) return;
  ensureModelGroupExpanded(next);
  selectedModelUid.value = next.uid;
  void nextTick(() => {
    const rowIndex = tableRows.value.findIndex(
      (row) => row.kind === "model" && row.model.uid === next.uid,
    );
    if (rowIndex !== -1) scrollModelIntoView(rowIndex);
  });
}

function scrollModelIntoView(index: number): void {
  const element = tableVerticalScrollElement();
  if (element === null) return;
  const headerOffset = element === tableShell.value ? tableHeaderHeight : 0;
  element.scrollTop = nearestItemScrollOffset({
    index,
    itemSize: virtualItemSize,
    scrollOffset: element.scrollTop,
    viewportSize: Math.max(0, element.clientHeight - headerOffset),
  });
  updateVirtualRange();
}

function ensureModelGroupExpanded(model: WebsiteModel): void {
  const key = modelGroupKey(model.provider_id, model.model_id);
  const group = filteredModelGroups.value.find((candidate) => candidate.key === key);
  if (group === undefined || group.models.length < 2 || expandedModelGroupKeys.value.has(key))
    return;
  expandedModelGroupKeys.value = new Set([...expandedModelGroupKeys.value, key]);
}

function toggleModelGroup(group: ModelGroup<WebsiteModel>): void {
  const expanded = expandedModelGroupKeys.value.has(group.key);
  const next = new Set(expandedModelGroupKeys.value);
  if (expanded) {
    next.delete(group.key);
    const selected = selectedModel.value;
    if (
      selected !== undefined &&
      modelGroupKey(selected.provider_id, selected.model_id) === group.key
    )
      selectedModelUid.value = undefined;
  } else {
    next.add(group.key);
  }
  expandedModelGroupKeys.value = next;
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

function selectModel(model: WebsiteModel): void {
  detailsState.pricingTarget = undefined;
  selectedModelUid.value = model.uid;
}

function selectModelPricing(model: WebsiteModel): void {
  detailsState.pricingTarget = model.uid;
  selectedModelUid.value = model.uid;
}

async function loadModelDetail(model: WebsiteModel | undefined): Promise<void> {
  detailRequest = model?.uid ?? "";
  detailsState.detail = undefined;
  detailsState.error = undefined;
  if (model === undefined) {
    detailsState.loading = false;
    return;
  }
  const reference = model.uid;
  const cached = detailCache.get(reference);
  if (cached !== undefined) {
    detailsState.detail = cached;
    detailsState.loading = false;
    return;
  }
  detailsState.loading = true;
  try {
    await afterFirstPaint();
    const detail = await loadWebsiteModelDetail(props.catalog.data_version, model);
    detailCache.set(reference, detail);
    if (detailRequest === reference) detailsState.detail = detail;
  } catch (error) {
    if (detailRequest === reference)
      detailsState.error = error instanceof Error ? error.message : "Model details unavailable";
  } finally {
    if (detailRequest === reference) detailsState.loading = false;
  }
}

detailsState.close = () => {
  selectedModelUid.value = undefined;
};
detailsState.navigate = selectRelativeModel;

watch(
  selectedModel,
  (model) => {
    if (detailsState.pricingTarget !== model?.uid) detailsState.pricingTarget = undefined;
    detailsState.model = model;
    detailsState.providerName = model === undefined ? "" : providerName(model.provider_id);
    void loadModelDetail(model);
  },
  { immediate: true },
);
watch(
  [selectedModel, filteredModelGroups],
  ([model]) => {
    if (model !== undefined) ensureModelGroupExpanded(model);
  },
  { immediate: true },
);

onMounted(() => {
  reconcileRouteSelections();
  virtualItemSize = pixelToken("--layout-table-row-height");
  tableHeaderHeight = pixelToken("--layout-table-header-height");
  window.addEventListener("keydown", handleShortcut);
  window.addEventListener("popstate", applyRoute);
  tableScrollMedia = window.matchMedia(COARSE_TOUCH_QUERY);
  tableScrollMedia.addEventListener("change", handleTableScrollModeChange);
  const shell = tableShell.value;
  if (shell !== null) {
    tableResizeObserver = new ResizeObserver(updateVirtualRange);
    tableResizeObserver.observe(shell);
    const body = tableBody.value;
    if (body !== null) tableResizeObserver.observe(body);
  }
  updateVirtualRange();
  syncRoute();
  void afterFirstPaint().then(() => {
    void import("./details-app.ts")
      .then(({ mountDetailsApp }) => mountDetailsApp())
      .catch((error: unknown) => console.error(error));
    preloadWebsiteDetails(props.catalog.data_version, models.value);
  });
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleShortcut);
  window.removeEventListener("popstate", applyRoute);
  tableScrollMedia?.removeEventListener("change", handleTableScrollModeChange);
  tableResizeObserver?.disconnect();
});

function handleTableScrollModeChange(event: MediaQueryListEvent): void {
  usesNestedTableScroll.value = event.matches;
  void nextTick(resetVirtualScroll);
}
</script>

<template>
  <IconSprite />

  <header class="site-header">
    <h1 id="page-title">
      <a class="brand" href="/" aria-label="Kmodels home">Kmodels</a>
    </h1>
    <div class="header-actions">
      <span class="catalog-summary" aria-label="Catalog summary">
        <strong>{{ formatCount(allModelGroups.length) }}</strong>
        models
        <span aria-hidden="true">·</span>
        <strong>{{ providers.length }}</strong>
        providers
      </span>
      <time class="generated-at" :datetime="generatedAt"> Updated {{ generatedAtLabel }} </time>
      <a
        class="header-link"
        href="https://github.com/Justineo/kmodels"
        aria-label="Kmodels on GitHub"
      >
        <UiIcon name="github" />
      </a>
      <button
        class="theme-toggle"
        type="button"
        :aria-label="themeToggleLabel"
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
          aria-label="More filters"
        >
          <UiIcon name="list-filter" />
          <span>Filters</span>
        </button>

        <button
          class="clear-button"
          type="button"
          :disabled="!hasFilters"
          aria-label="Clear filters"
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
          <header class="filter-popover-header">
            <div>
              <h2 id="filter-popover-title">Filters</h2>
              <p>Matches any selected value within each group.</p>
            </div>
            <div class="filter-popover-actions">
              <button type="button" :disabled="!hasAdvancedFilters" @click="clearAdvancedFilters">
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
          <table v-else class="model-table" :aria-rowcount="tableRows.length + 1">
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
                <th class="status-col" scope="col" aria-label="Model status and maturity">
                  <UiTooltip class="table-header-tooltip-trigger" tabindex="0">
                    Status
                    <template #content>
                      <div class="status-tooltip-content">
                        <div>
                          <p class="status-tooltip-heading">
                            <strong>Lifecycle</strong>
                            <span>Availability &amp; support</span>
                          </p>
                          <dl>
                            <dt><span class="status-badge" data-status="active">Active</span></dt>
                            <dd>Available for requests or deployment.</dd>
                            <dt><span class="status-badge" data-status="legacy">Legacy</span></dt>
                            <dd>Available, but superseded or restricted.</dd>
                            <dt>
                              <span class="status-badge" data-status="deprecated">Deprecated</span>
                            </dt>
                            <dd>Available; retirement has been announced.</dd>
                            <dt><span class="status-badge" data-status="retired">Retired</span></dt>
                            <dd>No longer available for requests or deployment.</dd>
                            <dt><span class="status-badge" data-status="unknown">Unknown</span></dt>
                            <dd>Evidence does not establish availability.</dd>
                          </dl>
                        </div>
                        <div>
                          <p class="status-tooltip-heading">
                            <strong>Maturity</strong>
                            <span>Active models only</span>
                          </p>
                          <dl>
                            <dt><span class="status-badge" data-status="stable">Stable</span></dt>
                            <dd>Stable or generally available.</dd>
                            <dt><span class="status-badge" data-status="preview">Preview</span></dt>
                            <dd>Pre-GA access with provider-documented limitations.</dd>
                            <dt>
                              <span class="status-badge" data-status="experimental">
                                Experimental
                              </span>
                            </dt>
                            <dd>Earlier-stage access with weaker stability expectations.</dd>
                            <dt><span class="status-badge" data-status="unknown">Unknown</span></dt>
                            <dd>Evidence does not establish maturity.</dd>
                          </dl>
                        </div>
                      </div>
                    </template>
                  </UiTooltip>
                </th>
                <th class="context-col numeric" scope="col" :aria-sort="ariaSort('context')">
                  <ColumnSortButton
                    label="Context"
                    :direction="sort?.key === 'context' ? sort.direction : undefined"
                    @sort="setSort('context')"
                  />
                </th>
                <th class="input-col numeric" scope="col" aria-label="Representative input rate">
                  <UiTooltip
                    class="table-header-tooltip-trigger"
                    tabindex="0"
                    content="Representative input price. Token rates use 1M tokens; other meters show their native unit in the cell."
                  >
                    Input
                  </UiTooltip>
                </th>
                <th class="cached-col numeric" scope="col" aria-label="Representative cache rate">
                  <UiTooltip
                    class="table-header-tooltip-trigger"
                    tabindex="0"
                    content="Representative cache price. Token rates use 1M tokens; other meters show their native unit in the cell."
                  >
                    Cache
                  </UiTooltip>
                </th>
                <th class="output-col numeric" scope="col" aria-label="Representative output rate">
                  <UiTooltip
                    class="table-header-tooltip-trigger"
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

            <tbody ref="tableBody" @scroll.passive="handleTableBodyScroll">
              <tr v-if="virtualRange.paddingBefore > 0" class="virtual-spacer" aria-hidden="true">
                <td colspan="10" :style="{ height: `${virtualRange.paddingBefore}px` }"></td>
              </tr>
              <template v-for="(row, index) in virtualRows" :key="row.key">
                <ModelGroupRow
                  v-if="row.kind === 'group'"
                  :group="row.group"
                  :provider-name="providerName(row.group.provider_id)"
                  :row-index="virtualRange.start + index + 2"
                  :alternate="(virtualRange.start + index) % 2 === 1"
                  :expanded="expandedModelGroupKeys.has(row.group.key)"
                  @toggle="toggleModelGroup(row.group)"
                  @filter-provider="selectedProvider = $event"
                  @filter-task="selectedTasks = [$event]"
                  @filter-lifecycle="selectedLifecycles = [$event]"
                  @filter-release-stage="selectedReleaseStages = [$event]"
                />
                <ModelRow
                  v-else
                  :model="row.model"
                  :provider-name="providerName(row.model.provider_id)"
                  :row-index="virtualRange.start + index + 2"
                  :alternate="(virtualRange.start + index) % 2 === 1"
                  :selected="selectedModelUid === row.model.uid"
                  :show-version-badge="versionBadgeUids.has(row.model.uid)"
                  :nested="row.nested"
                  @select="selectModel"
                  @select-pricing="selectModelPricing"
                  @filter-provider="selectedProvider = $event"
                  @filter-task="selectedTasks = [$event]"
                  @filter-lifecycle="selectedLifecycles = [$event]"
                  @filter-release-stage="selectedReleaseStages = [$event]"
                />
              </template>
              <tr v-if="virtualRange.paddingAfter > 0" class="virtual-spacer" aria-hidden="true">
                <td colspan="10" :style="{ height: `${virtualRange.paddingAfter}px` }"></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div ref="tableScrollbarSlot" class="mobile-table-scrollbar-slot"></div>
      </div>
    </section>
  </main>
</template>
