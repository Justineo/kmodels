import { z } from "zod";
import { compareUtf8 } from "./canonical-value.ts";
import { isCredentialLikeIdentifier, modelIdSchema } from "./identity.ts";
import { sha256, stableCompactJson } from "./io.ts";

const maxDiagnostics = 8;
const maxSampleModelIds = 3;
const publicModelIdSchema = modelIdSchema.refine((value) => !isCredentialLikeIdentifier(value));

const contractDiagnosticKindSchema = z.enum([
  "invalid_json",
  "missing_required_field",
  "type_mismatch",
  "unknown_field",
  "unknown_value",
  "constraint_violation",
  "count_outside_bounds",
  "coverage_below_threshold",
]);
type ContractDiagnosticKind = z.infer<typeof contractDiagnosticKindSchema>;

const sourceContractDispositionSchema = z.enum(["reject", "accept_with_signal"]);
type SourceContractDisposition = z.infer<typeof sourceContractDispositionSchema>;

const observedValueTypeSchema = z.enum([
  "missing",
  "null",
  "boolean",
  "number",
  "string",
  "array",
  "object",
]);
type ObservedValueType = z.infer<typeof observedValueTypeSchema>;

const contractDiagnosticSchema = z.object({
  fingerprint: z.string().regex(/^[0-9a-f]{16}$/u),
  kind: contractDiagnosticKindSchema,
  path: z.string().startsWith("/").max(512),
  expected: z.string().max(80).optional(),
  observed: observedValueTypeSchema,
  observed_value: z.string().max(64).optional(),
  affected_items: z.number().int().nonnegative(),
  sample_model_ids: z.array(publicModelIdSchema).max(maxSampleModelIds).optional(),
});
type ContractDiagnostic = z.infer<typeof contractDiagnosticSchema>;

export const sourceContractEvidenceSchema = z.object({
  disposition: sourceContractDispositionSchema,
  observed_items: z.number().int().nonnegative(),
  diagnostic_count: z.number().int().positive(),
  diagnostics: z.array(contractDiagnosticSchema).min(1).max(maxDiagnostics),
});
export type SourceContractEvidence = z.infer<typeof sourceContractEvidenceSchema>;

export interface ZodContractObservation {
  error: z.ZodError<unknown>;
  input?: unknown;
  itemIndex: number;
  modelId?: string;
}

interface DiagnosticObservation {
  diagnostic: RawDiagnostic;
  itemIndex: number;
  modelId?: string;
}

interface ItemRecognitionOptions<T> {
  label: string;
  items: readonly unknown[];
  schema: z.ZodType<T>;
  modelId?: string | ((item: unknown) => string | undefined);
  rootKeys?: readonly string[];
  skipInvalidItems?: boolean;
  onFinding?: (evidence: SourceContractEvidence) => void;
}

interface RawDiagnostic {
  kind: ContractDiagnosticKind;
  path: string;
  expected?: string;
  observed: ObservedValueType;
  observed_value?: string;
}

interface Aggregate {
  diagnostic: RawDiagnostic;
  items: Set<number>;
  modelIds: Set<string>;
}

type ZodIssue = z.ZodError<unknown>["issues"][number];

function observedType(value: unknown): ObservedValueType {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  return "object";
}

function safeValue(value: unknown, kind: ContractDiagnosticKind): string | undefined {
  if (typeof value === "boolean") return String(value);
  if (kind === "unknown_value" && typeof value === "number" && Number.isFinite(value))
    return String(value);
  if (
    kind === "unknown_value" &&
    typeof value === "string" &&
    /^[A-Za-z][A-Za-z0-9._-]{0,63}$/u.test(value)
  )
    return value;
  return undefined;
}

function pathSegment(value: PropertyKey): string {
  if (typeof value === "number") return "*";
  if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/u.test(value)) return "?";
  return value;
}

function pointer(path: readonly PropertyKey[]): string {
  if (path.length === 0) return "/";
  const segments = path.slice(0, 7).map(pathSegment);
  if (path.length > segments.length) segments.push("*");
  return `/${segments.join("/")}`;
}

