import { fileURLToPath } from "node:url";
import { build, type Plugin } from "vite-plus";
import { describe, expect, it } from "vite-plus/test";

function rejectNodeImports(): Plugin {
  return {
    name: "reject-node-imports",
    enforce: "pre",
    resolveId(source, importer) {
      if (source.startsWith("node:"))
        this.error(`${source} reached the browser graph from ${importer ?? "the entry point"}`);
      return undefined;
    },
  };
}

describe("browser module boundary", () => {
  it("keeps the calculator independent of presentation and website modules", async () => {
    await expect(
      build({
        configFile: false,
        logLevel: "silent",
        plugins: [
          rejectNodeImports(),
          {
            name: "reject-calculator-presentation-imports",
            enforce: "pre",
            resolveId(source, importer) {
              if (
                /(?:^|\/)(?:pricing-presentation|presentation|website-[^/]+)\.ts$/.test(source) ||
                source.includes("/components/")
              )
                this.error(
                  `${source} reached the calculator graph from ${importer ?? "the entry point"}`,
                );
              return undefined;
            },
          },
        ],
        build: {
          write: false,
          rollupOptions: {
            input: fileURLToPath(new URL("../src/pricing/index.ts", import.meta.url)),
          },
        },
      }),
    ).resolves.toBeDefined();
  });

  it("keeps pricing presentation free of Node-only dependencies", async () => {
    await expect(
      build({
        configFile: false,
        logLevel: "silent",
        plugins: [rejectNodeImports()],
        build: {
          write: false,
          rollupOptions: {
            input: fileURLToPath(
              new URL("../src/catalog/pricing-presentation.ts", import.meta.url),
            ),
          },
        },
      }),
    ).resolves.toBeDefined();
  });
});
