import { createVaporApp } from "vue";
import App from "./App.vue";
import { loadWebsiteCatalog } from "./catalog/website-runtime.ts";
import { prepareOverlayScrollbars } from "./composables/useOverlayScrollbars.ts";
import "./tokens.css";
import "./style.css";

async function json(path: string): Promise<unknown> {
  const response = await fetch(path, {
    cache: "no-cache",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Catalog request failed with ${response.status}`);
  return response.json();
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
