<script setup lang="ts" vapor>
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef } from "vue";
import type { Provider } from "../catalog/schema.ts";
import { useOverlayScrollbars } from "../composables/useOverlayScrollbars.ts";
import ProviderIcon from "./ProviderIcon.vue";
import UiIcon from "./UiIcon.vue";

const props = defineProps<{
  modelValue: string;
  options: Provider[];
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const trigger = useTemplateRef<HTMLButtonElement>("trigger");
const menu = useTemplateRef<HTMLDialogElement>("menu");
const scrollHost = useTemplateRef<HTMLDivElement>("scrollHost");
const viewport = useTemplateRef<HTMLDivElement>("viewport");
const open = ref(false);
const selectedProvider = computed(() =>
  props.options.find((provider) => provider.id === props.modelValue),
);
const updateScrollbars = useOverlayScrollbars(() => ({
  target: scrollHost.value,
  viewport: viewport.value,
}));
let pendingFocus: "selected" | "first" | "last" = "selected";

function optionElements(): HTMLButtonElement[] {
  return [...(viewport.value?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
}

function positionMenu(): void {
  const button = trigger.value;
  const element = menu.value;
  if (button === null || element === null) return;

  const rect = button.getBoundingClientRect();
  const gutter = 8;
  const width = Math.min(Math.max(rect.width, 248), window.innerWidth - gutter * 2);
  const left = Math.min(Math.max(rect.left, gutter), window.innerWidth - width - gutter);
  const spaceBelow = window.innerHeight - rect.bottom - gutter;
  const spaceAbove = rect.top - gutter;
  const opensAbove = spaceBelow < 180 && spaceAbove > spaceBelow;
  const available = opensAbove ? spaceAbove : spaceBelow;

  element.style.left = `${left}px`;
  element.style.width = `${width}px`;
  element.style.setProperty(
    "--provider-menu-max-height",
    `${Math.max(80, Math.min(420, available - 6))}px`,
  );
  if (opensAbove) {
    element.style.top = "auto";
    element.style.bottom = `${window.innerHeight - rect.top + 6}px`;
  } else {
    element.style.top = `${rect.bottom + 6}px`;
    element.style.bottom = "auto";
  }
}

function focusOption(): void {
  const options = optionElements();
  if (options.length === 0) return;
  const selectedIndex = options.findIndex((option) => option.dataset.value === props.modelValue);
  const index =
    pendingFocus === "first"
      ? 0
      : pendingFocus === "last"
        ? options.length - 1
        : Math.max(0, selectedIndex);
  const option = options[index];
  option?.focus({ preventScroll: true });
  option?.scrollIntoView({ block: "nearest" });
  pendingFocus = "selected";
}

function showMenu(focus: "selected" | "first" | "last" = "selected"): void {
  const element = menu.value;
  if (element === null) return;
  pendingFocus = focus;
  if (!element.matches(":popover-open")) element.showPopover();
}

function handleTriggerKeydown(event: KeyboardEvent): void {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  showMenu(event.key === "ArrowDown" ? "first" : "last");
}

function handleToggle(event: ToggleEvent): void {
  open.value = event.newState === "open";
  if (!open.value) return;
  positionMenu();
  void nextTick(() => {
    updateScrollbars();
    focusOption();
  });
}

function select(value: string): void {
  emit("update:modelValue", value);
  menu.value?.hidePopover();
  trigger.value?.focus();
}

function handleOptionKeydown(event: KeyboardEvent): void {
  const options = optionElements();
  const current = event.target;
  if (!(current instanceof HTMLButtonElement)) return;
  const index = options.indexOf(current);
  if (index < 0) return;

  let nextIndex: number | undefined;
  switch (event.key) {
    case "ArrowDown":
      nextIndex = Math.min(index + 1, options.length - 1);
      break;
    case "ArrowUp":
      nextIndex = Math.max(index - 1, 0);
      break;
    case "Home":
      nextIndex = 0;
      break;
    case "End":
      nextIndex = options.length - 1;
      break;
    case "Tab":
      menu.value?.hidePopover();
      return;
    default:
      return;
  }

  event.preventDefault();
  options[nextIndex]?.focus();
  options[nextIndex]?.scrollIntoView({ block: "nearest" });
}

function repositionOpenMenu(): void {
  if (open.value) positionMenu();
}

onMounted(() => {
  window.addEventListener("resize", repositionOpenMenu);
});

onUnmounted(() => {
  window.removeEventListener("resize", repositionOpenMenu);
});
</script>

<template>
  <div class="select-field">
    <span class="select-label">Provider</span>
    <button
      ref="trigger"
      class="provider-select-trigger"
      :class="{ 'has-provider-icon': selectedProvider !== undefined }"
      type="button"
      popovertarget="provider-select-menu"
      aria-haspopup="listbox"
      aria-controls="provider-select-menu"
      :aria-expanded="open"
      @keydown="handleTriggerKeydown"
    >
      <ProviderIcon
        v-if="selectedProvider"
        :provider-id="selectedProvider.id"
        :provider-name="selectedProvider.name"
      />
      <span>{{ selectedProvider?.name ?? "All providers" }}</span>
      <UiIcon class="select-chevron" name="chevron-down" />
    </button>

    <dialog
      id="provider-select-menu"
      ref="menu"
      class="provider-select-menu"
      popover="auto"
      @toggle="handleToggle"
    >
      <div ref="scrollHost" class="provider-options-scroll" data-overlayscrollbars-initialize>
        <div
          ref="viewport"
          class="provider-options-viewport"
          role="listbox"
          aria-label="Provider"
          @keydown="handleOptionKeydown"
        >
          <button
            class="provider-option"
            :class="{ selected: modelValue === '' }"
            type="button"
            role="option"
            data-value=""
            :aria-selected="modelValue === ''"
            @click="select('')"
          >
            <span class="provider-option-placeholder" aria-hidden="true"></span>
            <span>All providers</span>
            <UiIcon v-if="modelValue === ''" name="check" />
          </button>
          <button
            v-for="provider in options"
            :key="provider.id"
            class="provider-option"
            :class="{ selected: modelValue === provider.id }"
            type="button"
            role="option"
            :data-value="provider.id"
            :aria-selected="modelValue === provider.id"
            @click="select(provider.id)"
          >
            <ProviderIcon :provider-id="provider.id" :provider-name="provider.name" />
            <span>{{ provider.name }}</span>
            <UiIcon v-if="modelValue === provider.id" name="check" />
          </button>
        </div>
      </div>
    </dialog>
  </div>
</template>
