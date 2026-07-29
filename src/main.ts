import { createVaporApp } from "vue";
import App from "./App.vue";
import { parseWebsiteCatalog } from "./catalog/website-runtime.ts";
import "./tokens.css";
import "./style.css";

try {
  const response = await fetch("/ui/catalog/index.json", {
    cache: "no-cache",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Catalog request failed with ${response.status}`);
  const value: unknown = await response.json();
  const catalog = parseWebsiteCatalog(value);
  createVaporApp(App, { catalog }).mount("#app");
} catch (error) {
  console.error(error);
  const root = document.querySelector("#app");
  if (root !== null) {
    root.className = "fallback";
    root.textContent = "Catalog unavailable.";
  }
}
