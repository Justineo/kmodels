import vue from "@vitejs/plugin-vue";
import { defineConfig, type Plugin } from "vite-plus";
import {
  materializePublishedAssets,
  readCompressedProfileAsset,
  readPublishedAssetProfile,
  readPublishedAssets,
  type PublishedAssetProfile,
} from "./src/catalog/published-assets.ts";

const generatedDataTests = [
  "tests/catalog.test.ts",
  "tests/pricing-bedrock-calibration.test.ts",
  "tests/pricing-provider-calibration.test.ts",
  "tests/website-data.test.ts",
];

let developmentUiAssets: Promise<PublishedAssetProfile> | undefined;
let developmentExportAssets: Promise<PublishedAssetProfile> | undefined;

async function developmentAsset(path: string): Promise<Uint8Array | undefined> {
  if (path.startsWith("/ui/")) {
    developmentUiAssets ??= readPublishedAssetProfile("ui");
    return readCompressedProfileAsset(await developmentUiAssets, path);
  }
  if (!/^\/(?:catalog|pricing|providers)\//u.test(path)) return undefined;
  developmentExportAssets ??= readPublishedAssetProfile("exports");
  return readCompressedProfileAsset(await developmentExportAssets, path);
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
            response.setHeader("Content-Encoding", "gzip");
            response.setHeader("Vary", "Accept-Encoding");
            response.end(source);
          })
          .catch(next);
      });
    },
  };
}

function buildCatalog(): Plugin {
  let published: ReturnType<typeof readPublishedAssets> | undefined;
  return {
    name: "kmodels-catalog-build",
    apply: "build",
    async buildStart() {
      published ??= readPublishedAssets();
      await published;
    },
    async writeBundle({ dir }) {
      if (dir === undefined) throw new Error("Vite output directory is unavailable");
      published ??= readPublishedAssets();
      await materializePublishedAssets(await published, dir);
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
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/**/*.test.ts"],
          exclude: generatedDataTests,
        },
      },
      {
        extends: true,
        test: {
          name: "generated",
          include: generatedDataTests,
          isolate: false,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("/node_modules/vue/") ||
            id.includes("/node_modules/@vue/") ||
            id.includes("/node_modules/.pnpm/@vue+")
          )
            return "vue";
          if (id.includes("/node_modules/zod/")) return "validation";
          if (id.includes("/node_modules/overlayscrollbars/")) return "scrollbars";
          return undefined;
        },
      },
    },
  },
});
