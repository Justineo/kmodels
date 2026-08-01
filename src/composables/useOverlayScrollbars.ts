import type { OverlayScrollbars as OverlayScrollbarsInstance } from "overlayscrollbars";
import { onMounted, onUnmounted } from "vue";

interface ScrollbarElements {
  target: HTMLElement | null;
  viewport: HTMLElement | null;
  slot?: HTMLElement | null;
  coarseTouch?: boolean;
  axis?: "both" | "horizontal" | "vertical";
}

const CUSTOM_SCROLL_QUERY = "(any-hover: hover) and (any-pointer: fine)";
let overlayScrollbarsModule: Promise<typeof import("overlayscrollbars")> | undefined;

function prefersNativeScrollbars(): boolean {
  return !window.matchMedia(CUSTOM_SCROLL_QUERY).matches;
}

async function loadOverlayScrollbars(): Promise<typeof import("overlayscrollbars")> {
  overlayScrollbarsModule ??= Promise.all([
    import("overlayscrollbars"),
    import("overlayscrollbars/overlayscrollbars.css"),
  ]).then(([module]) => module);
  return overlayScrollbarsModule;
}

export async function prepareOverlayScrollbars(): Promise<void> {
  if (!prefersNativeScrollbars()) await loadOverlayScrollbars();
}

export function useOverlayScrollbars(elements: () => ScrollbarElements): () => void {
  let instance: OverlayScrollbarsInstance | undefined;
  let instanceSlot: HTMLElement | null = null;
  let instanceMode: "standard" | "horizontal" | "vertical" | undefined;
  let media: MediaQueryList | undefined;
  let syncVersion = 0;

  async function syncCurrent(version: number): Promise<void> {
    const { target, viewport, slot = null, coarseTouch = false, axis = "both" } = elements();
    const mode = coarseTouch && axis !== "both" ? axis : "standard";
    if (target === null || viewport === null || (prefersNativeScrollbars() && !coarseTouch)) {
      instance?.destroy();
      instance = undefined;
      instanceSlot = null;
      instanceMode = undefined;
      return;
    }
    const current = instance?.elements();
    if (
      target === current?.target &&
      viewport === current?.viewport &&
      slot === instanceSlot &&
      mode === instanceMode
    ) {
      instance?.update();
      return;
    }

    const { OverlayScrollbars } = await loadOverlayScrollbars();
    if (version !== syncVersion) return;
    const currentElements = elements();
    if (
      currentElements.target !== target ||
      currentElements.viewport !== viewport ||
      (currentElements.slot ?? null) !== slot ||
      (currentElements.coarseTouch ?? false) !== coarseTouch ||
      (currentElements.axis ?? "both") !== axis ||
      (prefersNativeScrollbars() && !coarseTouch)
    )
      return;

    instance?.destroy();
    const initialization =
      slot === null
        ? { target, elements: { viewport } }
        : { target, elements: { viewport }, scrollbars: { slot } };
    const options = coarseTouch
      ? {
          overflow:
            axis === "horizontal"
              ? { x: "scroll" as const, y: "hidden" as const }
              : { x: "hidden" as const, y: "scroll" as const },
          scrollbars: {
            autoHide: "never" as const,
            clickScroll: "instant" as const,
            dragScroll: true,
            pointers: ["mouse", "touch", "pen"],
            theme: "kmodels-scrollbar",
          },
        }
      : {
          scrollbars: {
            autoHide: "leave" as const,
            autoHideDelay: 240,
            theme: "kmodels-scrollbar",
          },
        };
    instance = OverlayScrollbars(initialization, options);
    instanceSlot = slot;
    instanceMode = mode;
  }

  function sync(): void {
    syncVersion += 1;
    void syncCurrent(syncVersion);
  }

  onMounted(() => {
    media = window.matchMedia(CUSTOM_SCROLL_QUERY);
    media.addEventListener("change", sync);
    sync();
  });

  onUnmounted(() => {
    syncVersion += 1;
    media?.removeEventListener("change", sync);
    instance?.destroy();
    instanceSlot = null;
    instanceMode = undefined;
  });

  return sync;
}
