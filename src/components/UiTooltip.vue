<script setup lang="ts" vapor>
import { computed, onBeforeUnmount, ref, useAttrs, useId } from "vue";
import {
  shouldOpenTooltipOnClick,
  tooltipCoordinator,
  type TooltipClient,
  type TooltipTrigger,
} from "../composables/tooltip.ts";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    as?: TooltipTrigger;
    content?: string;
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
let activationOpen = false;
let pointerDownType: string | undefined;
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
    activationOpen = false;
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
  release();
}

function handlePointerDown(event: PointerEvent): void {
  pointerDownType = event.pointerType;
}

function clearPointerDown(): void {
  pointerDownType = undefined;
}

function handleFocusIn(): void {
  focused.value = true;
  request(true);
}

function handleFocusOut(event: FocusEvent): void {
  const next = event.relatedTarget;
  if (next instanceof Node && trigger.value?.contains(next)) return;
  focused.value = false;
  clearPointerDown();
  release();
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape" || !open.value) return;
  event.stopPropagation();
  hovered.value = false;
  focused.value = false;
  tooltipCoordinator.release(client);
}

function handleClick(event: MouseEvent): void {
  const clickPointerType =
    "pointerType" in event && typeof event.pointerType === "string" ? event.pointerType : undefined;
  const pointerType = event.detail > 0 ? clickPointerType || pointerDownType : undefined;
  const shouldOpen = shouldOpenTooltipOnClick(props.as, activationOpen, pointerType);
  clearPointerDown();

  if (shouldOpen) {
    activationOpen = true;
    if (props.as === "button") {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
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
    class="ui-tooltip-trigger"
    v-bind="attrs"
    :aria-describedby="describedBy || undefined"
    :data-tooltip-open="open || undefined"
    :style="triggerStyle"
    @pointerenter="handlePointerEnter"
    @pointerleave="handlePointerLeave"
    @pointerdown="handlePointerDown"
    @pointercancel="clearPointerDown"
    @focusin="handleFocusIn"
    @focusout="handleFocusOut"
    @keydown="handleKeydown"
    @click.capture="handleClick"
  >
    <slot></slot>
  </component>
  <Teleport to="#tooltip-layer">
    <div v-if="open" :id="tooltipId" class="ui-tooltip" :style="tooltipStyle" role="tooltip">
      <slot name="content">{{ content }}</slot>
    </div>
  </Teleport>
</template>

<style scoped>
span.ui-tooltip-trigger {
  display: inline-block;
  width: fit-content;
}

.ui-tooltip {
  position: fixed;
  position-area: block-start;
  position-try-fallbacks:
    flip-block,
    flip-inline,
    flip-block flip-inline;
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
  pointer-events: auto;
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
