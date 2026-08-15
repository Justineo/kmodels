<script setup lang="ts" vapor>
import { computed, nextTick, useTemplateRef } from "vue";
import { modelLifecycles, modelReleaseStages } from "../catalog/catalog-vocabulary.ts";
import { formatModelTask } from "../catalog/presentation.ts";
import { orderedTasks } from "../catalog/task.ts";
import type { WebsiteModel } from "../catalog/website-schema.ts";
import { useOverlayScrollbars } from "../composables/useOverlayScrollbars.ts";
import UiIcon from "./UiIcon.vue";

type ModelTask = WebsiteModel["tasks"][number];
type ModelLifecycle = WebsiteModel["status"];
type ModelReleaseStage = WebsiteModel["release_stage"];

const props = defineProps<{ models: readonly WebsiteModel[] }>();
const emit = defineEmits<{ clear: [] }>();
const selectedTasks = defineModel<ModelTask[]>("tasks", { required: true });
const selectedLifecycles = defineModel<ModelLifecycle[]>("lifecycles", { required: true });
const selectedReleaseStages = defineModel<ModelReleaseStage[]>("releaseStages", {
  required: true,
});
const taskOptions = orderedTasks(props.models.flatMap((model) => model.tasks));
const filterScrollHost = useTemplateRef<HTMLDivElement>("filterScrollHost");
const filterScrollViewport = useTemplateRef<HTMLDivElement>("filterScrollViewport");
const updateScrollbars = useOverlayScrollbars(() => ({
  target: filterScrollHost.value,
  viewport: filterScrollViewport.value,
}));
const hasSelections = computed(
  () =>
    selectedTasks.value.length > 0 ||
    selectedLifecycles.value.length > 0 ||
    selectedReleaseStages.value.length > 0,
);

function handleToggle(event: ToggleEvent): void {
  if (event.newState === "open") void nextTick(updateScrollbars);
}
</script>

<template>
  <dialog
    id="catalog-filters"
    class="filter-popover"
    popover="auto"
    aria-labelledby="filter-popover-title"
    @toggle="handleToggle"
  >
    <header class="filter-popover-header">
      <div>
        <h2 id="filter-popover-title">Filters</h2>
        <p>Matches any selected value within each group.</p>
      </div>
      <div class="filter-popover-actions">
        <button type="button" :disabled="!hasSelections" @click="emit('clear')">Clear</button>
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
              <label v-for="lifecycle in modelLifecycles" :key="lifecycle" class="filter-option">
                <input v-model="selectedLifecycles" type="checkbox" :value="lifecycle" />
                <span class="filter-status-dot" :data-status="lifecycle" aria-hidden="true"></span>
                <span class="status-filter-label">{{ lifecycle }}</span>
              </label>
            </div>
          </fieldset>

          <fieldset class="filter-group">
            <legend>Release stage</legend>
            <div class="filter-options">
              <label
                v-for="releaseStage in modelReleaseStages"
                :key="releaseStage"
                class="filter-option"
              >
                <input v-model="selectedReleaseStages" type="checkbox" :value="releaseStage" />
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
</template>

<style scoped>
.filter-popover {
  position: fixed;
  top: calc(var(--layout-header-height) + var(--layout-toolbar-height) + 6px);
  right: 166px;
  grid-template-rows: auto minmax(0, 1fr);
  width: min(var(--layout-filter-popover-width), calc(100vw - var(--space-6)));
  max-width: none;
  max-height: min(
    620px,
    calc(100svh - var(--layout-header-height) - var(--layout-toolbar-height) - 18px)
  );
  padding: var(--space-0);
  border: var(--stroke-hairline) solid var(--color-border-default);
  border-radius: var(--floating-surface-radius);
  margin: var(--space-0);
  overflow: hidden;
  color: var(--color-text-primary);
  background: var(--color-surface);
  box-shadow: var(--shadow-filter);
}

.filter-scroll-host {
  min-height: 0;
  overflow: hidden;
}

