import { configureInvocation } from "./invocation-configuration.ts";
import type { InvocationQuery } from "./invocation-resolution.ts";
import type {
  ApiSurface,
  InvocationAddress,
  InvocationCase,
  InvocationTarget,
} from "./invocation-schema.ts";

export interface InvocationRequestTemplate {
  kind: "addressing_template";
  transport: ApiSurface["transport"];
  method: ApiSurface["method"];
  url: string;
  headers: Record<string, string>;
  body_fields: Array<{ pointer: string; value: string }>;
  request_media_type?: ApiSurface["request_media_type"];
  form_fields?: Array<{ name: string; value: string }>;
  authentication: "required" | "not_published";
  account_access: "unknown";
  request_verification: "not_tested";
}

/** Internal wire projection. Eligibility is checked by assessInvocations before exposure. */
export function invocationRequestTemplate(
  surface: ApiSurface,
  target: InvocationTarget,
  entry: InvocationCase,
  query: InvocationQuery,
): InvocationRequestTemplate {
  const configuration = configureInvocation(target, entry, surface, query);
  if (configuration.conflicting || configuration.missing.length > 0)
    throw new Error("Incomplete or conflicting request configuration");
  function address(value: InvocationAddress): string {
    const result = value.kind === "literal" ? value.value : configuration.inputs[value.input];
    if (result === undefined || !result.trim() || result !== result.trim())
      throw new Error("Missing request identifier");
    return result;
  }
  const parameters = new Map(Object.entries(configuration.inputs));
  const queryParameters = new Map<string, string>();
  const headers = new Map<string, string>();
  const body: InvocationRequestTemplate["body_fields"] = [];
  const form = new Map<string, string>();
  function assign(values: Map<string, string>, key: string, value: string) {
    if (values.has(key) && values.get(key) !== value) throw new Error("Conflicting wire values");
    values.set(key, value);
  }
  function bodyField(pointer: string, value: string) {
    if (surface.request_media_type === "multipart/form-data")
      throw new Error("JSON body assignment on a multipart request");
    if (!/^(?:\/(?:[^~/]|~[01])*)+$/.test(pointer)) throw new Error("Invalid body pointer");
    const path = decodePointer(pointer);
    for (const existing of body) {
      const other = decodePointer(existing.pointer);
      const overlap = path
        .slice(0, Math.min(path.length, other.length))
        .every((part, index) => part === other[index]);
      if (overlap) {
        if (pointer === existing.pointer && value === existing.value) return;
        throw new Error("Overlapping body assignments");
      }
    }
    body.push({ pointer, value });
  }
  function formField(name: string, value: string) {
    if (
      surface.request_media_type !== "multipart/form-data" ||
      !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)
    )
      throw new Error("Invalid multipart form assignment");
    assign(form, name, value);
  }
  const identifier = address(target.address);
  switch (surface.identifier_location.kind) {
    case "path":
      assign(parameters, surface.identifier_location.parameter, identifier);
      break;
    case "query":
      assign(queryParameters, surface.identifier_location.parameter, identifier);
      break;
    case "body":
      bodyField(surface.identifier_location.pointer, identifier);
      break;
    case "form":
      formField(surface.identifier_location.parameter, identifier);
      break;
  }
  for (const selector of target.selectors) {
    const value = address(selector.value);
    const { kind, key } = selector.location;
    switch (kind) {
      case "path":
        if (!surface.path_template.includes(`{${key}}`)) throw new Error("Unknown path selector");
        assign(parameters, key, value);
        break;
      case "query":
        assign(queryParameters, key, value);
        break;
      case "body":
        bodyField(key, value);
        break;
      case "form":
        formField(key, value);
        break;
      case "header": {
        const name = key.toLowerCase();
        if (
          !/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name) ||
          /[\r\n]/.test(value) ||
          [
            "authorization",
            "proxy-authorization",
            "cookie",
            "set-cookie",
            "x-api-key",
            "api-key",
          ].includes(name)
        )
          throw new Error("Invalid public wire header");
        assign(headers, name, value);
        break;
      }
    }
  }
  const originInput = surface.inputs.find(({ role }) => role === "origin");
  const origin =
    originInput !== undefined && surface.origin_template === `{${originInput.name}}`
      ? configuration.inputs[originInput.name]
      : surface.origin_template.replace(
          /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g,
          (_match: string, name: string) => {
            const value = parameters.get(name);
            if (
              value === undefined ||
              !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(value)
            )
              throw new Error("Invalid origin parameter");
            return value;
          },
        );
  if (origin === undefined) throw new Error("Missing request origin");
  const url = new URL(origin);
  url.pathname = surface.path_template.replace(
    /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g,
    (_match: string, name: string) => {
      const value = parameters.get(name);
      if (value === undefined || value === "." || value === "..")
        throw new Error("Invalid path parameter");
      return encodeURIComponent(value);
    },
  );
  for (const [key, value] of queryParameters) url.searchParams.set(key, value);
  return {
    kind: "addressing_template",
    transport: surface.transport,
    method: surface.method,
    url: url.href,
    headers: Object.fromEntries(headers),
    body_fields: body,
    ...(surface.request_media_type === undefined
      ? {}
      : { request_media_type: surface.request_media_type }),
    ...(surface.request_media_type === "multipart/form-data"
      ? { form_fields: [...form].map(([name, value]) => ({ name, value })) }
      : {}),
    authentication: entry.requirements.some(({ kind }) => kind === "authentication")
      ? "required"
      : "not_published",
    account_access: "unknown",
    request_verification: "not_tested",
  };
}

function decodePointer(value: string): string[] {
  return value
    .slice(1)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
}
