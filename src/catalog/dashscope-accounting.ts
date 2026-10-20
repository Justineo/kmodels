import { uniquePricingInputFacts } from "./pricing-input.ts";
import { load } from "cheerio";
import { parseTree, type Node as JsonNode, type ParseError } from "jsonc-parser";
import { markdownProse } from "./markdown.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type { SourcePricingInputFact } from "./pricing-source.ts";
import { contractExtensionEvidence, type SourceContractEvidence } from "./source-contract.ts";

interface Document {
  url: string;
  body: string;
}

interface Contract {
  key: string;
  document: string;
  markers: readonly RegExp[];
  channel: SourcePricingInputFact["channel"];
  locator: SourcePricingInputFact["locator"];
  availability: SourcePricingInputFact["availability"];
}

const chatPath = "/help/en/model-studio/qwen-api-via-openai-chat-completions";
const nativePath = "/help/en/model-studio/qwen-api-via-dashscope";
const responsesPath = "/help/en/model-studio/qwen-api-via-openai-responses";
const batchPath = "/help/en/model-studio/batch-interfaces-compatible-with-openai";
const cachePath = "/help/en/model-studio/context-cache";
const anthropicPath = "/help/en/model-studio/anthropic-api-messages";
const imagePath = "/help/en/model-studio/qwen-image-api";
const videoPath = "/help/en/model-studio/text-to-video-api-reference";
const ttsPath = "/help/en/model-studio/qwen-tts-api";
const musicPath = "/help/en/model-studio/fun-music-api";
const asrPath = "/help/en/model-studio/fun-asr-recorded-speech-recognition-http-api";
const asrEventsPath = "/help/en/model-studio/fun-asr-server-events";
const baseUrlPath = "/help/en/model-studio/base-url";

