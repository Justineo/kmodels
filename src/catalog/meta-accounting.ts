import type { LinkedBundle } from "./bundle.ts";
import { markdownProse, markdownSection, markdownTableRows } from "./markdown.ts";
import {
  directQuantityMethods,
  finalizePricingInputs,
  indexPricingInputs,
  mergeQuantityMethods,
  pricingInputObservation,
  subtractQuantityMethods,
} from "./pricing-input.ts";
import { uniqueCanonicalValues } from "./canonical-value.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type { ParsedProviderModel, SourcePricingInputFact } from "./pricing-source.ts";

const origin = "https://dev.meta.ai";
const endpoints = [
  ["Responses", "responses", "responses/create-response"],
  ["Chat Completions", "chat/completions", "chat-completions/create-chat-completion"],
  ["Messages", "messages", "messages/create-message"],
  ["Image generation", "images/generations", "images/create-image"],
  ["Image editing", "images/edits", "images/edit-image"],
] as const;

function document(bundle: LinkedBundle, path: string): string | undefined {
  const matches = bundle.documents.filter(({ url }) => url === `${origin}/docs/${path}.md`);
  return matches.length === 1 ? matches[0]?.body : undefined;
}

export function metaApiEndpoints(bundle: LinkedBundle): ReadonlyMap<string, string> {
  return new Map(
    endpoints.flatMap(([name, operation, path]) => {
      const body = document(bundle, `api-reference/${path}`);
      const heading =
        body === undefined ? undefined : markdownSection(body, 2, `POST /${operation}`);
      return heading !== undefined && body?.includes(`https://api.meta.ai/v1/${operation}`)
        ? [[name, `/v1/${operation}`]]
        : [];
    }),
  );
}

function field(body: string, owner: string, name: string): Map<string, string> | undefined {
  const scope = markdownSection(body, 3, owner);
  if (scope === undefined) return;
  try {
    const matches = markdownTableRows(scope, ["Field", "Type", "Required", "Description"]).filter(
      (row) => row.get("Field") === `\`${name}\``,
    );
    return matches.length === 1 ? matches[0] : undefined;
  } catch {
    return;
  }
}

function reference(
  body: string,
  owner: string,
  name: string,
  path: string,
  type: string,
  fragment: string,
): boolean {
  return (
    field(body, owner, name)?.get("Type") ===
    `[\`${type}\`](${origin}/docs/api-reference/${path}/schemas#${fragment})`
  );
}

function integer(body: string, owner: string, name: string): boolean {
  const parts = name.split(".");
  return (
    field(body, owner, name)?.get("Type") === "`integer`" &&
    parts
      .slice(0, -1)
      .every(
        (_part, index) =>
          field(body, owner, parts.slice(0, index + 1).join("."))?.get("Type") === "`object`",
      )
  );
}

export function extractMetaPricingInputs(
  bundle: LinkedBundle,
  sourceRef: string,
  reconcile?: (item: PricingReconciliationItem) => void,
): SourcePricingInputFact[] {
  const available = metaApiEndpoints(bundle);
  const facts: SourcePricingInputFact[] = [];
  let expected = 0;
  for (const [protocol, name, path, root, usageType, usageHeading, usageFragment, members] of [
    [
      "responses",
      "Responses",
      "responses",
      "Response",
      "ResponseUsage",
      "Response Usage",
      "response-usage",
      [
        ["input_tokens", "input_tokens"],
        ["input_tokens_details.cached_tokens", "cached_input_tokens"],
        ["output_tokens", "output_tokens"],
        ["images_processed", "processed_images"],
        ["video_frames_processed", "billed_video_frames"],
      ],
    ],
    [
      "chat",
      "Chat Completions",
      "chat-completions",
      "Create Chat Completion Response",
      "CompletionUsage",
      "Completion Usage",
      "completion-usage",
      [
        ["prompt_tokens", "input_tokens"],
        ["prompt_tokens_details.cached_tokens", "cached_input_tokens"],
        ["completion_tokens", "output_tokens"],
      ],
    ],
  ] as const) {
    const body = document(bundle, `api-reference/${path}/schemas`);
    if (body !== undefined || available.has(name)) expected += members.length * 2;
    if (
      body === undefined ||
      !available.has(name) ||
      !reference(body, root, "usage", path, usageType, usageFragment)
    )
      continue;
    const endpoint = document(
      bundle,
      `api-reference/${endpoints.find(([label]) => label === name)?.[2]}`,
    );
    const response = endpoint === undefined ? undefined : markdownSection(endpoint, 3, "Response");
    if (response === undefined || !markdownProse(response).includes("`HTTP 200`")) continue;
    const json = markdownProse(
      markdownSection(response, 4, "Content Type: application/json") ?? "",
    );
    const stream = markdownProse(
      markdownSection(response, 4, "Content Type: text/event-stream") ?? "",
    );
    const ownsResponse = json.includes(
      `[\`${root.replaceAll(" ", "")}\`](${origin}/docs/api-reference/${path}/schemas#${root.toLowerCase().replaceAll(" ", "-")})`,
    );
    const streaming =
      protocol === "responses"
        ? reference(body, "Response Completed Event", "response", path, "Response", "response") &&
          field(body, "Response Completed Event", "type")?.get("Type") ===
            "`enum ('response.completed')`" &&
          stream.includes(
            "[`ResponseStreamWireEvent`](https://dev.meta.ai/docs/api-reference/responses/schemas#response-stream-wire-event)",
          ) &&
          markdownProse(markdownSection(body, 3, "Response Stream Wire Event") ?? "")
            .match(/^Type: (.+)$/m)?.[1]
            ?.includes(
              "[`ResponseCompletedEvent`](https://dev.meta.ai/docs/api-reference/responses/schemas#response-completed-event)",
            ) === true
        : reference(
            body,
            "Create Chat Completion Stream Response",
            "usage",
            path,
            usageType,
            usageFragment,
          ) &&
          /entire request.*final chunk/.test(
            field(body, "Create Chat Completion Stream Response", "usage")?.get("Description") ??
              "",
          ) &&
          stream.includes(
            "[`CreateChatCompletionStreamResponse`](https://dev.meta.ai/docs/api-reference/chat-completions/schemas#create-chat-completion-stream-response)",
          );
    for (const [member, key] of members) {
      if (!integer(body, usageHeading, member)) continue;
      for (const channel of [
        ...(ownsResponse ? ["response" as const] : []),
        ...(streaming ? ["stream_event" as const] : []),
      ])
        facts.push({
          key: `${protocol}.${key}`,
          channel,
          locator: {
            kind: "json_pointer",
            value: `${channel === "stream_event" && protocol === "responses" ? "/response" : ""}/usage/${member.replaceAll(".", "/")}`,
          },
          availability: channel === "stream_event" ? "terminal_only" : "success_only",
          source_ref: sourceRef,
        });
    }
  }
  const images = document(bundle, "api-reference/images/schemas");
  if (images !== undefined || available.has("Image generation") || available.has("Image editing")) {
    expected += 1;
    const ownsImages = ["images/create-image", "images/edit-image"].some((path) => {
      const endpoint = document(bundle, `api-reference/${path}`);
      const response =
        endpoint === undefined ? undefined : markdownSection(endpoint, 3, "Response");
      return (
        endpoint?.includes('"model": "muse-image-1.0"') &&
        response?.includes("`HTTP 200`") &&
        response.includes(
          "[`ImagesResponse`](https://dev.meta.ai/docs/api-reference/images/schemas#images-response)",
        ) &&
        available.has(path === "images/create-image" ? "Image generation" : "Image editing")
      );
    });
    if (
      images !== undefined &&
      ownsImages &&
      field(images, "Images Response", "data")?.get("Type") ===
        "array of [`ImageObject`](https://dev.meta.ai/docs/api-reference/images/schemas#image-object)"
    )
      facts.push({
        key: "images.generated_images",
        channel: "response",
        locator: { kind: "json_pointer", value: "/data" },
        reduction: { kind: "array_length" },
        availability: "success_only",
        source_ref: sourceRef,
      });
  }
  return finalizePricingInputs(facts, expected, "Meta pricing inputs", reconcile);
}

