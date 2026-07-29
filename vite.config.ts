import vue from "@vitejs/plugin-vue";
import { defineConfig, type Plugin } from "vite-plus";
import { catalogApiAssets, catalogAssets } from "./src/catalog/endpoints.ts";
import { recoverCatalogPair } from "./src/catalog/pricing-publication.ts";
import {
  websiteCatalog,
  websiteDetailRef,
  websiteModelDetail,
} from "./src/catalog/website-data.ts";

let developmentWebsiteData: ReturnType<typeof loadDevelopmentWebsiteData> | undefined;

async function loadDevelopmentWebsiteData() {
  const pair = await recoverCatalogPair();
  if (pair === undefined) throw new Error("No accepted catalog pair is available");
  return {
    catalog: pair.catalog,
    pricing: pair.pricing.data,
    pricingAssetSource: pair.pricingAssetSource,
    modelByDetailRef: new Map(
      pair.catalog.models.map((model) => [websiteDetailRef(model.uid), model]),
    ),
  };
}

async function developmentAsset(path: string): Promise<string | undefined> {
  if (
    path !== "/pricing/index.json" &&
    path !== "/catalog/index.json" &&
    !path.startsWith("/providers/") &&
    !path.startsWith("/ui/")
  )
    return undefined;

  developmentWebsiteData ??= loadDevelopmentWebsiteData();
  const { catalog, pricing, pricingAssetSource, modelByDetailRef } = await developmentWebsiteData;
  if (path === "/pricing/index.json") return pricingAssetSource;
  if (path.startsWith("/ui/")) {
    if (path === "/ui/catalog/index.json") return JSON.stringify(websiteCatalog(catalog, pricing));
    const reference = path.match(/^\/ui\/models\/([0-9a-f]{64})\.json$/)?.[1];
    if (reference === undefined) return undefined;
    const model = modelByDetailRef.get(reference);
    return model === undefined ? undefined : JSON.stringify(websiteModelDetail(pricing, model));
  }
  return new Map(
    catalogApiAssets(catalog).map((asset): [string, string] => [
      `/${asset.fileName}`,
      asset.source,
    ]),
  ).get(path);
}

function serveCatalog(): Plugin {
  return {
    name: "kmodels-catalog-serve",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = new URL(request.url ?? "/", "http://localhost").pathname;
        void developmentAsset(path)
          .then((source) => {
            if (source === undefined) {
              next();
              return;
            }
            response.statusCode = 200;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.end(source);
          })
          .catch(next);
      });
    },
  };
}

function buildCatalog(): Plugin {
  return {
    name: "kmodels-catalog-build",
    apply: "build",
    async buildStart() {
      const pair = await recoverCatalogPair();
      if (pair === undefined) throw new Error("No accepted catalog pair is available");
      for (const asset of catalogAssets(pair.catalog, pair.pricing)) {
        this.emitFile({ type: "asset", fileName: asset.fileName, source: asset.source });
      }
    },
  };
}

export default defineConfig({
  plugins: [buildCatalog(), serveCatalog(), vue()],
  fmt: {
    ignorePatterns: ["data/**"],
  },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
