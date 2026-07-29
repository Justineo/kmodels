import { createVaporApp } from "vue";
import "overlayscrollbars/overlayscrollbars.css";
import App from "./App.vue";
import { websiteCatalogSchema } from "./catalog/website-schema.ts";
import "./tokens.css";
import "./style.css";

try {
  const response = await fetch("/ui/catalog/index.json", {
    cache: "no-cache",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Catalog request failed with ${response.status}`);
  const catalog = websiteCatalogSchema.parse(await response.json());
  createVaporApp(App, { catalog }).mount("#app");
} catch (error) {
  console.error(error);
  const root = document.querySelector("#app");
  if (root !== null) {
    root.className = "fallback";
    root.textContent = "Catalog unavailable.";
  }
}
