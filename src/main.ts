import { createVaporApp } from "vue";
import App from "./App.vue";
import { parseWebsiteCatalog } from "./catalog/website-runtime.ts";
import { prepareOverlayScrollbars } from "./composables/useOverlayScrollbars.ts";
import "./tokens.css";
import "./style.css";

async function json(path: string, label: string): Promise<unknown> {
  const response = await fetch(path, {
    cache: "no-cache",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`${label} request failed with ${response.status}`);
  return response.json();
}

try {
  const [catalogValue, pricingValue] = await Promise.all([
    json("/ui/catalog/index.json", "Catalog"),
    json("/ui/catalog/pricing.json", "Pricing summary"),
    prepareOverlayScrollbars(),
    import("./icons/sprite.ts").then(({ installIconSprite }) => installIconSprite()),
  ]);
  const catalog = parseWebsiteCatalog(catalogValue, pricingValue);
  createVaporApp(App, { catalog }).mount("#app");
} catch (error) {
  console.error(error);
  const root = document.querySelector("#app");
  if (root !== null) {
    root.className = "fallback";
    root.textContent = "Catalog unavailable.";
  }
}