const contracts: readonly Contract[] = [
  ...chatUsage("prompt_tokens", "input_tokens"),
  ...chatUsage("completion_tokens", "output_tokens"),
  ...chatUsage("prompt_tokens_details.cached_tokens", "cached_input_tokens"),
  ...chatUsage("prompt_tokens_details.text_tokens", "input_text_tokens"),
  ...chatUsage("prompt_tokens_details.image_tokens", "input_image_tokens"),
  ...chatUsage("prompt_tokens_details.video_tokens", "input_video_tokens"),
  ...chatUsage("prompt_tokens_details.audio_tokens", "input_audio_tokens"),
  ...chatUsage("completion_tokens_details.text_tokens", "output_text_tokens"),
  ...chatUsage("completion_tokens_details.reasoning_tokens", "reasoning_tokens"),
  ...chatUsage("completion_tokens_details.audio_tokens", "output_audio_tokens"),
  contract(
    "chat.cache_creation_input_tokens",
    cachePath,
    "response",
    "/usage/prompt_tokens_details/cache_creation_input_tokens",
    [marker("prompt_tokens_details.cache_creation_input_tokens"), /OpenAI-compatible/i],
  ),
  ...chatUsage("prompt_tokens_details.cache_creation_input_tokens", "cache_creation_input_tokens"),
  ...chatUsage(
    "prompt_tokens_details.cache_creation.cache_creation_input_tokens",
    "cache_creation_input_tokens",
  ),
  ...chatUsage(
    "prompt_tokens_details.cache_creation.ephemeral_5m_input_tokens",
    "cache_creation_5m_input_tokens",
  ),
  ...nativeUsage("input_tokens", "input_tokens"),
  ...nativeUsage("output_tokens", "output_tokens"),
  ...nativeUsage("input_tokens_details.text_tokens", "input_text_tokens"),
  ...nativeUsage("input_tokens_details.image_tokens", "input_image_tokens"),
  ...nativeUsage("image_tokens", "input_image_tokens"),
  ...nativeUsage("input_tokens_details.video_tokens", "input_video_tokens"),
  ...nativeUsage("video_tokens", "input_video_tokens"),
  ...nativeUsage("audio_tokens", "input_audio_tokens"),
  ...nativeUsage("output_tokens_details.text_tokens", "output_text_tokens"),
  ...nativeUsage("output_tokens_details.reasoning_tokens", "reasoning_tokens"),
  ...nativeUsage("output_tokens_details.audio_tokens", "output_audio_tokens"),
  ...nativeUsage("prompt_tokens_details.cached_tokens", "cached_input_tokens"),
  ...nativeUsage("cached_tokens", "cached_input_tokens"),
  contract(
    "native.cache_creation_input_tokens",
    cachePath,
    "response",
    "/usage/prompt_tokens_details/cache_creation_input_tokens",
    [marker("prompt_tokens_details.cache_creation_input_tokens"), /DashScope/i],
  ),
  ...nativeUsage(
    "prompt_tokens_details.cache_creation_input_tokens",
    "cache_creation_input_tokens",
  ),
  ...nativeUsage(
    "prompt_tokens_details.cache_creation.cache_creation_input_tokens",
    "cache_creation_input_tokens",
  ),
  ...nativeUsage(
    "prompt_tokens_details.cache_creation.ephemeral_5m_input_tokens",
    "cache_creation_5m_input_tokens",
  ),
  ...anthropicUsage("input_tokens", "input_tokens"),
  ...anthropicUsage("output_tokens", "output_tokens"),
  ...anthropicUsage("cache_read_input_tokens", "cached_input_tokens"),
  ...anthropicUsage("cache_creation_input_tokens", "cache_creation_input_tokens"),
  ...responsesUsage("input_tokens", "input_tokens"),
  ...responsesUsage("output_tokens", "output_tokens"),
  ...responsesUsage("input_tokens_details.cached_tokens", "cached_input_tokens"),
  ...responsesUsage("output_tokens_details.reasoning_tokens", "reasoning_tokens"),
  ...responsesUsage("prompt_tokens_details.cached_tokens", "session_cached_input_tokens"),
  ...responsesDetailedUsage(
    "prompt_tokens_details.cache_creation_input_tokens",
    "session_cache_creation_input_tokens",
  ),
  ...responsesDetailedUsage(
    "prompt_tokens_details.cache_creation.ephemeral_5m_input_tokens",
    "session_cache_creation_5m_input_tokens",
  ),
  ...responsesDetailedUsage("input_tokens", "detail.input_tokens"),
  ...responsesDetailedUsage("output_tokens", "detail.output_tokens"),
  ...responsesDetailedUsage("input_tokens_details.text_tokens", "detail.input_text_tokens"),
  ...responsesDetailedUsage("input_tokens_details.image_tokens", "detail.input_image_tokens"),
  ...responsesDetailedUsage("image_tokens", "detail.input_image_tokens"),
  ...responsesDetailedUsage("output_tokens_details.text_tokens", "detail.output_text_tokens"),
  ...responsesDetailedUsage("output_tokens_details.reasoning_tokens", "detail.reasoning_tokens"),
  contract(
    "responses.stream.image_search_count",
    responsesPath,
    "stream_event",
    "/response/usage/x_tools/image_search/count",
    [marker("x_tools.image_search.count"), /response\.completed/],
  ),
  contract(
    "responses.web_search_image_count",
    responsesPath,
    "response",
    "/usage/x_tools/web_search_image/count",
    [marker("x_tools.web_search_image.count")],
  ),
  contract(
    "responses.stream.web_search_image_count",
    responsesPath,
    "stream_event",
    "/response/usage/x_tools/web_search_image/count",
    [marker("x_tools.web_search_image.count"), /response\.completed/],
  ),
  ...batchUsage("prompt_tokens", "chat.input_tokens"),
  ...batchUsage("completion_tokens", "chat.output_tokens"),
  result("image.generated_images", imagePath, "/usage/image_count"),
  result("image.width", imagePath, "/usage/width"),
  result("image.height", imagePath, "/usage/height"),
  result("video.output_seconds", videoPath, "/usage/video_duration"),
  result("video.billable_seconds", videoPath, "/usage/duration"),
  result("video.input_seconds", videoPath, "/usage/input_video_duration"),
  result("video.output_seconds", videoPath, "/usage/output_video_duration"),
  result("video.effective_resolution", videoPath, "/usage/SR"),
  result("video.effective_size", videoPath, "/usage/size"),
  result("video.generated_videos", videoPath, "/usage/video_count"),
  result("tts.input_characters", ttsPath, "/usage/characters"),
  result("tts.input_text_tokens", ttsPath, "/usage/input_tokens", [/consumed by the input text/]),
  result("tts.output_audio_tokens", ttsPath, "/usage/output_tokens", [
    /consumed by the output audio/,
  ]),
  result("music.generated_seconds", musicPath, "/usage/duration"),
  result("asr.processed_audio_seconds", asrPath, "/usage/duration"),
  result("asr.processed_audio_seconds", asrPath, "/usage/seconds"),
  contract(
    "asr.stream.processed_audio_seconds",
    asrEventsPath,
    "stream_event",
    "/payload/usage/duration",
    [/sentence_end/, /payload\.usage\.duration/],
  ),
  contract(
    "request.resolved_region",
    baseUrlPath,
    "request",
    "HttpRequest.resolved_region",
    [/Base URL/i, /API Key/i, /region/i],
    "always",
    "provider_field",
  ),
  request("chat.enable_thinking", chatPath, "/enable_thinking", [/enable_thinking/]),
  request("native.enable_thinking", nativePath, "/parameters/enable_thinking", [/enable_thinking/]),
  request("native.prompt_extend", videoPath, "/parameters/prompt_extend", [/prompt_extend/]),
  request("batch.enable_thinking", batchPath, "/body/enable_thinking", [/enable_thinking/]),
  contract(
    "responses.image_search_count",
    responsesPath,
    "response",
    "/usage/x_tools/image_search/count",
    [marker("x_tools.image_search.count")],
  ),
];

