import { onMounted, shallowRef } from "vue";
import { isSourceIconPath, sourceIconIndexPath } from "../source-icon-paths.ts";

const icons = shallowRef<ReadonlyMap<string, string>>(new Map());
let requested = false;

export function useSourceIcons() {
  onMounted(() => {
    if (requested) return;
    requested = true;
    void loadIcons().catch(() => {
      requested = false;
    });
  });
  return icons;
}

async function loadIcons(): Promise<void> {
  const response = await fetch(sourceIconIndexPath);
  if (!response.ok) throw new Error("Source icon index unavailable");
  const data: unknown = await response.json();
  if (data === null || typeof data !== "object" || Array.isArray(data)) return;
  icons.value = new Map(
    Object.entries(data).flatMap(([origin, path]) =>
      isSourceIconPath(path) ? [[origin, path] as const] : [],
    ),
  );
}
