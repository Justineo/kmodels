import { canonicalJson } from "./canonical-value.ts";
import type { ApiSurface, InvocationCase, InvocationTarget } from "./invocation-schema.ts";

export const invocationScopeFields = [
  "request_region",
  "inference_mode",
  "inference_geo",
  "deployment_type",
] as const;
export type InvocationContext = Partial<Record<(typeof invocationScopeFields)[number], string>>;
export type ResourceRequirement = "deployment_binding" | "installation" | "runtime_compatibility";

/** Caller-owned confirmation, scoped to the exact resource/configuration tuple. Never persisted. */
export interface InvocationResourceBinding {
  target_ref: string;
  case_ref: string;
  model_ref: string;
  inputs: Readonly<Record<string, string>>;
  context?: InvocationContext;
  confirmed_requirements: readonly ResourceRequirement[];
}

export interface InvocationConfiguration {
  inputs?: Readonly<Record<string, string>>;
  context?: InvocationContext;
  resource_binding?: InvocationResourceBinding;
}

export function invocationContext(
  surface: ApiSurface,
  query: InvocationConfiguration,
): InvocationContext {
  const context = { ...query.context };
  const regionInput = surface.inputs.find(({ role }) => role === "region");
  const region = regionInput === undefined ? undefined : query.inputs?.[regionInput.name];
  if (context.request_region === undefined && region?.trim()) context.request_region = region;
  return context;
}

export function configureInvocation(
  target: InvocationTarget,
  entry: InvocationCase,
  surface: ApiSurface,
  query: InvocationConfiguration,
) {
  const missing: string[] = [];
  let conflicting = false;
  const context = invocationContext(surface, query);
  const names = new Set([
    ...surface.inputs.map(({ name }) => name),
    ...[target.address, ...target.selectors.map(({ value }) => value)].flatMap((address) =>
      address.kind === "caller" ? [address.input] : [],
    ),
  ]);
  const inputs: Record<string, string> = {};
  for (const name of names) {
    const role = surface.inputs.find((input) => input.name === name)?.role;
    const value = query.inputs?.[name] ?? (role === "region" ? context.request_region : undefined);
    if (!value?.trim()) missing.push(name);
    else {
      inputs[name] = value;
      if (value !== value.trim() || hasControlCharacters(value)) conflicting = true;
    }
    if (
      role === "region" &&
      value !== undefined &&
      context.request_region !== undefined &&
      value !== context.request_region
    )
      conflicting = true;
    if (role === "origin" && value !== undefined && !validOrigin(value, surface.transport))
      conflicting = true;
    if (
      role !== "origin" &&
      surface.origin_template.includes(`{${name}}`) &&
      value !== undefined &&
      !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(value)
    )
      conflicting = true;
  }
  const binding = query.resource_binding;
  const boundContext =
    binding === undefined
      ? undefined
      : invocationContext(surface, { inputs: binding.inputs, context: binding.context ?? {} });
  const boundInputs =
    binding === undefined
      ? undefined
      : Object.fromEntries(
          [...names].flatMap((name) => {
            const role = surface.inputs.find((input) => input.name === name)?.role;
            const value =
              binding.inputs[name] ??
              (role === "region" ? boundContext?.request_region : undefined);
            return value === undefined ? [] : [[name, value]];
          }),
        );
  const bindingMatches =
    binding !== undefined &&
    binding.target_ref === target.id &&
    binding.case_ref === entry.id &&
    binding.model_ref === (target.resolved_model_ref ?? target.model_ref) &&
    canonicalJson(boundInputs) === canonicalJson(inputs) &&
    canonicalJson(boundContext) === canonicalJson(context);
  if (binding !== undefined && !bindingMatches) conflicting = true;
  const requirements = entry.requirements.map(({ kind }) => kind);
  if (target.address_role === "deployment" || target.address_role === "endpoint")
    requirements.push("deployment_binding");
  for (const kind of new Set(requirements)) {
    if (
      kind !== "deployment_binding" &&
      kind !== "installation" &&
      kind !== "runtime_compatibility"
    )
      continue;
    if (!bindingMatches || !binding?.confirmed_requirements.includes(kind)) missing.push(kind);
  }
  return { missing: [...new Set(missing)].sort(), conflicting, inputs, context };
}

function validOrigin(value: string, transport: ApiSurface["transport"]): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    url.pathname === "/" &&
    (transport === "http"
      ? ["http:", "https:"].includes(url.protocol)
      : ["ws:", "wss:"].includes(url.protocol))
  );
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}
