import { readFileSync } from "node:fs";
import vue from "@vitejs/plugin-vue";
import { defineConfig, type Plugin } from "vite-plus";
import { catalogAssets } from "./src/catalog/endpoints.ts";
import { catalogSchema, migrateCatalogStorage } from "./src/catalog/schema.ts";

function catalogPlugins(): Plugin[] {
  const catalog = catalogSchema.parse(
    migrateCatalogStorage(
      JSON.parse(readFileSync(new URL("./data/catalog.json", import.meta.url), "utf8")),
    ),
  );
  const assets = catalogAssets(catalog);
  const byPath = new Map(assets.map((asset) => [`/${asset.fileName}`, asset.source]));
  return [
    {
      name: "kmodels-catalog-build",
      apply: "build",
      buildStart() {
        for (const asset of assets)
          this.emitFile({ type: "asset", fileName: asset.fileName, source: asset.source });
      },
    },
    {
      name: "kmodels-catalog-serve",
      apply: "serve",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const path = new URL(request.url ?? "/", "http://localhost").pathname;
          const source = byPath.get(path);
          if (source === undefined) {
            next();
            return;
          }
          response.statusCode = 200;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(source);
        });
      },
    },
  ];
}

export default defineConfig({
  plugins: [...catalogPlugins(), vue()],
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
