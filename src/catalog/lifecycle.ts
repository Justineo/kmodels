import type { ModelReleaseStage, ProviderModel } from "./schema.ts";

export function modelStateFromLabel(
  value: string,
): Pick<ProviderModel, "status" | "release_stage"> {
  const label = value.toLowerCase();
  const releaseStage: ModelReleaseStage = /experimental/.test(label)
    ? "experimental"
    : /preview/.test(label)
      ? "preview"
      : /stable|generally available|\bga\b/.test(label)
        ? "stable"
        : "unknown";
  const status: ProviderModel["status"] = /retired|discontinued|shut down|shutdown/.test(label)
    ? "retired"
    : /deprecated/.test(label)
      ? "deprecated"
      : /legacy/.test(label)
        ? "legacy"
        : /\bactive\b|\bcurrent\b/.test(label) || releaseStage !== "unknown"
          ? "active"
          : "unknown";
  return { status, release_stage: releaseStage };
}

export function releaseStageFromIdentity(modelId: string, name: string): ModelReleaseStage {
  const identity = `${modelId} ${name}`.toLowerCase();
  if (/(?:^|[./:_ -])(?:experimental|exp)(?:$|[./:_ -])/.test(identity)) return "experimental";
  if (/(?:^|[./:_ -])preview(?:$|[./:_ -])/.test(identity)) return "preview";
  return "unknown";
}

export function normalizeModelReleaseStage(model: ProviderModel): ProviderModel {
  if (model.release_stage !== "unknown") return model;
  const releaseStage = releaseStageFromIdentity(model.model_id, model.name);
  return releaseStage === "unknown" ? model : { ...model, release_stage: releaseStage };
}