function expectedValue(value: string | undefined): string | undefined {
  return value?.replace(/\p{Cc}/gu, " ").slice(0, 80);
}

function valueAtPath(input: unknown, path: readonly PropertyKey[]): unknown {
  let value = input;
  for (const segment of path) {
    if (
      value === null ||
      typeof value !== "object" ||
      !Object.prototype.hasOwnProperty.call(value, segment)
    )
      return undefined;
    value = Reflect.get(value, segment);
  }
  return value;
}

function rawDiagnostic(
  kind: ContractDiagnosticKind,
  path: readonly PropertyKey[],
  input: unknown,
  expected?: string,
): RawDiagnostic {
  const observed = observedType(input);
  const observedValue = safeValue(input, kind);
  const boundedExpected = expectedValue(expected);
  return {
    kind,
    path: pointer(path),
    ...(boundedExpected === undefined ? {} : { expected: boundedExpected }),
    observed,
    ...(observedValue === undefined ? {} : { observed_value: observedValue }),
  };
}

function issueDiagnostics(issue: ZodIssue, input: unknown): RawDiagnostic[] {
  const observedInput = issue.input ?? valueAtPath(input, issue.path);
  switch (issue.code) {
    case "invalid_type":
      return [
        rawDiagnostic(
          observedInput === undefined ? "missing_required_field" : "type_mismatch",
          issue.path,
          observedInput,
          issue.expected,
        ),
      ];
    case "unrecognized_keys":
      return issue.keys.map((key) => {
        const parent = valueAtPath(input, issue.path);
        const observed =
          parent !== null && typeof parent === "object" ? Reflect.get(parent, key) : undefined;
        return rawDiagnostic("unknown_field", [...issue.path, key], observed);
      });
    case "invalid_value":
      return [rawDiagnostic("unknown_value", issue.path, observedInput, "reviewed value")];
    case "invalid_format":
      return [rawDiagnostic("constraint_violation", issue.path, observedInput, issue.format)];
    case "too_big":
      return [
        rawDiagnostic(
          "constraint_violation",
          issue.path,
          observedInput,
          `maximum ${String(issue.maximum)}`,
        ),
      ];
    case "too_small":
      return [
        rawDiagnostic(
          "constraint_violation",
          issue.path,
          observedInput,
          `minimum ${String(issue.minimum)}`,
        ),
      ];
    case "not_multiple_of":
      return [
        rawDiagnostic(
          "constraint_violation",
          issue.path,
          observedInput,
          `multiple of ${issue.divisor}`,
        ),
      ];
    case "invalid_union":
      return [rawDiagnostic("constraint_violation", issue.path, observedInput, "reviewed union")];
    case "invalid_key":
      return [
        rawDiagnostic(
          "constraint_violation",
          issue.path,
          observedInput,
          `valid ${issue.origin} key`,
        ),
      ];
    case "invalid_element":
      return [
        rawDiagnostic(
          "constraint_violation",
          issue.path,
          observedInput,
          `valid ${issue.origin} element`,
        ),
      ];
    case "custom":
      return [rawDiagnostic("constraint_violation", issue.path, observedInput, issue.message)];
  }
}

function diagnosticKey(diagnostic: RawDiagnostic): string {
  return stableCompactJson({
    kind: diagnostic.kind,
    path: diagnostic.path,
    expected: diagnostic.expected,
    observed: diagnostic.observed,
  });
}

function safeModelId(value: string | undefined): string | undefined {
  return value !== undefined && publicModelIdSchema.safeParse(value).success ? value : undefined;
}

