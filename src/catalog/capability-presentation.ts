import {
  capabilityStatementsConflict,
  type CapabilityStatement,
  type WebsiteCapabilityDetailGroup,
} from "./model-capability-details.ts";
import type { ProviderModel } from "./schema.ts";

export type CapabilityKey = keyof ProviderModel["capabilities"];

/** Display order of model-wide flags. Transport flags (streaming, batch) belong to Overview. */
export const capabilityLabels = [
  ["reasoning", "Reasoning"],
  ["effort_control", "Reasoning effort"],
  ["tool_call", "Tool calling"],
  ["structured_output", "Structured output"],
  ["prompt_cache", "Prompt caching"],
  ["fine_tuning", "Fine-tuning"],
  ["citations", "Citations"],
  ["code_execution", "Code execution"],
  ["context_management", "Context management"],
  ["computer_use", "Computer use"],
] as const satisfies ReadonlyArray<readonly [CapabilityKey, string]>;

/**
 * One native option. `isDefault` marks the documented default; `partialDefault` means some APIs
 * document it while others leave the default unstated.
 */
export interface CapabilityValue {
  value: string;
  isDefault?: true;
  partialDefault?: true;
}

/** Values on one API that cannot be placed on a published endpoint of this model. */
interface CapabilityVariant {
  label?: string;
  values: CapabilityValue[];
}

export interface CapabilityRow {
  key: CapabilityKey;
  label: string;
  /** Present when every evidenced API documents the same values. */
  values?: CapabilityValue[];
  /** Values by published endpoint path when they differ between APIs. */
  byEndpoint: Map<string, CapabilityValue[]>;
  unplaced: CapabilityVariant[];
  conflict: boolean;
}

type StatementOf<K extends CapabilityStatement["kind"]> = Extract<CapabilityStatement, { kind: K }>;
interface CapabilityDetailKind<K extends CapabilityStatement["kind"]> {
  capability: CapabilityKey;
  /** Documented native options; an empty list contributes nothing. */
  values(statement: StatementOf<K>): CapabilityValue[];
}

/**
 * Every statement kind registers the capability it evidences and its supported values. A new kind
 * needs a schema member, an entry here and its dispatch case; the type checker rejects a missing one.
 */
export const capabilityDetailKinds: {
  [K in CapabilityStatement["kind"]]: CapabilityDetailKind<K>;
} = {
  reasoning_effort: {
    capability: "effort_control",
    values: ({ supported_values, default_value }) =>
      supported_values === undefined
        ? default_value === undefined
          ? []
          : [{ value: default_value, isDefault: true }]
        : supported_values.map((value) =>
            value === default_value ? { value, isDefault: true } : { value },
          ),
  },
  prompt_cache: {
    capability: "prompt_cache",
    values: ({ mode }) => [{ value: mode === "implicit" ? "automatic" : "caller-defined" }],
  },
};

function present<K extends CapabilityStatement["kind"]>(
  kind: CapabilityDetailKind<K>,
  statement: StatementOf<K>,
) {
  return { capability: kind.capability, values: kind.values(statement) };
}

/** Narrows each statement to its registered kind; a new kind fails here until it is added. */
function presentation(statement: CapabilityStatement) {
  switch (statement.kind) {
    case "reasoning_effort":
      return present(capabilityDetailKinds.reasoning_effort, statement);
    case "prompt_cache":
      return present(capabilityDetailKinds.prompt_cache, statement);
    default:
      return statement satisfies never;
  }
}

/** Unions one API's options; disagreeing defaults leave that API's default unknown. */
function addValues(binding: Binding, values: readonly CapabilityValue[]): void {
  for (const { value, isDefault } of values) {
    if (!binding.values.some((entry) => entry.value === value)) binding.values.push({ value });
    if (isDefault) binding.defaults.add(value);
  }
}

function settled(binding: Binding): CapabilityValue[] {
  const [defaultValue, ...others] = binding.defaults;
  return binding.values.map(({ value }) =>
    others.length === 0 && value === defaultValue ? { value, isDefault: true } : { value },
  );
}

const defaultOf = (values: readonly CapabilityValue[]) =>
  values.find(({ isDefault }) => isDefault)?.value;

/**
 * Variants agree when they list the same options and no two document different defaults. An
 * unstated default is unknown, not a different value.
 */
function merged(variants: readonly { values: CapabilityValue[] }[]): CapabilityValue[] | undefined {
  const first = variants[0]?.values;
  if (first === undefined) return undefined;
  const options = JSON.stringify(first.map(({ value }) => value));
  if (variants.some(({ values }) => JSON.stringify(values.map(({ value }) => value)) !== options))
    return undefined;
  const defaults = variants.map(({ values }) => defaultOf(values));
  const documented = new Set(defaults.filter((value) => value !== undefined));
  if (documented.size > 1) return undefined;
  const [defaultValue] = documented;
  const partial = defaults.includes(undefined);
  return first.map(({ value }) =>
    value !== defaultValue
      ? { value }
      : partial
        ? { value, isDefault: true, partialDefault: true }
        : { value, isDefault: true },
  );
}

interface Binding {
  endpoint?: string;
  label?: string;
  values: CapabilityValue[];
  defaults: Set<string>;
}

/**
 * Supported capabilities in display order; unsupported and unknown ones are omitted. Scoped
 * values group by bound endpoint, and equal values across every API collapse into one list.
 */
export function capabilityRows(
  capabilities: ProviderModel["capabilities"],
  groups: readonly WebsiteCapabilityDetailGroup[],
  endpointPaths: ReadonlySet<string> = new Set(),
): CapabilityRow[] {
  return capabilityLabels.flatMap(([key, label]): CapabilityRow[] => {
    const bindings = new Map<string, Binding>();
    const statements: CapabilityStatement[] = [];
    for (const { statements: grouped } of groups)
      for (const statement of grouped) {
        const { capability, values } = presentation(statement);
        if (capability !== key || values.length === 0) continue;
        statements.push(statement);
        const { applicability } = statement;
        const id = applicability?.endpoint ?? applicability?.interface ?? statement.scope;
        const binding: Binding = bindings.get(id) ?? {
          ...(applicability?.endpoint === undefined ? {} : { endpoint: applicability.endpoint }),
          ...(applicability?.interface === undefined ? {} : { label: applicability.interface }),
          values: [],
          defaults: new Set(),
        };
        bindings.set(id, binding);
        addValues(binding, values);
      }
    if (capabilities[key] !== true && bindings.size === 0) return [];
    const variants = [...bindings.values()].map((binding) => ({
      endpoint: binding.endpoint,
      label: binding.label,
      values: settled(binding),
    }));
    const values = merged(variants);
    const byEndpoint = new Map<string, CapabilityValue[]>();
    const unplaced: CapabilityVariant[] = [];
    if (values === undefined)
      for (const { endpoint, label: api, values: options } of variants)
        if (endpoint !== undefined && endpointPaths.has(endpoint))
          byEndpoint.set(endpoint, options);
        else unplaced.push({ ...(api === undefined ? {} : { label: api }), values: options });
    return [
      {
        key,
        label,
        ...(values === undefined ? {} : { values }),
        byEndpoint,
        unplaced,
        conflict: statements.some((left, index) =>
          statements.slice(index + 1).some((right) => capabilityStatementsConflict(left, right)),
        ),
      },
    ];
  });
}