export function bindMetaRates(
  bundle: LinkedBundle,
  models: ParsedProviderModel[],
  inputs: SourcePricingInputFact[],
): void {
  const inputIndex = indexPricingInputs(inputs);
  const caching = document(bundle, "prompt-caching");
  const cachedUsage =
    caching === undefined ? undefined : markdownSection(caching, 3, "See what was cached");
  const partition =
    cachedUsage !== undefined &&
    /`cached_tokens` is a \*\*subset\*\* of your input tokens/.test(markdownProse(cachedUsage)) &&
    cachedUsage.includes("usage.prompt_tokens_details.cached_tokens") &&
    cachedUsage.includes("usage.input_tokens_details.cached_tokens");
  for (const model of models) {
    const paths = new Set(model.api_endpoints?.map(({ path }) => path));
    const protocols = [
      ...(paths.has("/v1/responses") ? ["responses"] : []),
      ...(paths.has("/v1/chat/completions") ? ["chat"] : []),
    ];
    if (
      inputs.some(
        ({ key, channel }) =>
          channel === "stream_event" &&
          protocols.some((protocol) => key.startsWith(`${protocol}.`)),
      )
    )
      model.capabilities.streaming = true;
    if (partition && protocols.length > 0) model.capabilities.prompt_cache = true;
    for (const rate of model.price_facts) {
      const binding = rate.charge_binding;
      if (binding === undefined) continue;
      const mapped =
        model.model_id === "muse-image-1.0" && rate.meter === "image_generation"
          ? directQuantityMethods(binding.signal, ["images.generated_images"], inputIndex)
          : model.model_id === "sam-3.1" &&
              paths.has("/v1/responses") &&
              ["input_image", "input_video"].includes(rate.meter)
            ? directQuantityMethods(
                binding.signal,
                [
                  `responses.${rate.meter === "input_image" ? "processed_images" : "billed_video_frames"}`,
                ],
                inputIndex,
              )
            : rate.meter === "input_text" && partition
              ? mergeQuantityMethods(
                  protocols.map((protocol) =>
                    subtractQuantityMethods(
                      { namespace: "kmodels", value: "input_tokens" },
                      [`${protocol}.input_tokens`],
                      { namespace: "kmodels", value: "cached_input_tokens" },
                      [`${protocol}.cached_input_tokens`],
                      inputIndex,
                    ),
                  ),
                )
              : rate.meter === "cache_read_text" || rate.meter === "output_text"
                ? directQuantityMethods(
                    binding.signal,
                    protocols.map(
                      (protocol) =>
                        `${protocol}.${rate.meter === "cache_read_text" ? "cached_input_tokens" : "output_tokens"}`,
                    ),
                    inputIndex,
                  )
                : undefined;
      if (mapped !== undefined && mapped.methods.length > 0)
        rate.charge_binding = {
          ...binding,
          quantity_methods: mapped.methods,
          observations: uniqueCanonicalValues([
            ...binding.observations,
            ...mapped.facts.map(pricingInputObservation),
          ]),
        };
    }
  }
}
