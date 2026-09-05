import { execFileSync } from "node:child_process";
import vue from "@vitejs/plugin-vue";
import { defineConfig, type Plugin } from "vite-plus";
import {
  materializePublishedAssets,
  readCompressedProfileAsset,
  readPublishedAssetProfile,
  readPublishedAssets,
  type PublishedAssetProfile,
} from "./src/catalog/published-assets.ts";
import { defaultProjectionPaths } from "./src/catalog/projection-paths.ts";
import { catalogUpdateUrl, type CatalogRevision } from "./src/catalog/update-link.ts";
import { generatedDataTests } from "./tests/generated-data-tests.ts";

const repositoryUrl = "https://github.com/Justineo/kmodels";
let developmentUiAssets: Promise<PublishedAssetProfile> | undefined;
let developmentExportAssets: Promise<PublishedAssetProfile> | undefined;

function gitOutput(arguments_: string[]): string | undefined {
  try {
    return execFileSync("git", arguments_, { encoding: "utf8" });
  } catch {
    return undefined;
  }
}

function catalogRevision(): CatalogRevision {
  const log = gitOutput([
    "log",
    "-1",
    "--format=%H%x00%(trailers:key=Kmodels-Refresh-Run,valueonly)",
    "--",
    "data/catalog.json",
  ]);
  const separator = log?.indexOf("\0") ?? -1;
  if (log !== undefined && separator >= 0) {
    const commitSha = log.slice(0, separator).trim();
    const actionRunUrl = log.slice(separator + 1).trim();
    return {
      commitSha,
      ...(actionRunUrl === "" ? {} : { actionRunUrl }),
    };
  }

  const commitSha = gitOutput(["rev-parse", "HEAD"])?.trim();
  if (commitSha === undefined) throw new Error("Unable to resolve the catalog revision");
  return { commitSha };
}

const updatedUrl = catalogUpdateUrl(repositoryUrl, catalogRevision());

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
      const assetProfiles = new Map<string, "ui" | "exports">([
        [defaultProjectionPaths.uiManifest, "ui"],
        [defaultProjectionPaths.uiPack, "ui"],
        [defaultProjectionPaths.exportManifest, "exports"],
        [defaultProjectionPaths.exportPack, "exports"],
      ]);
      let reloadTimer: ReturnType<typeof setTimeout> | undefined;

      function invalidatePublishedAssets(path: string): void {
        const profile = assetProfiles.get(path);
        if (profile === "ui") {
          developmentUiAssets = undefined;
          if (reloadTimer !== undefined) clearTimeout(reloadTimer);
          reloadTimer = setTimeout(() => {
            server.ws.send({ type: "full-reload", path: "*" });
            reloadTimer = undefined;
          }, 50);
        }
        if (profile === "exports") developmentExportAssets = undefined;
      }

      server.watcher.add([...assetProfiles.keys()]);
      server.watcher.on("change", invalidatePublishedAssets);
      server.httpServer?.once("close", () => {
        server.watcher.off("change", invalidatePublishedAssets);
        if (reloadTimer !== undefined) clearTimeout(reloadTimer);
      });
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
  define: {
    __KMODELS_CATALOG_UPDATE_URL__: JSON.stringify(updatedUrl),
  },
  fmt: {
    ignorePatterns: ["data/**", ".github/workflows/*.lock.yml"],
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
          setupFiles: ["./tests/setup.ts", "./tests/setup-unit.ts"],
          include: ["tests/**/*.test.ts"],
          exclude: generatedDataTests,
        },
      },
      {
        extends: true,
        test: {
          name: "generated",
          setupFiles: ["./tests/setup.ts"],
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