function aggregateEvidence(
  observations: readonly DiagnosticObservation[],
  observedItems: number,
  disposition: SourceContractDisposition,
): SourceContractEvidence {
  const aggregates = new Map<string, Aggregate>();
  for (const observation of observations) {
    const modelId = safeModelId(observation.modelId);
    const { diagnostic } = observation;
    const key = diagnosticKey(diagnostic);
    const aggregate = aggregates.get(key) ?? {
      diagnostic,
      items: new Set<number>(),
      modelIds: new Set<string>(),
    };
    if (aggregate.diagnostic.observed_value !== diagnostic.observed_value) {
      const { observed_value: _observedValue, ...withoutObservedValue } = aggregate.diagnostic;
      aggregate.diagnostic = withoutObservedValue;
    }
    aggregate.items.add(observation.itemIndex);
    if (modelId !== undefined) aggregate.modelIds.add(modelId);
    aggregates.set(key, aggregate);
  }
  const all = [...aggregates.entries()]
    .sort(([left], [right]) => compareUtf8(left, right))
    .map(([key, aggregate]): ContractDiagnostic => {
      const modelIds = [...aggregate.modelIds].sort(compareUtf8).slice(0, maxSampleModelIds);
      return {
        fingerprint: sha256(key).slice(0, 16),
        ...aggregate.diagnostic,
        affected_items: aggregate.items.size,
        ...(modelIds.length === 0 ? {} : { sample_model_ids: modelIds }),
      };
    });
  const evidence = {
    disposition,
    observed_items: observedItems,
    diagnostic_count: all.length,
    diagnostics: all.slice(0, maxDiagnostics),
  };
  return sourceContractEvidenceSchema.parse(evidence);
}

export function zodContractEvidence(
  observations: readonly ZodContractObservation[],
  observedItems: number,
  disposition: SourceContractDisposition = "reject",
): SourceContractEvidence {
  return aggregateEvidence(
    observations.flatMap((observation) =>
      observation.error.issues.flatMap((issue) =>
        issueDiagnostics(issue, observation.input).map((diagnostic) => ({
          diagnostic,
          itemIndex: observation.itemIndex,
          ...(observation.modelId === undefined ? {} : { modelId: observation.modelId }),
        })),
      ),
    ),
    observedItems,
    disposition,
  );
}

export function contractExtensionEvidence(paths: readonly string[]): SourceContractEvidence {
  const unique = [...new Set(paths)].sort(compareUtf8);
  if (unique.length === 0) throw new Error("Contract extension evidence requires a path");
  return aggregateEvidence(
    unique.map((path, itemIndex) => ({
      diagnostic: {
        kind: "unknown_value",
        path: path.startsWith("/") ? path.slice(0, 512) : `/${path.slice(0, 511)}`,
        expected: "reviewed source contract",
        observed: "string",
      },
      itemIndex,
    })),
    unique.length,
    "accept_with_signal",
  );
}

function modelId(
  item: unknown,
  selector: ItemRecognitionOptions<unknown>["modelId"],
): string | undefined {
  if (typeof selector === "function") return selector(item);
  if (selector === undefined || item === null || typeof item !== "object") return undefined;
  const value = Reflect.get(item, selector);
  return typeof value === "string" ? value : undefined;
}

export function recognizeItems<T>(options: ItemRecognitionOptions<T>): T[] {
  const parsed: T[] = [];
  const invalid: ZodContractObservation[] = [];
  const extensions: DiagnosticObservation[] = [];
  const knownRootKeys = options.rootKeys === undefined ? undefined : new Set(options.rootKeys);
  for (const [itemIndex, item] of options.items.entries()) {
    const itemModelId = modelId(item, options.modelId);
    const result = options.schema.safeParse(item);
    if (result.success) parsed.push(result.data);
    else
      invalid.push({
        error: result.error,
        input: item,
        itemIndex,
        ...(itemModelId === undefined ? {} : { modelId: itemModelId }),
      });
    if (knownRootKeys !== undefined && item !== null && typeof item === "object") {
      for (const key of Object.keys(item).sort(compareUtf8)) {
        if (knownRootKeys.has(key)) continue;
        extensions.push({
          diagnostic: rawDiagnostic("unknown_field", [key], Reflect.get(item, key)),
          itemIndex,
          ...(itemModelId === undefined ? {} : { modelId: itemModelId }),
        });
      }
    }
  }
  if (invalid.length > 0) {
    const evidence = zodContractEvidence(
      invalid,
      options.items.length,
      options.skipInvalidItems === true ? "accept_with_signal" : "reject",
    );
    if (options.skipInvalidItems !== true) throw new SourceContractError(options.label, evidence);
    options.onFinding?.(evidence);
  }
  if (extensions.length > 0)
    options.onFinding?.(aggregateEvidence(extensions, options.items.length, "accept_with_signal"));
  return parsed;
}

