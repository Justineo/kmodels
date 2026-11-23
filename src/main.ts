import { createVaporApp } from "vue";
import App from "./App.vue";
import { WEBSITE_CORE_CHUNK_MAX_BYTES } from "./catalog/website-core.ts";
import { loadWebsiteCatalog } from "./catalog/website-runtime.ts";
import { prepareOverlayScrollbars } from "./composables/useOverlayScrollbars.ts";
import "./tokens.css";
import "./style.css";

const textEncoder = new TextEncoder();

async function json(path: string): Promise<unknown> {
  const isContentAddressed = path.startsWith("/ui/catalog/chunks/");
  const response = await fetch(path, {
    ...(isContentAddressed ? {} : { cache: "no-cache" as const }),
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Catalog request failed with ${response.status}`);
  const source = await response.text();
  if (textEncoder.encode(source).byteLength > WEBSITE_CORE_CHUNK_MAX_BYTES)
    throw new Error("Website core asset exceeds the chunk limit");
  return JSON.parse(source);
}

try {
  const [catalog] = await Promise.all([
    loadWebsiteCatalog(json),
    prepareOverlayScrollbars(),
    import("./icons/sprite.ts").then(({ installIconSprite }) => installIconSprite()),
  ]);
  createVaporApp(App, { catalog }).mount("#app");
} catch (error) {
  console.error(error);
  const root = document.querySelector("#app");
  if (root !== null) {
    root.className = "fallback";
    root.textContent = "Catalog unavailable.";
  }
}
