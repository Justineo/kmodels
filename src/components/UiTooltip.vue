<script setup lang="ts" vapor>
import { computed, onBeforeUnmount, ref, useAttrs, useId } from "vue";
import { tooltipCoordinator, type TooltipClient } from "../composables/tooltip.ts";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    as?: "button" | "span";
    content: string;
  }>(),
  {
    as: "span",
  },
);

const attrs = useAttrs();
const trigger = ref<HTMLElement | null>(null);
const open = ref(false);
const hovered = ref(false);
const focused = ref(false);
const uid = useId().replaceAll(":", "");
const tooltipId = `tooltip-${uid}`;
const anchorName = `--tooltip-${uid}`;
const triggerStyle = { anchorName };
const tooltipStyle = { positionAnchor: anchorName };
let pointerActivationPending = false;
let focusOpenedForPointerClick = false;
const describedBy = computed(() => {
  const existing = attrs["aria-describedby"];
  return [typeof existing === "string" ? existing : undefined, open.value ? tooltipId : undefined]
    .filter((value): value is string => value !== undefined)
    .join(" ");
});
const client: TooltipClient = {
  show() {
    open.value = true;
  },
  hide() {
    open.value = false;
  },
};

onBeforeUnmount(() => {
  tooltipCoordinator.release(client);
});

function request(immediate = false): void {
  tooltipCoordinator.request(client, immediate);
}

function release(): void {
  if (!hovered.value && !focused.value) tooltipCoordinator.release(client);
}

function handlePointerEnter(): void {
  hovered.value = true;
  request();
}

function handlePointerLeave(): void {
  hovered.value = false;
  pointerActivationPending = false;
  release();
}

function handlePointerDown(): void {
  pointerActivationPending = true;
}

function handlePointerCancel(): void {
  pointerActivationPending = false;
}

function handleFocusIn(): void {
  if (!open.value) focusOpenedForPointerClick = pointerActivationPending;
  focused.value = true;
  request(true);
}

function handleFocusOut(event: FocusEvent): void {
  const next = event.relatedTarget;
  if (next instanceof Node && trigger.value?.contains(next)) return;
  focused.value = false;
  pointerActivationPending = false;
  focusOpenedForPointerClick = false;
  release();
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape" || !open.value) return;
  event.stopPropagation();
  hovered.value = false;
  focused.value = false;
  tooltipCoordinator.release(client);
}

function handleClick(): void {
  const keepFocusOpenedTooltip = props.as === "span" && focusOpenedForPointerClick;
  pointerActivationPending = false;
  focusOpenedForPointerClick = false;
  if (keepFocusOpenedTooltip) return;
  if (props.as === "span" && !open.value) {
    request(true);
    return;
  }
  tooltipCoordinator.release(client);
}
</script>

<template>
  <component
    :is="as"
    ref="trigger"
    v-bind="attrs"
    :aria-describedby="describedBy || undefined"
    :data-tooltip-open="open || undefined"
    :style="triggerStyle"
    @pointerenter="handlePointerEnter"
    @pointerleave="handlePointerLeave"
    @pointerdown="handlePointerDown"
    @pointercancel="handlePointerCancel"
    @focusin="handleFocusIn"
    @focusout="handleFocusOut"
    @keydown="handleKeydown"
    @click.capture="handleClick"
  >
    <slot></slot>
  </component>
  <Teleport to="#tooltip-layer">
    <span v-if="open" :id="tooltipId" class="ui-tooltip" :style="tooltipStyle" role="tooltip">
      {{ content }}
    </span>
  </Teleport>
</template>

<style scoped>
.ui-tooltip {
  position: fixed;
  position-area: block-start;
  position-try:
    flip-block,
    inline-start,
    inline-end,
    flip-block inline-start,
    flip-block inline-end;
  z-index: var(--layer-overlay);
  width: max-content;
  max-width: min(var(--layout-tooltip-width), calc(100vw - var(--space-4)));
  margin: var(--space-1-5);
  padding: var(--space-2) var(--space-2-5);
  border: var(--stroke-hairline) solid var(--color-border-default);
  border-radius: var(--floating-surface-radius);
  color: var(--color-text-secondary);
  background: var(--color-surface);
  box-shadow: var(--shadow-popover);
  font-size: var(--font-size-label);
  font-weight: var(--font-weight-regular);
  letter-spacing: var(--tracking-normal);
  line-height: var(--line-height-control);
  pointer-events: none;
  text-align: left;
  white-space: normal;
  animation: tooltip-reveal var(--duration-fast) var(--easing-enter);
}

@keyframes tooltip-reveal {
  from {
    opacity: var(--opacity-hidden);
    transform: translateY(var(--reveal-distance-compact));
  }
}
</style>
