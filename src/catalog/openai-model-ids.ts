import { modelIdSchema } from "./identity.ts";
import { markdownSection } from "./markdown.ts";
import { baseModel } from "./model.ts";
import type { ParsedProviderModel } from "./pricing-source.ts";
import type { ModelLifecycle } from "./schema.ts";
import type { SourceParseResult } from "./source-parse.ts";

export interface OpenAiModelCard {
  model: ParsedProviderModel;
  document: { url: string; body: string };
}

/** Link exact public IDs to their own offers; routing alone never transfers a tariff. */
export function openAiInferencePrices(
  models: readonly { model_id: string; uid: string }[],
  sourceId: string,
  documentUrl: string,
): NonNullable<SourceParseResult["inference_prices"]> {
  return models.flatMap((model) =>
    ["sync", "batch"].map((offer_key) => ({
      model_id: model.model_id,
      model_ref: model.uid,
      source_ref: sourceId,
      offer_key,
      fixed_selectors: [],
      evidence: [
        {
          source_ref: sourceId,
          locator: {
            kind: "fragment" as const,
            value: `${documentUrl}#model-id: ${model.model_id}`,
          },
        },
      ],
    })),
  );
}

/** Admit the explicitly identified default snapshot, never classify an ID by its spelling. */
export function openAiSnapshotModels(input: {
  models: ParsedProviderModel[];
  cards: OpenAiModelCard[];
  sourceId: string;
  observedAt: string;
}) {
  const defaults = input.cards.flatMap((card) => {
    const snapshots = markdownSection(card.document.body, 2, "Snapshots");
    const details = markdownSection(card.document.body, 2, "Model details");
    if (
      !snapshots?.includes(
        "Snapshots let you lock in a specific version of the model so that performance and behavior remain consistent.",
      )
    )
      return [];
    const declarations = [...(details ?? "").matchAll(/^- Default snapshot: `([^`]+)`$/gm)];
    const id = declarations.length === 1 ? declarations[0]?.[1] : undefined;
    if (id === undefined || !modelIdSchema.safeParse(id).success) return [];
    const entries = snapshots
      .split(/\r?\n/)
      .filter((line) => line === `- \`${id}\`` || line.startsWith(`- \`${id}\` — `));
    if (entries.length !== 1) return [];
    const [entry] = entries;
    let status: ModelLifecycle = "unknown";
    if (entry === `- \`${id}\` — Shut down`) status = "retired";
    else if (entry === `- \`${id}\` — Deprecated`) status = "deprecated";
    else if (entry === `- \`${id}\`` && card.model.status === "active") status = "active";
    return [{ card, id, status }];
  });
  const models = [...input.models];
  const cards = input.cards.map((card) => ({ ...card }));
  const byId = new Map(models.map((model) => [model.model_id, model]));
  for (const { card, id, status } of defaults) {
    if (!byId.has(id)) {
      const owners = defaults.filter((entry) => entry.id === id);
      const lifecycle = owners.every((entry) => entry.status === status) ? status : "unknown";
      const snapshot: ParsedProviderModel = {
        ...baseModel({
          providerId: "openai",
          id,
          name: id,
          sourceId: input.sourceId,
          observedAt: input.observedAt,
        }),
        status: lifecycle,
        pricing_state: lifecycle === "retired" ? "not_applicable" : "unknown",
      };
      // Several cards may name one snapshot. Its independent identity survives, while rich
      // facts require one owning card or the snapshot's independently indexed card.
      if (owners.length === 1) {
        snapshot.tasks = card.model.tasks;
        snapshot.api_endpoints = card.model.api_endpoints;
        snapshot.modalities = card.model.modalities;
        snapshot.capabilities = card.model.capabilities;
        snapshot.limits = card.model.limits;
      }
      models.push(snapshot);
      byId.set(id, snapshot);
    }
    const snapshot = byId.get(id);
    if (snapshot !== undefined && !input.cards.some(({ model }) => model.uid === snapshot.uid))
      cards.push({ model: snapshot, document: card.document });
  }
  return { models: models.sort((left, right) => left.uid.localeCompare(right.uid)), cards };
}
