import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vite-plus/test";
import {
  readSourceIconCache,
  sourceIconAssets,
  sourceIconCacheFile,
} from "../src/catalog/source-icon-cache.ts";
import { sha256 } from "../src/catalog/io.ts";
import { refreshSourceIcons } from "../src/catalog/source-icons.ts";
import type { CapabilityDetailGroup } from "../src/catalog/model-capability-details.ts";
import { sourceIconIndexPath } from "../src/source-icon-paths.ts";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQioAAAAASUVORK5CYII=";
const openAI = "https://developers.openai.com";
const deepSeek = "https://api-docs.deepseek.com";
const xAI = "https://docs.x.ai";
const kimi = "https://platform.kimi.ai";
const anthropic = "https://platform.claude.com";

function claim(source_ref: string, ...urls: string[]): CapabilityDetailGroup {
  return {
    source_ref,
    claim: "reasoning",
    statements: [{ kind: "reasoning_effort", scope: "Responses API", supported_values: ["low"] }],
    evidence: urls.map((document_url) => ({
      document_url,
      locator: "Reasoning",
      observed_at: "2026-11-21T00:00:00Z",
      content_hash: "a".repeat(64),
      excerpt: "Reasoning",
    })),
  };
}

it("discovers by reviewed origin, refreshes valid bytes, and retains only available icons", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kmodels-source-icons-"));
  try {
    const path = join(directory, sourceIconCacheFile);
    const pngBytes = Buffer.from(png, "base64");
    const iconHeader = Buffer.alloc(22);
    iconHeader.writeUInt32LE(0x00010000);
    iconHeader.writeUInt16LE(1, 4);
    iconHeader.writeUInt32LE(pngBytes.length, 14);
    iconHeader.writeUInt32LE(iconHeader.length, 18);
    const icoBytes = Buffer.concat([iconHeader, pngBytes]);
    const ico = icoBytes.toString("base64");
    await writeFile(path, JSON.stringify({ [openAI]: ico, [deepSeek]: png, [anthropic]: png }));
    const request = vi.fn<(url: URL) => Promise<Response>>(async (url) => {
      switch (url.href) {
        case `${openAI}/`:
          return new Response(
            '<head><link rel="icon" href="https://unreviewed.example/icon.png"><link rel="icon" href="/favicon.png"></head>',
          );
        case `${openAI}/favicon.png`:
          return new Response(pngBytes);
        case `${xAI}/favicon.ico`:
          return new Response(icoBytes);
        case `${deepSeek}/`:
          return Response.redirect("https://unreviewed.example/");
        case `${deepSeek}/favicon.ico`:
          return new Response("<html>Not an icon</html>", { status: 200 });
        case `${kimi}/`:
          throw new Error("Offline");
        default:
          return new Response(null, { status: 404 });
      }
    });
    vi.stubGlobal("fetch", request);
    await refreshSourceIcons(
      [
        { capability_details: [claim("openai-models", `${openAI}/models/a.md`)] },
        {
          capability_details: [
            claim(
              "openai-models",
              `${openAI}/models/b.md`,
              `${openAI}/models/c`,
              "https://unreviewed.example/model.md",
            ),
            claim("deepseek-catalog", `${deepSeek}/models`),
            claim("xai-models", `${xAI}/model.json`),
            claim("kimi-openapi", `${kimi}/models`),
          ],
        },
      ],
      path,
    );
    const urls = request.mock.calls.map(([url]) => url.href);
    expect(urls.toSorted()).toEqual(
      [
        `${openAI}/`,
        `${openAI}/favicon.png`,
        `${deepSeek}/`,
        `${deepSeek}/favicon.ico`,
        `${xAI}/`,
        `${xAI}/favicon.ico`,
        `${kimi}/`,
        `${kimi}/favicon.ico`,
      ].toSorted(),
    );
    expect(await readSourceIconCache(path)).toEqual({ [openAI]: png, [deepSeek]: png, [xAI]: ico });
    const assets = await sourceIconAssets(path);
    const pngPath = `/source-icons/${sha256(pngBytes)}.png`;
    const icoPath = `/source-icons/${sha256(icoBytes)}.ico`;
    expect(assets.get(pngPath)).toEqual(pngBytes);
    expect(assets.get(icoPath)).toEqual(icoBytes);
    expect(assets.get(sourceIconIndexPath)?.toString()).toBe(
      JSON.stringify({ [deepSeek]: pngPath, [openAI]: pngPath, [xAI]: icoPath }),
    );
  } finally {
    vi.unstubAllGlobals();
    await rm(directory, { recursive: true, force: true });
  }
});