export function extractDashscopePricingInputs(
  documents: readonly Document[],
  sourceRef: string,
  onFinding?: (evidence: SourceContractEvidence) => void,
  onReconciliation?: (item: PricingReconciliationItem) => void,
): SourcePricingInputFact[] {
  const bodies = new Map(
    documents.map(({ url, body }) => [
      normalizePath(new URL(url).pathname),
      accountingEvidence(body),
    ]),
  );
  const facts = contracts.flatMap((item) => {
    const body = bodies.get(item.document);
    if (body === undefined || !item.markers.every((marker) => marker.test(body))) return [];
    return [
      {
        key: item.key,
        channel: item.channel,
        locator: item.locator,
        availability: item.availability,
        source_ref: sourceRef,
      },
    ];
  });
  // Model-specific wire shapes are alternatives for one protocol's logical input.
  // Keep every supported locator, but require only one to establish that input.
  const keys = new Set(contracts.map(({ key }) => key));
  const bound = new Set(facts.map(({ key }) => key));
  for (const key of keys) {
    if (bound.has(key)) continue;
    const paths = contracts
      .filter((item) => item.key === key)
      .map((item) => `/documents${item.document}/${key}`);
    onFinding?.(contractExtensionEvidence([...new Set(paths)]));
  }
  const complete = bound.size === keys.size;
  onReconciliation?.({
    disposition: complete ? "normalized" : "unbound",
    reason_code: complete ? "pricing_input_contract_bound" : "pricing_input_contract_partial",
    sample: `${bound.size}/${keys.size} DashScope pricing inputs`,
  });
  return uniquePricingInputFacts(facts);
}

