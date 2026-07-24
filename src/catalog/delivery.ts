import {
  deliveryModeSchema,
  type DeliveryMode,
  type DeliveryModeEvidence,
  type ProviderModel,
} from "./schema.ts";

const order = new Map(deliveryModeSchema.options.map((mode, index) => [mode, index]));

function evidenceKey(evidence: DeliveryModeEvidence): string {
  return [
    evidence.mode,
    evidence.source_ref,
    evidence.namespace,
    evidence.raw_value,
    evidence.kind,
  ].join("\0");
}

function endpointModes(name: string, path: string): DeliveryMode[] {
  const value = `${name} ${path}`.toLowerCase();
  const modes: DeliveryMode[] = [];
  if (/realtime|bidi(?:generate)?|bidirectional|\blive\b/.test(value)) modes.push("realtime");
  if (/batch/.test(value)) modes.push("batch");
  if (/startasyncinvoke|async-invoke|predictlongrunning|videos_create/.test(value))
    modes.push("async");
  return modes;
}

export function normalizeDeliveryModes(model: ProviderModel): ProviderModel {
  const modes = new Set(model.delivery_modes ?? []);
  const evidence = new Map(
    (model.delivery_mode_evidence ?? []).map((item) => [evidenceKey(item), item]),
  );
  if (model.capabilities.streaming === true) modes.add("streaming");
  if (model.capabilities.batch === true) modes.add("batch");

  const [sourceRef] = model.source_refs;
  if (
    sourceRef !== undefined &&
    model.source_refs.length === 1 &&
    model.raw_type?.toLowerCase() === "realtime"
  ) {
    modes.add("realtime");
    const item: DeliveryModeEvidence = {
      mode: "realtime",
      source_ref: sourceRef,
      namespace: `${model.provider_id}.type`,
      raw_value: model.raw_type,
      kind: "provider_type",
    };
    evidence.set(evidenceKey(item), item);
  }

  for (const endpoint of model.api_endpoints ?? []) {
    for (const mode of endpointModes(endpoint.name, endpoint.path)) {
      modes.add(mode);
      if (sourceRef === undefined || model.source_refs.length !== 1) continue;
      const item: DeliveryModeEvidence = {
        mode,
        source_ref: sourceRef,
        namespace: `${model.provider_id}.endpoint`,
        raw_value: endpoint.name,
        kind: "endpoint",
      };
      evidence.set(evidenceKey(item), item);
    }
  }

  return {
    ...model,
    delivery_modes:
      modes.size === 0
        ? undefined
        : [...modes].sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0)),
    delivery_mode_evidence:
      evidence.size === 0
        ? undefined
        : [...evidence.values()].sort(
            (left, right) =>
              (order.get(left.mode) ?? 0) - (order.get(right.mode) ?? 0) ||
              evidenceKey(left).localeCompare(evidenceKey(right)),
          ),
  };
}
