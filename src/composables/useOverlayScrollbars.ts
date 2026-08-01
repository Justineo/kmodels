import type { OverlayScrollbars as OverlayScrollbarsInstance } from "overlayscrollbars";
import { onMounted, onUnmounted } from "vue";

interface ScrollbarElements {
  target: HTMLElement | null;
  viewport: HTMLElement | null;
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
  let media: MediaQueryList | undefined;
  let syncVersion = 0;

  async function syncCurrent(version: number): Promise<void> {
    const { target, viewport } = elements();
    if (target === null || viewport === null || prefersNativeScrollbars()) {
      instance?.destroy();
      instance = undefined;
      return;
    }
    const current = instance?.elements();
    if (target === current?.target && viewport === current?.viewport) {
      instance?.update();
      return;
    }

    const { OverlayScrollbars } = await loadOverlayScrollbars();
    if (version !== syncVersion || prefersNativeScrollbars()) return;
    const currentElements = elements();
    if (currentElements.target !== target || currentElements.viewport !== viewport) return;

    instance?.destroy();
    instance = OverlayScrollbars(
      {
        target,
        elements: { viewport },
      },
      {
        scrollbars: {
          autoHide: "leave",
          autoHideDelay: 240,
          theme: "kmodels-scrollbar",
        },
      },
    );
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
  });

  return sync;
}
