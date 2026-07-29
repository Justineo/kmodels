import type { OverlayScrollbars as OverlayScrollbarsInstance } from "overlayscrollbars";
import { onMounted, onUnmounted } from "vue";
import { afterFirstPaint } from "../after-first-paint.ts";

interface ScrollbarElements {
  target: HTMLElement | null;
  viewport: HTMLElement | null;
}

export function useOverlayScrollbars(elements: () => ScrollbarElements): () => void {
  let instance: OverlayScrollbarsInstance | undefined;
  let disposed = false;

  async function syncAsync(): Promise<void> {
    await afterFirstPaint();
    const { OverlayScrollbars } = await import("./overlayScrollbarsRuntime.ts");
    if (disposed) return;
    const { target, viewport } = elements();
    if (target === null || viewport === null) {
      instance?.destroy();
      instance = undefined;
      return;
    }
    const current = instance?.elements();
    if (target === current?.target && viewport === current?.viewport) {
      instance?.update();
      return;
    }

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
    void syncAsync();
  }

  onMounted(sync);

  onUnmounted(() => {
    disposed = true;
    instance?.destroy();
  });

  return sync;
}
