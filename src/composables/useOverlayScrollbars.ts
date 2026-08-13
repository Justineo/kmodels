import type { OverlayScrollbars as OverlayScrollbarsInstance } from "overlayscrollbars";
import { onMounted, onUnmounted } from "vue";

interface ScrollbarElements {
  target: HTMLElement | null;
  viewport: HTMLElement | null;
  slot?: HTMLElement | null;
  axis?: "both" | "horizontal" | "vertical";
}

const CUSTOM_SCROLL_QUERY = "(any-hover: hover) and (any-pointer: fine)";
const COARSE_TOUCH_QUERY = "(any-hover: none) and (any-pointer: coarse)";
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
  if (!prefersNativeScrollbars() || window.matchMedia(COARSE_TOUCH_QUERY).matches)
    await loadOverlayScrollbars();
}

export function useOverlayScrollbars(elements: () => ScrollbarElements): () => void {
  let instance: OverlayScrollbarsInstance | undefined;
  let instanceSlot: HTMLElement | null = null;
  let instanceMode: "standard" | "horizontal" | "vertical" | undefined;
  let mediaQueries: MediaQueryList[] = [];
  let syncVersion = 0;

  async function syncCurrent(version: number): Promise<void> {
    const { target, viewport, slot = null, axis = "both" } = elements();
    const coarseTouch = axis !== "both" && window.matchMedia(COARSE_TOUCH_QUERY).matches;
    const mode = coarseTouch ? axis : "standard";
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
    mediaQueries = [window.matchMedia(CUSTOM_SCROLL_QUERY), window.matchMedia(COARSE_TOUCH_QUERY)];
    for (const query of mediaQueries) query.addEventListener("change", sync);
    sync();
  });

  onUnmounted(() => {
    syncVersion += 1;
    for (const query of mediaQueries) query.removeEventListener("change", sync);
    instance?.destroy();
    instanceSlot = null;
    instanceMode = undefined;
  });

  return sync;
}