function singleEvidence(
  diagnostic: RawDiagnostic,
  observedItems: number,
  affectedItems: number,
): SourceContractEvidence {
  const key = diagnosticKey(diagnostic);
  return {
    disposition: "reject",
    observed_items: observedItems,
    diagnostic_count: 1,
    diagnostics: [
      {
        fingerprint: sha256(key).slice(0, 16),
        ...diagnostic,
        affected_items: affectedItems,
      },
    ],
  };
}

export function assertItemCount(
  label: string,
  observedItems: number,
  minimum: number,
  maximum?: number,
  path: readonly PropertyKey[] = [],
): void {
  const valid =
    Number.isInteger(observedItems) &&
    Number.isInteger(minimum) &&
    observedItems >= 0 &&
    minimum >= 0 &&
    (maximum === undefined || (Number.isInteger(maximum) && maximum >= minimum));
  if (!valid) throw new Error(`Invalid item-count assertion for ${label}`);
  if (observedItems >= minimum && (maximum === undefined || observedItems <= maximum)) return;
  const maximumLabel = maximum === undefined ? "∞" : String(maximum);
  const diagnostic: RawDiagnostic = {
    kind: "count_outside_bounds",
    path: pointer(path),
    expected: `${minimum}..${maximumLabel} items`,
    observed: "array",
    observed_value: String(observedItems),
  };
  throw new SourceContractError(label, singleEvidence(diagnostic, observedItems, observedItems));
}

export function assertCoverage(
  label: string,
  coveredItems: number,
  observedItems: number,
  minimumRatio: number,
  path: readonly PropertyKey[] = [],
): void {
  const valid =
    Number.isInteger(coveredItems) &&
    Number.isInteger(observedItems) &&
    coveredItems >= 0 &&
    observedItems >= 0 &&
    coveredItems <= observedItems &&
    minimumRatio >= 0 &&
    minimumRatio <= 1;
  if (!valid) throw new Error(`Invalid coverage assertion for ${label}`);
  if (observedItems > 0 && coveredItems / observedItems >= minimumRatio) return;
  const diagnostic: RawDiagnostic = {
    kind: "coverage_below_threshold",
    path: pointer(path),
    expected: `at least ${(minimumRatio * 100).toFixed(2)}% coverage`,
    observed: "array",
    observed_value: `${coveredItems}/${observedItems}`,
  };
  throw new SourceContractError(
    label,
    singleEvidence(diagnostic, observedItems, observedItems - coveredItems),
  );
}

export function invalidJsonContractEvidence(): SourceContractEvidence {
  const diagnostic = rawDiagnostic("invalid_json", [], "", "valid JSON");
  return aggregateEvidence([{ diagnostic, itemIndex: 0 }], 1, "reject");
}

export class SourceContractError extends Error {
  readonly evidence: SourceContractEvidence;

  constructor(label: string, evidence: SourceContractEvidence) {
    const first = evidence.diagnostics[0];
    const detail =
      first === undefined
        ? "unclassified mismatch"
        : `${first.kind} at ${first.path} (expected ${first.expected ?? "reviewed shape"}, observed ${first.observed})`;
    const remainder = evidence.diagnostic_count - 1;
    super(`${label} contract mismatch: ${detail}${remainder > 0 ? `; ${remainder} more` : ""}`);
    this.name = "SourceContractError";
    this.evidence = evidence;
  }
}

export function contractEvidence(error: unknown): SourceContractEvidence | undefined {
  return error instanceof SourceContractError ? error.evidence : undefined;
}
