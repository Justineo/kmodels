import {
  OverlayScrollbars,
  type OverlayScrollbars as OverlayScrollbarsInstance,
} from "overlayscrollbars";
import { onMounted, onUnmounted } from "vue";

interface ScrollbarElements {
  target: HTMLElement | null;
  viewport: HTMLElement | null;
}

export function useOverlayScrollbars(elements: () => ScrollbarElements): () => void {
  let instance: OverlayScrollbarsInstance | undefined;

  function sync(): void {
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

  onMounted(sync);

  onUnmounted(() => {
    instance?.destroy();
  });

  return sync;
}
