<script setup lang="ts" vapor>
import { computed, ref, useTemplateRef, watchPostEffect } from "vue";
import UiSelect from "./UiSelect.vue";

interface ChoiceOption {
  value: string;
  label: string;
  disabled?: boolean;
}

const props = defineProps<{
  id: string;
  options: ChoiceOption[];
  /** An explicit meaning for the empty value needs a visible dropdown entry. */
  emptyLabel?: string | undefined;
}>();

const selected = defineModel<string>({ required: true });

// Segments stay readable only for a handful of options; larger sets always use the dropdown.
const segmentable = computed(() => props.emptyLabel === undefined && props.options.length <= 5);
// The server render and first client render assume segments fit; measurement then decides.
const fits = ref(true);
const segmented = computed(() => segmentable.value && fits.value);
const root = useTemplateRef<HTMLDivElement>("root");
const segments = useTemplateRef<HTMLDivElement>("segments");

watchPostEffect((onCleanup) => {
  const container = root.value;
  const track = segments.value;
  if (!container || !track) return;
  const updateFit = () => {
    if (container.clientWidth) fits.value = track.offsetWidth <= container.clientWidth;
  };
  const observer = new ResizeObserver(updateFit);
  observer.observe(container);
  observer.observe(track);
  updateFit();
  onCleanup(() => observer.disconnect());
});

// Selecting the active segment again clears it, like the dropdown placeholder entry.
function choose(value: string): void {
  selected.value = selected.value === value ? "" : value;
}
</script>

<template>
  <div ref="root" class="ui-choice">
    <div
      v-if="segmentable"
      ref="segments"
      :id="segmented ? id : undefined"
      :inert="!segmented"
      class="ui-segments"
      role="radiogroup"
      :aria-labelledby="`${id}-label`"
    >
      <label v-for="option in options" :key="option.value" class="ui-segment" :title="option.label">
        <input
          class="visually-hidden"
          type="radio"
          :name="id"
          :value="option.value"
          :checked="selected === option.value"
          :disabled="option.disabled"
          @click="choose(option.value)"
        />
        <span>{{ option.label }}</span>
      </label>
    </div>
    <UiSelect
      v-if="!segmented"
      :id="id"
      v-model="selected"
      :options="options"
      :placeholder="emptyLabel ?? 'Choose…'"
    />
  </div>
</template>

<style scoped>
.ui-choice {
  position: relative;
  width: 100%;
  height: var(--control-height-default);
  min-width: 0;
}

.ui-segments {
  display: inline-grid;
  width: max-content;
  grid-auto-columns: max-content;
  grid-auto-flow: column;
  height: var(--control-height-default);
  padding: var(--space-0-5);
  gap: var(--space-0-5);
  border: var(--stroke-hairline) solid var(--segmented-track-border);
  border-radius: var(--radius-md);
  background: var(--segmented-track);
  font-size: var(--font-size-meta);
  font-weight: var(--font-weight-medium);
  vertical-align: top;
}

/* Keep measuring the track while the dropdown occupies the same space. */
.ui-choice:has(.ui-segments[inert]) {
  overflow: clip;
  overflow-clip-margin: var(--stroke-focus);
}
.ui-segments[inert] {
  position: absolute;
  top: 0;
  left: 0;
  visibility: hidden;
}

.ui-segment {
  position: relative;
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: center;
  padding-inline: var(--space-2-5);
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
  line-height: var(--line-height-control);
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  transition:
    color var(--duration-fast) var(--easing-standard),
    background-color var(--duration-fast) var(--easing-standard),
    box-shadow var(--duration-fast) var(--easing-standard);
}

.ui-segment > span {
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Hairline dividers separate resting segments and disappear beside the raised one. */
.ui-segment + .ui-segment::before {
  position: absolute;
  top: 25%;
  bottom: 25%;
  left: calc(var(--space-0-5) / -2 - var(--stroke-hairline) / 2);
  width: var(--stroke-hairline);
  background: var(--segmented-divider);
  content: "";
  transition: opacity var(--duration-fast) var(--easing-standard);
}

.ui-segment:has(input:checked)::before,
.ui-segment:has(input:checked) + .ui-segment::before,
.ui-segment:hover::before,
.ui-segment:hover + .ui-segment::before {
  opacity: var(--opacity-hidden);
}

.ui-segment:hover {
  color: var(--color-text-primary);
  background: var(--color-control-hover);
}

.ui-segment:has(input:checked) {
  color: var(--color-text-primary);
  background: var(--segmented-thumb);
  box-shadow: var(--shadow-segmented-thumb);
}

.ui-segment:has(input:focus-visible) {
  outline: var(--stroke-focus) solid var(--color-accent);
  outline-offset: calc(var(--stroke-focus) * -1);
}

.ui-segment:has(input:disabled) {
  color: var(--color-text-muted);
  background: var(--color-transparent);
  opacity: var(--opacity-subdued);
  cursor: not-allowed;
}
</style>