function chatUsage(field: string, key: string): Contract[] {
  return [
    contract(`chat.${key}`, chatPath, "response", `/usage/${pointer(field)}`, [marker(field)]),
    contract(`chat.stream.${key}`, chatPath, "stream_event", `/usage/${pointer(field)}`, [
      marker(field),
      /stream_options\.include_usage|stream_options\s*[:=]\s*\{\s*["']include_usage["']/,
    ]),
  ];
}

function nativeUsage(field: string, key: string): Contract[] {
  return [
    contract(`native.${key}`, nativePath, "response", `/usage/${pointer(field)}`, [marker(field)]),
    contract(`native.stream.${key}`, nativePath, "stream_event", `/usage/${pointer(field)}`, [
      marker(field),
      /streaming\s+and\s+non-streaming\s+(?:responses\s+use\s+the\s+same\s+usage\s+fields|output\s+formats\s+are\s+consistent)/i,
    ]),
  ];
}

function responsesUsage(field: string, key: string): Contract[] {
  return [
    contract(`responses.${key}`, responsesPath, "response", `/usage/${pointer(field)}`, [
      marker(field),
    ]),
    contract(
      `responses.stream.${key}`,
      responsesPath,
      "stream_event",
      `/response/usage/${pointer(field)}`,
      [marker(field), /response\.completed/],
    ),
  ];
}

function anthropicUsage(field: string, key: string): Contract[] {
  return [
    contract(`anthropic.${key}`, anthropicPath, "response", `/usage/${field}`, [
      marker(field),
      /Non-streaming Response/i,
    ]),
    contract(`anthropic.stream.${key}`, anthropicPath, "stream_event", `/usage/${field}`, [
      marker(field),
      /message_delta/,
      /Complete token usage/i,
    ]),
  ];
}

function responsesDetailedUsage(field: string, key: string): Contract[] {
  return [
    contract(
      `responses.${key}`,
      responsesPath,
      "response",
      `Response.usage.x_details[x_billing_type=response_api].${field}`,
      [marker(`x_details.${field}`), /x_billing_type/],
      "terminal_only",
      "provider_field",
    ),
    contract(
      `responses.stream.${key}`,
      responsesPath,
      "stream_event",
      `response.completed.response.usage.x_details[x_billing_type=response_api].${field}`,
      [marker(`x_details.${field}`), /x_billing_type/, /response\.completed/],
      "terminal_only",
      "provider_field",
    ),
  ];
}

function batchUsage(field: string, key: string): Contract[] {
  return [
    contract(`batch.${key}`, batchPath, "result", `/response/body/usage/${pointer(field)}`, [
      marker(field),
      /response\.body\.usage/,
    ]),
  ];
}

function result(
  key: string,
  document: string,
  path: string,
  markers: readonly RegExp[] = [],
): Contract {
  return contract(
    key,
    document,
    "result",
    path,
    [marker(path.replace(/^\/usage\//, "").replaceAll("/", ".")), ...markers],
    "success_only",
  );
}

function request(
  key: string,
  document: string,
  path: string,
  markers: readonly RegExp[],
): Contract {
  return contract(key, document, "request", path, markers, "conditional");
}

function contract(
  key: string,
  document: string,
  channel: SourcePricingInputFact["channel"],
  path: string,
  markers: readonly RegExp[],
  availability: SourcePricingInputFact["availability"] = "terminal_only",
  kind: "json_pointer" | "provider_field" = "json_pointer",
): Contract {
  return { key, document, markers, channel, locator: { kind, value: path }, availability };
}

function pointer(field: string): string {
  return field.replaceAll(".", "/");
}

function marker(field: string): RegExp {
  return new RegExp(`\\busage\\.${escapeRegExp(field)}\\b`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePath(path: string): string {
  return path.replace(/\.md$/, "").replace(/\/$/, "");
}

function jsonProperty(node: JsonNode | undefined, name: string): JsonNode | undefined {
  if (node?.type !== "object") return;
  const matches =
    node.children?.filter((child) => {
      const key: unknown = child.children?.[0]?.value;
      return child.type === "property" && key === name;
    }) ?? [];
  return matches.length === 1 ? matches[0]?.children?.[1] : undefined;
}

function sampleRoot(sample: string): JsonNode | undefined {
  const errors: ParseError[] = [];
  try {
    // Preserve offsets so only response.completed.response.output may be elided.
    // A placeholder inside usage must never turn malformed accounting into evidence.
    const elisions: number[] = [];
    const normalized = sample.replace(/\[\.\.\.\]/g, (_value, offset: number) => {
      elisions.push(offset);
      return "[   ]";
    });
    const root = parseTree(normalized, errors, {
      allowTrailingComma: true,
    });
    if (errors.length > 0 || root?.type !== "object") return;
    if (elisions.length > 0) {
      const output = jsonProperty(jsonProperty(root, "response"), "output");
      if (
        jsonProperty(root, "type")?.value !== "response.completed" ||
        elisions.length !== 1 ||
        output?.type !== "array" ||
        output.offset !== elisions[0]
      )
        return;
    }
    return root;
  } catch {
    return;
  }
}

type HtmlSelection = ReturnType<ReturnType<typeof load>>;

/** Read the reviewed response-property tree, never nearby parent/leaf words. */
function propertyFields(body: string): string[] {
  const markup = markdownProse(body)
    .replace(/<(span|td)\b([^>]*?)\s*\/>/g, "<$1$2></$1>")
    .replace(
      /^[ \t]*(#{1,6}) ([^\n]+)$/gm,
      (_line, level: string, title: string) => `<h${level.length}>${title}</h${level.length}>`,
    )
    .replace(
      /^[ \t]*<strong>([a-zA-Z0-9_\\]+)<\/strong>[ \t]*`([^`]+)`([ \t]*(?:\((?:Optional|Required)\))?)[ \t]*$/gm,
      "<p><strong>$1</strong><code>$2</code>$3</p>",
    );
  const $ = load(markup);
  const fields = new Set<string>();
  const headings: { depth: number; label: string }[] = [];

  function declaration(node: HtmlSelection) {
    if (!node.is("p")) return;
    const strong = node.children("strong"),
      code = node.children("code");
    const key = strong.text().replace(/\\_/g, "_"),
      type = code.first().text().trim();
    if (
      strong.length !== 1 ||
      code.length < 1 ||
      code.length > 2 ||
      !/^[a-z][a-z0-9_]*$/.test(key) ||
      !new RegExp(
        `^${escapeRegExp(strong.text())}\\s*${escapeRegExp(type)}(?:\\s*\\((?:Optional|Required)\\))?(?:\\s*Default value:\\s*.+)?$`,
      ).test(node.text().trim())
    )
      return;
    return { key, type, node };
  }

  function properties(parent: HtmlSelection): HtmlSelection | undefined {
    const matches: HtmlSelection[] = [];
    for (const sibling of parent.nextAll().toArray()) {
      const node = $(sibling);
      if (declaration(node) !== undefined || node.is("h1,h2,h3,h4,h5,h6,table,pre,blockquote"))
        break;
      if (node.is('accordion[title="Properties"]')) matches.push(node);
      else if (
        node.is("section.collapse") &&
        node.children("p").first().text().trim() === "Properties"
      ) {
        const content = node.children("div");
        if (content.length !== 1) return;
        matches.push(content);
      } else if (node.is("accordion,section")) break;
    }
    return matches.length === 1 ? matches[0] : undefined;
  }

  function read(container: HtmlSelection, path: string[]): void {
    if (path.length > 8) return;
    const entries: NonNullable<ReturnType<typeof declaration>>[] = [];
    for (const child of container.children().toArray()) {
      const node = $(child);
      if (node.is("h1,h2,h3,h4,h5,h6")) break;
      const entry = declaration(node);
      if (entry !== undefined) entries.push(entry);
    }
    if (path.join(".") === "usage.x_details") {
      const tags = entries.filter(({ key }) => key === "x_billing_type");
      const tag = tags[0];
      if (
        tags.length !== 1 ||
        tag?.type !== "string" ||
        !/\bvalue\s+is\s+fixed\s+to\s*[`"']?response_api\b/i.test(description(tag.node))
      )
        return;
    }
    for (const entry of entries) {
      if (entries.filter(({ key }) => key === entry.key).length !== 1) continue;
      const next = [...path, entry.key];
      if (
        /^(?:integer|number|float)(?: or null)?$/.test(entry.type) ||
        (next.join(".") === "usage.size" && entry.type === "string")
      )
        fields.add(next.join("."));
      else if (/^(?:object|map|array(?:\[object\])?)$/.test(entry.type)) {
        const children = properties(entry.node);
        if (children !== undefined) read(children, next);
      }
    }
  }

  function description(node: HtmlSelection): string {
    const text: string[] = [];
    for (
      let next = node[0]?.nextSibling;
      next !== null && next !== undefined;
      next = next.nextSibling
    ) {
      const sibling = $(next);
      if (declaration(sibling) !== undefined || sibling.is("accordion,section,h1,h2,h3,h4,h5,h6"))
        break;
      text.push(sibling.text());
    }
    return text.join(" ");
  }

  $("h1,h2,h3,h4,h5,h6,p").each((_index, element) => {
    const node = $(element);
    if (node.parents("pre,code,blockquote").length > 0) return;
    if (/^h[1-6]$/.test(element.name)) {
      const depth = Number(element.name.slice(1));
      while ((headings.at(-1)?.depth ?? 0) >= depth) headings.pop();
      headings.push({ depth, label: node.text() });
      return;
    }
    const root = declaration(node);
    if (
      root?.key === "stream_options" &&
      root.type === "object" &&
      headings.some(({ label }) => /\brequest\b/i.test(label))
    ) {
      const children = properties(node);
      const usage = children
        ?.children("p")
        .toArray()
        .flatMap((child) => declaration($(child)) ?? [])
        .filter(({ key }) => key === "include_usage");
      if (usage?.length === 1 && usage[0]?.type === "boolean")
        fields.add("stream_options.include_usage");
    }
    if (
      root?.key !== "usage" ||
      !["object", "map"].includes(root.type) ||
      node.parents("accordion,section.collapse").length > 0 ||
      !headings.some(({ label }) =>
        /\b(?:response (?:object|parameters|body)|returns)\b/i.test(label),
      ) ||
      headings.some(({ label }) => /\b(?:request|examples?)\b/i.test(label))
    )
      return;
    const children = properties(node);
    if (children !== undefined) read(children, ["usage"]);
  });
  return [...fields];
}

function accountingEvidence(body: string): string {
  const fields = new Set(propertyFields(body));
  for (const match of body.matchAll(
    /^[ \t]*```(?:json|jsonc)\b[^\n]*\n([\s\S]*?)^[ \t]*```\s*$/gm,
  )) {
    const sample = match[1];
    if (sample === undefined) continue;
    const root = sampleRoot(sample);
    const roots =
      root === undefined
        ? sample
            .split(/\r?\n/)
            .flatMap((line) => sampleRoot(line.trim().replace(/^data:\s*/, "")) ?? [])
        : [root];
    for (const item of roots) {
      const event: unknown = jsonProperty(item, "type")?.value;
      if (
        typeof event === "string" &&
        event.startsWith("response.") &&
        event !== "response.completed"
      )
        continue;
      const response = jsonProperty(item, "response");
      const batch =
        jsonProperty(response, "status_code")?.value === 200
          ? jsonProperty(jsonProperty(response, "body"), "usage")
          : undefined;
      const payload = jsonProperty(item, "payload");
      const sentence = jsonProperty(jsonProperty(payload, "output"), "sentence");
      const asr =
        jsonProperty(jsonProperty(item, "header"), "event")?.value === "result-generated" &&
        jsonProperty(sentence, "sentence_end")?.value === true
          ? jsonProperty(payload, "usage")
          : undefined;
      const usage = [
        { node: jsonProperty(item, "usage"), path: ["usage"] },
        { node: jsonProperty(response, "usage"), path: ["usage"] },
        { node: batch, path: ["response", "body", "usage"] },
        { node: asr, path: ["payload", "usage"] },
      ].find(({ node }) => node !== undefined);
      if (usage?.node === undefined) continue;
      const pending = [{ node: usage.node, path: usage.path }];
      for (let entry = pending.pop(); entry !== undefined; entry = pending.pop()) {
        if (entry.path.length > 8) continue;
        if (entry.node.type === "array") {
          for (const node of entry.node.children ?? []) {
            const billingType: unknown = jsonProperty(node, "x_billing_type")?.value;
            if (entry.path.join(".") !== "usage.x_details" || billingType === "response_api")
              pending.push({ node, path: entry.path });
          }
          continue;
        }
        if (entry.node.type !== "object") continue;
        for (const child of entry.node.children ?? []) {
          const key: unknown = child.children?.[0]?.value;
          if (typeof key !== "string" || key.length > 128) continue;
          const node = jsonProperty(entry.node, key);
          if (node === undefined) continue;
          const path = [...entry.path, key],
            value: unknown = node.value;
          if (node.type === "object" || node.type === "array") pending.push({ node, path });
          else if (
            (typeof value === "number" && Number.isFinite(value) && value >= 0) ||
            (path.join(".") === "usage.size" && typeof value === "string" && value.length > 0)
          )
            fields.add(path.join("."));
        }
      }
    }
  }
  return [body, markdownProse(body).replace(/\\_/g, "_"), ...fields].join("\n");
}
