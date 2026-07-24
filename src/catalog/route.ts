import type { ModelLifecycle, ModelOperation, ModelReleaseStage } from "./schema.ts";

export type SortKey = "name" | "provider" | "context" | "updated";
export type SortDirection = "ascending" | "descending";
export interface SortState {
  key: SortKey;
  direction: SortDirection;
}

export interface RouteState {
  query: string;
  provider: string;
  operations: ModelOperation[];
  lifecycles: ModelLifecycle[];
  releaseStages: ModelReleaseStage[];
  sort: SortState | undefined;
  modelUid: string | undefined;
}

type CodeEntry<T extends string> = readonly [code: string, value: T];

const operationCodes = [
  ["t", "text_generation"],
  ["e", "embeddings"],
  ["r", "reranking"],
  ["i", "image_generation"],
  ["v", "video_generation"],
  ["a", "audio_generation"],
  ["s", "speech_synthesis"],
  ["T", "transcription"],
  ["l", "translation"],
  ["S", "speech_to_speech"],
  ["m", "moderation"],
  ["c", "classification"],
  ["o", "ocr"],
  ["d", "object_detection"],
  ["g", "segmentation"],
] as const satisfies readonly CodeEntry<ModelOperation>[];

const lifecycleCodes = [
  ["a", "active"],
  ["l", "legacy"],
  ["d", "deprecated"],
  ["r", "retired"],
  ["u", "unknown"],
] as const satisfies readonly CodeEntry<ModelLifecycle>[];

const releaseStageCodes = [
  ["s", "stable"],
  ["p", "preview"],
  ["e", "experimental"],
  ["u", "unknown"],
] as const satisfies readonly CodeEntry<ModelReleaseStage>[];

const sortCodes = [
  ["n", { key: "name", direction: "ascending" }],
  ["N", { key: "name", direction: "descending" }],
  ["p", { key: "provider", direction: "ascending" }],
  ["P", { key: "provider", direction: "descending" }],
  ["c", { key: "context", direction: "ascending" }],
  ["C", { key: "context", direction: "descending" }],
  ["u", { key: "updated", direction: "ascending" }],
  ["U", { key: "updated", direction: "descending" }],
] as const satisfies readonly (readonly [string, SortState])[];

function parseCodes<T extends string>(value: string | null, entries: readonly CodeEntry<T>[]): T[] {
  const codes = new Set(value ?? "");
  return entries.filter(([code]) => codes.has(code)).map(([, item]) => item);
}

function formatCodes<T extends string>(values: readonly T[], entries: readonly CodeEntry<T>[]) {
  const selected = new Set(values);
  return entries
    .filter(([, value]) => selected.has(value))
    .map(([code]) => code)
    .join("");
}

function parseSort(value: string | null): SortState | undefined {
  const match = sortCodes.find(([code]) => code === value);
  return match === undefined ? undefined : { ...match[1] };
}

function formatSort(value: SortState | undefined): string | undefined {
  if (value === undefined) return undefined;
  return sortCodes.find(
    ([, sort]) => sort.key === value.key && sort.direction === value.direction,
  )?.[0];
}

export function parseRouteSearch(search: string): RouteState {
  const params = new URLSearchParams(search);
  return {
    query: params.get("q") ?? "",
    provider: params.get("p") ?? "",
    operations: parseCodes(params.get("o"), operationCodes),
    lifecycles: parseCodes(params.get("l"), lifecycleCodes),
    releaseStages: parseCodes(params.get("r"), releaseStageCodes),
    sort: parseSort(params.get("s")),
    modelUid: params.get("m") || undefined,
  };
}

export function formatRouteSearch(state: RouteState): string {
  const params = new URLSearchParams();
  if (state.query !== "") params.set("q", state.query);
  if (state.provider !== "") params.set("p", state.provider);

  const operations = formatCodes(state.operations, operationCodes);
  const lifecycles = formatCodes(state.lifecycles, lifecycleCodes);
  const releaseStages = formatCodes(state.releaseStages, releaseStageCodes);
  const sort = formatSort(state.sort);
  if (operations !== "") params.set("o", operations);
  if (lifecycles !== "") params.set("l", lifecycles);
  if (releaseStages !== "") params.set("r", releaseStages);
  if (sort !== undefined) params.set("s", sort);
  if (state.modelUid !== undefined) params.set("m", state.modelUid);

  const value = params.toString();
  return value === "" ? "" : `?${value}`;
}
