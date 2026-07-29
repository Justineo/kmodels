<script setup lang="ts" vapor>
import { computed } from "vue";
import UiIcon from "./UiIcon.vue";

interface SelectOption {
  value: string;
  label: string;
}

const props = defineProps<{
  id?: string;
  options: SelectOption[];
  placeholder: string;
}>();

const selected = defineModel<string>({ required: true });
const selectedOption = computed(() =>
  props.options.find((option) => option.value === selected.value),
);
</script>

<template>
  <div class="ui-select-control">
    <select :id="id" v-model="selected" class="ui-select">
      <option value="">
        <slot name="placeholder-prefix"></slot>
        <span class="ui-select-option-label">{{ placeholder }}</span>
      </option>
      <option v-for="option in options" :key="option.value" :value="option.value">
        <slot name="option-prefix" :option="option"></slot>
        <span class="ui-select-option-label">{{ option.label }}</span>
      </option>
    </select>
    <span class="ui-select-value" aria-hidden="true">
      <slot name="value-prefix" :option="selectedOption"></slot>
      <span class="ui-select-option-label">{{ selectedOption?.label ?? placeholder }}</span>
      <UiIcon class="ui-select-chevron" name="chevron-down" />
    </span>
  </div>
</template>

<style scoped>
.ui-select-control {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
}

.ui-select {
  width: 100%;
  height: 100%;
  min-width: 0;
  border: 0;
  border-radius: var(--radius-none);
  outline: none;
  color: var(--color-text-primary);
  background: var(--color-transparent);
  font: inherit;
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-control);
  text-align: left;
}

.ui-select,
.ui-select::picker(select) {
  appearance: base-select;
}

.ui-select-value {
  display: none;
}

.ui-select-chevron {
  width: var(--icon-size-sm);
  height: var(--icon-size-sm);
  flex: 0 0 auto;
  color: var(--color-text-muted);
  transition: rotate var(--duration-standard) var(--easing-standard);
}

.ui-select:open + .ui-select-value .ui-select-chevron {
  rotate: 180deg;
}

.ui-select::picker-icon {
  display: none;
}

.ui-select::picker(select) {
  max-height: min(var(--layout-select-max-height), 52svh);
  padding: var(--space-1);
  border: var(--stroke-hairline) solid var(--color-border-default);
  border-radius: var(--floating-surface-radius);
  margin-block: var(--space-1-5);
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-color: var(--color-border-default) var(--color-transparent);
  scrollbar-width: thin;
  color: var(--color-text-primary);
  background: var(--color-surface);
  box-shadow: var(--shadow-popover);
}

.ui-select:open::picker(select) {
  animation: reveal-select-menu var(--duration-standard) var(--easing-enter);
}

.ui-select option {
  display: flex;
  min-height: var(--control-height-comfortable);
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1-5) var(--space-2);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  font-size: var(--font-size-body);
  line-height: var(--line-height-control);
  text-align: left;
}

.ui-select option:hover,
.ui-select option:focus-visible {
  outline: var(--space-0);
  color: var(--color-text-primary);
  background: var(--color-surface-hover);
}

.ui-select option:checked {
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

.ui-select option::checkmark {
  order: 1;
  margin-left: auto;
}

.ui-select-option-label {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@supports (appearance: base-select) {
  .ui-select {
    padding: var(--space-0);
    color: var(--color-transparent);
  }

  .ui-select-value {
    position: absolute;
    inset: 0;
    display: flex;
    min-width: 0;
    align-items: center;
    gap: var(--space-2);
    padding-inline: var(--space-2);
    pointer-events: none;
    color: var(--color-text-primary);
    line-height: var(--line-height-control);
  }
}
</style>
