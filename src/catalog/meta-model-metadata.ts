import { load, type CheerioAPI } from "cheerio";
import type { LinkedBundle } from "./bundle.ts";
import type { ParsedProviderModel } from "./pricing-source.ts";
import type { Modality, ModelTask } from "./schema.ts";
import { metaApiEndpoints } from "./meta-accounting.ts";

const origin = "https://dev.meta.ai";
type Selection = ReturnType<CheerioAPI>;
const text = (value: string) => value.replace(/\s+/g, " ").trim();

function section($: CheerioAPI, id: string): Selection {
  const heading = $("main,[role='main']").find(`h2#${id},h3#${id}`);
  return heading.length === 1 ? heading.nextUntil("h2,h3") : $([]);
}

function fields($: CheerioAPI, scope: Selection): ReadonlyMap<string, Selection> {
  const result = new Map<string, Selection>();
  const duplicate = new Set<string>();
  scope.find("table tr").each((_index, row) => {
    if ($(row).closest("blockquote,pre,code,template").length > 0) return;
    const cells = $(row).find("th,td");
    if (cells.length !== 2) return;
    const key = text(cells.eq(0).text());
    if (result.has(key)) duplicate.add(key);
    result.set(key, cells.eq(1));
  });
  for (const key of duplicate) result.delete(key);
  return result;
}

function modalities(value: string): Modality[] {
  const result: Modality[] = [];
  for (const modality of ["text", "image", "video", "audio", "pdf"] as const)
    if (new RegExp(`\\b${modality}s?\\b`, "i").test(value)) result.push(modality);
  return result;
}

function tokens(value: string): number | undefined {
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+) tokens$/.test(value)) return;
  const count = Number(value.replace(/ tokens$/, "").replaceAll(",", ""));
  return Number.isSafeInteger(count) && count > 0 ? count : undefined;
}

