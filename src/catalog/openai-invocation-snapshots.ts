import { modelIdSchema } from "./identity.ts";
import { markdownSection } from "./markdown.ts";
import { baseModel } from "./model.ts";
import type { OpenAiInvocationCard } from "./openai-invocation.ts";
import type { ParsedProviderModel } from "./pricing-source.ts";

/** Admit the explicitly identified default snapshot, never classify an ID by its spelling. */
export function openAiSnapshotModels(input: {
  models: ParsedProviderModel[];
  cards: OpenAiInvocationCard[];
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
    return [{ card, id, deprecated: entries[0] === `- \`${id}\` — Deprecated` }];
  });
  const models = [...input.models];
  const cards = input.cards.map((card) => ({ ...card }));
  const byId = new Map(models.map((model) => [model.model_id, model]));
  for (const { card, id, deprecated } of defaults) {
    if (!byId.has(id)) {
      const snapshot: ParsedProviderModel = {
        ...baseModel({
          providerId: "openai",
          id,
          name: id,
          sourceId: input.sourceId,
          observedAt: input.observedAt,
        }),
        status: deprecated ? "deprecated" : "unknown",
      };
      // Several cards may name one snapshot. Its independent identity survives, while rich
      // facts require one owning card or the snapshot's independently indexed card.
      if (defaults.filter((entry) => entry.id === id).length === 1) {
        snapshot.tasks = card.model.tasks;
        snapshot.api_endpoints = card.model.api_endpoints;
        snapshot.modalities = card.model.modalities;
        snapshot.capabilities = card.model.capabilities;
        snapshot.limits = card.model.limits;
        cards.push({ ...card, model: snapshot, resolution: "pinned" });
      }
      models.push(snapshot);
      byId.set(id, snapshot);
    }
  }
  for (const card of cards) {
    const declaration = defaults.find((entry) => entry.card.model.uid === card.model.uid);
    const snapshot = declaration === undefined ? undefined : byId.get(declaration.id);
    if (snapshot === undefined) {
      const parents = defaults.filter(({ id }) => id === card.model.model_id);
      if (parents.length > 0) {
        card.resolution = "pinned";
        card.resolutionDocuments = parents.map(({ card }) => card.document);
      }
      continue;
    }
    card.resolution = snapshot.uid === card.model.uid ? "pinned" : "rolling";
    if (snapshot.uid !== card.model.uid) card.resolvedModelRef = snapshot.uid;
  }
  return { models: models.sort((left, right) => left.uid.localeCompare(right.uid)), cards };
}
