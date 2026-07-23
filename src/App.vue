<script setup lang="ts" vapor>
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from "vue";
import { formatCount, formatModelType, searchableModelText } from "./catalog/presentation.ts";
import {
  catalogEnvelopeSchema,
  type Coverage,
  type Provider,
  type ProviderModel,
  type SourceRecord,
} from "./catalog/schema.ts";
import { calculateVirtualRange } from "./catalog/virtualization.ts";
import ColumnSortButton from "./components/ColumnSortButton.vue";
import ModelDetails from "./components/ModelDetails.vue";
import ModelRow from "./components/ModelRow.vue";

const ROW_HEIGHT = 52;
const TABLE_HEADER_HEIGHT = 34;
const OVERSCAN_ROWS = 8;

type SortKey = "name" | "provider" | "context" | "updated";
type SortDirection = "ascending" | "descending";

const models = ref<ProviderModel[]>([]);
const providers = ref<Provider[]>([]);
const sources = ref<SourceRecord[]>([]);
const coverage = ref<Coverage[]>([]);
const generatedAt = ref("");
const catalogVersion = ref("");
const query = ref("");
const selectedProvider = ref("");
const selectedType = ref("");
const loading = ref(true);
const loadError = ref<string>();
const selectedModel = ref<ProviderModel>();
const sortKey = ref<SortKey>("name");
const sortDirection = ref<SortDirection>("ascending");
const searchInput = useTemplateRef<HTMLInputElement>("searchInput");
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

const providerNames = computed(
  () => new Map(providers.value.map((provider) => [provider.id, provider.name])),
);
const providerGroups = computed(() => {
  const groups: ReadonlyArray<[Provider["kind"], string]> = [
    ["hosted", "Hosted providers"],
    ["cloud_platform", "Cloud platforms"],
    ["gateway", "Gateways"],
    ["model_publisher", "Model publishers"],
    ["local_runtime", "Local runtimes"],
  ];
  return groups
    .map(([kind, label]) => ({
      kind,
      label,
      providers: providers.value
        .filter((provider) => provider.kind === kind)
        .sort((left, right) => left.name.localeCompare(right.name)),
    }))
    .filter((group) => group.providers.length > 0);
});
const typeOptions = computed(() => {
  return [...new Set(models.value.flatMap((model) => model.types))].sort();
});
const freshCount = computed(
  () => coverage.value.filter((providerCoverage) => providerCoverage.status === "fresh").length,
);
const filteredModels = computed(() => {
  const normalizedQuery = query.value.trim().toLocaleLowerCase();
  const values = models.value.filter(
    (model) =>
      (normalizedQuery === "" || searchableModelText(model).includes(normalizedQuery)) &&
      (selectedProvider.value === "" || model.provider_id === selectedProvider.value) &&
      (selectedType.value === "" ||
        model.types.some((modelType) => modelType === selectedType.value)),
  );
  values.sort(compareModels);
  return values;
});
const virtualModels = computed(() =>
  filteredModels.value.slice(virtualRange.value.start, virtualRange.value.end),
);
const hasFilters = computed(
  () => query.value !== "" || selectedProvider.value !== "" || selectedType.value !== "",
);
const generatedAtLabel = computed(() => {
  if (generatedAt.value === "") return "—";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(generatedAt.value));
});
const syncLabel = computed(() => {
  if (loading.value) return "Loading";
  if (loadError.value !== undefined) return "Unavailable";
  return `${freshCount.value}/${providers.value.length} fresh`;
});
const resultCountLabel = computed(() => {
  const count = filteredModels.value.length;
  return `${formatCount(count)} ${count === 1 ? "result" : "results"}`;
});

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

function compareModels(left: ProviderModel, right: ProviderModel): number {
  let comparison: number;
  switch (sortKey.value) {
    case "name":
      comparison = left.name.localeCompare(right.name);
      if (sortDirection.value === "descending") comparison *= -1;
      break;
    case "provider":
      comparison = providerName(left.provider_id).localeCompare(providerName(right.provider_id));
      if (sortDirection.value === "descending") comparison *= -1;
      break;
    case "context":
      comparison = compareOptionalNumber(
        left.limits.context_tokens,
        right.limits.context_tokens,
        sortDirection.value,
      );
      break;
    case "updated":
      comparison = compareOptionalString(
        left.updated_date ?? left.release_date,
        right.updated_date ?? right.release_date,
        sortDirection.value,
      );
      break;
  }
  return comparison === 0 ? left.uid.localeCompare(right.uid) : comparison;
}

function providerName(providerId: string): string {
  return providerNames.value.get(providerId) ?? providerId;
}

function setSort(nextKey: SortKey): void {
  if (sortKey.value === nextKey) {
    sortDirection.value = sortDirection.value === "ascending" ? "descending" : "ascending";
    return;
  }
  sortKey.value = nextKey;
  sortDirection.value = "ascending";
}

function ariaSort(key: SortKey): "ascending" | "descending" | "none" {
  return sortKey.value === key ? sortDirection.value : "none";
}