export function applyMetaModelMetadata(bundle: LinkedBundle, models: ParsedProviderModel[]): void {
  const byId = new Map(models.map((model) => [model.model_id, model]));
  const catalog = load(bundle.index.body);
  const endpoints = metaApiEndpoints(bundle);
  for (const [id, task] of [
    ["muse-wonder", "text_generation"],
    ["muse-spark", "text_generation"],
    ["muse-ember", "text_generation"],
    ["muse-image", "image_generation"],
    ["muse-voice-transcribe", "transcription"],
    ["sam-3", "segmentation"],
  ] satisfies [string, ModelTask][]) {
    section(catalog, id)
      .find("table")
      .each((_index, table) => {
        const rows = catalog(table).find("tr");
        const headers = rows
          .first()
          .find("th,td")
          .map((_cell, node) => text(catalog(node).text()))
          .get();
        if (headers[0] !== "Model ID") return;
        rows.slice(1).each((_row, node) => {
          const cells = catalog(node).find("th,td");
          const ids = text(cells.eq(0).text()).split(/,\s*/);
          for (const modelId of ids) {
            const model = byId.get(modelId);
            if (!model) continue;
            model.tasks = [task];
            for (const direction of ["input", "output"] as const) {
              const column = headers.indexOf(direction === "input" ? "Input" : "Output");
              if (column >= 0)
                model.modalities[direction] = modalities(text(cells.eq(column).text()));
            }
            const column = headers.indexOf("Context window");
            const context = column < 0 ? undefined : tokens(text(cells.eq(column).text()));
            if (context !== undefined) model.limits.context_tokens = context;
            if (
              task === "text_generation" &&
              /is in preview\./.test(text(section(catalog, id).text()))
            )
              model.release_stage = "preview";
          }
        });
      });
  }

  for (const path of ["/docs/muse-wonder", "/docs/muse-spark", "/docs/muse-ember"]) {
    const documents = bundle.documents.filter(({ url }) => url === `${origin}${path}`);
    if (documents.length !== 1 || !documents[0]) continue;
    const $ = load(documents[0].body);
    const values = fields($, section($, "at-a-glance"));
    const ids = [
      "Model ID",
      "Standard mode model ID",
      "Standard mode model IDs",
      "Contributor-mode variants",
    ].flatMap(
      (key) =>
        values
          .get(key)
          ?.find("code")
          .map((_index, code) => text($(code).text()))
          .get() ?? [],
    );
    const context = tokens(text(values.get("Context window")?.text() ?? ""));
    const output = tokens(text(values.get("Max output")?.text() ?? ""));
    const useCases = section($, "use-cases");
    for (const id of ids) {
      const model = byId.get(id);
      if (!model) continue;
      model.tasks = ["text_generation"];
      for (const direction of ["input", "output"] as const) {
        const value = values.get(direction === "input" ? "Input" : "Output");
        if (value !== undefined) model.modalities[direction] = modalities(text(value.text()));
      }
      if (context !== undefined) model.limits.context_tokens = context;
      if (output !== undefined) model.limits.max_output_tokens = output;
      const endpointCell = values.get("Endpoints");
      const knownEndpoints = [...endpoints].filter(([name, path]) => {
        const slug = name === "Chat Completions" ? "chat-completions" : name.toLowerCase();
        return (
          endpointCell !== undefined &&
          text(endpointCell.text()).split(/,\s*/).includes(name) &&
          endpointCell
            .find(`a[href='/docs/protocols/${slug}'],a[href='${origin}/docs/protocols/${slug}']`)
            .toArray()
            .some((node) => text($(node).text()) === name) &&
          path.startsWith("/v1/")
        );
      });
      if (knownEndpoints.length > 0)
        model.api_endpoints = knownEndpoints.map(([name, path]) => ({ name, path }));
      const effort = text(values.get("Reasoning effort")?.text() ?? "");
      const scopedEffort = effort.match(/^"minimal" to "max" on ([a-z][a-z0-9.-]+);/);
      if (effort.startsWith('"minimal" to "max";') || scopedEffort?.[1] === id) {
        model.capabilities.reasoning = true;
        model.capabilities.effort_control = true;
      }
      for (const [href, capability] of [
        ["/docs/tool-calling", "tool_call"],
        ["/docs/structured-output", "structured_output"],
        ["/docs/computer-use", "computer_use"],
      ] as const)
        if (
          useCases
            .find(`a[href='${href}'],a[href='${origin}${href}']`)
            .toArray()
            .some(
              (node) =>
                !/\b(?:not supported|unsupported|does not support|do not support)\b/i.test(
                  $(node).closest("li,p").text(),
                ),
            )
        )
          model.capabilities[capability] = true;
    }
  }
  const sam = byId.get("sam-3.1");
  const guides = bundle.documents.filter(({ url }) => url === `${origin}/docs/sam/overview.md`);
  if (
    sam !== undefined &&
    guides.length === 1 &&
    /The `sam-3\.1` model.*?segments stills and clips over `POST \/v1\/responses`/.test(
      guides[0]?.body ?? "",
    ) &&
    endpoints.has("Responses")
  ) {
    sam.api_endpoints = [{ name: "Responses", path: "/v1/responses" }];
  }
  const image = byId.get("muse-image-1.0");
  if (image !== undefined) {
    const paths = ["images/create-image", "images/edit-image"];
    const imageEndpoints = [...endpoints].flatMap(([name, path]) => {
      const evidence = bundle.documents.filter(({ url }) =>
        paths.some((value) => url === `${origin}/docs/api-reference/${value}.md`),
      );
      return path.startsWith("/v1/images/") &&
        evidence.some(
          ({ body }) =>
            body.includes(`https://api.meta.ai${path}`) &&
            body.includes('"model": "muse-image-1.0"'),
        )
        ? [{ name, path }]
        : [];
    });
    if (imageEndpoints.length > 0) image.api_endpoints = imageEndpoints;
  }
  const voice = byId.get("muse-voice-transcribe-1.0");
  const voiceGuides = bundle.documents.filter(
    ({ url }) => url === `${origin}/docs/speech-to-text.md`,
  );
  const voiceGuide = voiceGuides.length === 1 ? voiceGuides[0]?.body : undefined;
  if (voice !== undefined && voiceGuide?.includes('"model":"muse-voice-transcribe-1.0"')) {
    const paths = [
      ["Realtime transcription", "wss://api.meta.ai/v1/asr/realtime", "/v1/asr/realtime"],
      ["File transcription", "POST https://api.meta.ai/v1/asr/transcribe", "/v1/asr/transcribe"],
    ] as const;
    voice.api_endpoints = paths
      .filter(([, literal]) => voiceGuide.includes(literal))
      .map(([name, , path]) => ({ name, path }));
    if (voiceGuide.includes("wss://api.meta.ai/v1/asr/realtime"))
      voice.capabilities.streaming = true;
  }
}