.filter-scroll-viewport {
  height: 100%;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.filter-popover:popover-open {
  display: grid;
  animation: reveal-filter-popover var(--duration-standard) var(--easing-enter);
}

.filter-popover::backdrop {
  background: var(--color-transparent);
}

.filter-popover-header,
.filter-popover-actions {
  display: flex;
  align-items: center;
}

.filter-popover-header {
  min-height: var(--layout-filter-header-height);
  justify-content: space-between;
  gap: var(--space-6);
  padding: var(--space-2-5) var(--space-3) var(--space-2-5) var(--space-3-5);
  border-bottom: var(--stroke-hairline) solid var(--color-border-subtle);
}

.filter-popover-header h2 {
  font-size: var(--font-size-heading);
  font-weight: var(--font-weight-semibold);
  letter-spacing: var(--tracking-snug);
}

.filter-popover-header p {
  margin-top: var(--space-0-5);
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
}

.filter-popover-actions {
  gap: var(--space-1);
}

.filter-popover-actions > button {
  min-height: var(--control-height-default);
  padding-inline: var(--space-2);
  border-radius: var(--radius-sm);
  color: var(--color-text-secondary);
  font-size: var(--font-size-body);
}

.filter-popover-actions > button:hover:not(:disabled) {
  color: var(--color-text-primary);
  background: var(--color-surface-hover);
}

.filter-popover-actions > button:disabled {
  color: var(--color-border-default);
}

.filter-popover-actions > .filter-popover-close {
  display: grid;
  width: var(--control-height-default);
  padding: var(--space-0);
  place-items: center;
}

.filter-popover-close .ui-icon {
  width: var(--icon-size-sm);
  height: var(--icon-size-sm);
}

.filter-popover-body {
  padding: var(--space-3) var(--space-3-5) var(--space-4);
}

.filter-group {
  min-width: 0;
  padding: var(--space-0);
  border: 0;
}

.filter-group + .filter-group {
  margin-top: var(--space-3-5);
  padding-top: var(--space-3);
  border-top: var(--stroke-hairline) solid var(--color-border-subtle);
}

.filter-group legend {
  margin-bottom: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
  font-weight: var(--font-weight-semibold);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
}

.filter-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-0-5) var(--space-2-5);
}

.filter-option {
  display: flex;
  min-width: 0;
  min-height: var(--control-height-comfortable);
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-1-5);
  border-radius: var(--radius-sm);
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: var(--font-size-body);
}

.filter-option:hover {
  color: var(--color-text-primary);
  background: var(--color-surface-hover);
}

.filter-option:has(input:checked) {
  color: var(--color-text-primary);
  background: var(--color-accent-soft);
}

.filter-option input {
  width: var(--icon-size-sm);
  height: var(--icon-size-sm);
  flex: 0 0 auto;
  accent-color: var(--color-accent);
}

.filter-option > span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.filter-status-dot {
  width: var(--status-dot-size);
  height: var(--status-dot-size);
  flex: 0 0 auto;
  border-radius: var(--radius-full);
  background: var(--color-text-muted);
}

.filter-status-dot[data-status="active"],
.filter-status-dot[data-status="stable"] {
  background: var(--color-status-positive);
}

.filter-status-dot[data-status="preview"] {
  background: var(--color-accent);
}

.filter-status-dot[data-status="experimental"],
.filter-status-dot[data-status="legacy"],
.filter-status-dot[data-status="deprecated"] {
  background: var(--color-status-warning);
}

.filter-status-dot[data-status="retired"] {
  background: var(--color-status-danger);
}

.status-filter-label {
  text-transform: capitalize;
}

@supports (position-area: bottom) {
  .filter-popover {
    inset: auto;
    position-area: bottom span-left;
    margin-top: var(--space-1-5);
  }
}

@keyframes reveal-filter-popover {
  from {
    translate: 0 calc(var(--reveal-distance-compact) * -1);
    opacity: var(--opacity-hidden);
  }
}

@media (width <= 820px) {
  .filter-popover {
    top: calc(
      var(--layout-header-height) + var(--layout-toolbar-height) + var(--layout-toolbar-height) +
        6px
    );
  }

  @supports (position-area: bottom) {
    .filter-popover {
      top: auto;
    }
  }
}

@media (width <= 580px) {
  .filter-popover {
    right: 8px;
    width: calc(100vw - var(--space-4));
  }

  @supports (position-area: bottom) {
    .filter-popover {
      position-area: bottom;
    }
  }
}
</style>