function resetFilters(): void {
  query.value = "";
  selectedProvider.value = "";
  selectedType.value = "";
  searchInput.value?.focus();
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
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  )
    return;
  event.preventDefault();
  searchInput.value?.focus();
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
    coverage.value = catalog.data.coverage;
    generatedAt.value = catalog.generated_at;
    catalogVersion.value = catalog.catalog_version;
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
  <header class="site-header">
    <div class="header-context">
      <a class="brand" href="/" aria-label="Kmodels home">Kmodels</a>
      <span class="header-divider" aria-hidden="true"></span>
      <span class="current-area">Catalog</span>
    </div>
    <div class="header-actions">
      <span v-if="catalogVersion" class="catalog-version" :title="catalogVersion">
        {{ catalogVersion.slice(0, 8) }}
      </span>
      <span class="sync-state" :class="{ failed: loadError !== undefined }" aria-live="polite">
        <span class="status-dot" aria-hidden="true"></span>
        {{ syncLabel }}
      </span>
      <a class="json-link" href="/v1/catalog/index.json">
        JSON
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M6 3h7v7M13 3 4 12" />
        </svg>
      </a>
    </div>
  </header>

  <main class="workspace">
    <section class="page-header" aria-labelledby="page-title">
      <div class="page-title">
        <h1 id="page-title">Models</h1>
        <p>Observed identities and facts from allowlisted official provider sources.</p>
      </div>
      <dl class="page-metadata">
        <div>
          <dt>Models</dt>
          <dd>{{ loading ? "—" : formatCount(models.length) }}</dd>
        </div>
        <div>
          <dt>Providers</dt>
          <dd>{{ loading ? "—" : providers.length }}</dd>
        </div>
        <div>
          <dt>Coverage</dt>
          <dd>{{ loading ? "—" : `${freshCount}/${providers.length} fresh` }}</dd>
        </div>
        <div>
          <dt>Generated</dt>
          <dd>{{ generatedAtLabel }}</dd>
        </div>
      </dl>
    </section>

    <section aria-label="Model catalog">
      <div class="filter-bar">
        <label class="search-field">
          <span class="visually-hidden">Search models</span>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="8.5" cy="8.5" r="5.5" />
            <path d="m13 13 4 4" />
          </svg>
          <input
            ref="searchInput"
            v-model="query"
            type="search"
            placeholder="Model, provider, endpoint…"
            autocomplete="off"
          />
          <kbd>/</kbd>
        </label>

        <label class="select-field">
          <span>Provider</span>
          <select v-model="selectedProvider" class="filter-select">
            <option value="">All providers</option>
            <optgroup v-for="group in providerGroups" :key="group.kind" :label="group.label">
              <option v-for="provider in group.providers" :key="provider.id" :value="provider.id">
                {{ provider.name }}
              </option>
            </optgroup>
          </select>
        </label>

        <label class="select-field">
          <span>Operation</span>
          <select v-model="selectedType" class="filter-select">
            <option value="">All operations</option>
            <option v-for="modelType in typeOptions" :key="modelType" :value="modelType">
              {{ formatModelType(modelType) }}
            </option>
          </select>
        </label>

        <button
          class="clear-button"
          type="button"
          :disabled="!hasFilters"
          aria-label="Clear filters"
          title="Clear filters"
          @click="resetFilters"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="m4 4 8 8M12 4l-8 8" />
          </svg>
        </button>

        <output class="result-count" aria-live="polite">{{ resultCountLabel }}</output>
      </div>

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
            <col class="output-col" />
            <col class="updated-col" />
            <col class="disclosure-col" />
          </colgroup>
          <thead>
            <tr>
              <th class="model-col" scope="col" :aria-sort="ariaSort('name')">
                <ColumnSortButton
                  label="Model"
                  :direction="sortKey === 'name' ? sortDirection : undefined"
                  @sort="setSort('name')"
                />
              </th>
              <th class="provider-col" scope="col" :aria-sort="ariaSort('provider')">
                <ColumnSortButton
                  label="Provider"
                  :direction="sortKey === 'provider' ? sortDirection : undefined"
                  @sort="setSort('provider')"
                />
              </th>
              <th class="operations-col" scope="col">Operations</th>
              <th class="status-col" scope="col">Status</th>
              <th class="context-col numeric" scope="col" :aria-sort="ariaSort('context')">
                <ColumnSortButton
                  label="Context"
                  :direction="sortKey === 'context' ? sortDirection : undefined"
                  @sort="setSort('context')"
                />
              </th>
              <th class="input-col numeric" scope="col">Input rate</th>
              <th class="output-col numeric" scope="col">Output rate</th>
              <th class="updated-col" scope="col" :aria-sort="ariaSort('updated')">
                <ColumnSortButton
                  label="Updated"
                  :direction="sortKey === 'updated' ? sortDirection : undefined"
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
              <td colspan="9" :style="{ height: `${virtualRange.paddingBefore}px` }"></td>
            </tr>
            <ModelRow
              v-for="(model, index) in virtualModels"
              :key="model.uid"
              :model="model"
              :provider-name="providerName(model.provider_id)"
              :row-index="virtualRange.start + index + 2"
              :selected="selectedModel?.uid === model.uid"
              @select="selectedModel = $event"
            />
            <tr v-if="virtualRange.paddingAfter > 0" class="virtual-spacer" aria-hidden="true">
              <td colspan="9" :style="{ height: `${virtualRange.paddingAfter}px` }"></td>
            </tr>
          </tbody>
          <tbody v-else>
            <tr>
              <td colspan="9">
                <div v-if="loading" class="table-state">
                  <span class="loader" aria-hidden="true"></span>
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
    </section>
  </main>

  <ModelDetails
    :model="selectedModel"
    :provider-name="selectedModel ? providerName(selectedModel.provider_id) : ''"
    :sources="sources"
    @close="selectedModel = undefined"
  />
</template>
