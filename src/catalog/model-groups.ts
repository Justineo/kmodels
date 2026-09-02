interface GroupableModel {
  readonly provider_id: string;
  readonly model_id: string;
  readonly uid: string;
}

interface NamedGroupableModel extends GroupableModel {
  readonly name: string;
}

export interface ModelGroup<T extends GroupableModel> {
  key: string;
  provider_id: string;
  model_id: string;
  models: T[];
}

export type ModelTableRow<T extends GroupableModel> =
  | {
      kind: "group";
      key: string;
      group: ModelGroup<T>;
    }
  | {
      kind: "model";
      key: string;
      model: T;
      nested: boolean;
    };

export function modelGroupKey(providerId: string, modelId: string): string {
  return JSON.stringify([providerId, modelId]);
}

export function preferredModelGroupName<T extends NamedGroupableModel>(
  group: ModelGroup<T>,
): string {
  return group.models.find((model) => model.name !== group.model_id)?.name ?? group.model_id;
}

export function groupModels<T extends GroupableModel>(models: readonly T[]): ModelGroup<T>[] {
  const groups = new Map<string, ModelGroup<T>>();
  for (const model of models) {
    const key = modelGroupKey(model.provider_id, model.model_id);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, {
        key,
        provider_id: model.provider_id,
        model_id: model.model_id,
        models: [model],
      });
      continue;
    }
    group.models.push(model);
  }
  return [...groups.values()];
}

export function modelTableRows<T extends GroupableModel>(
  groups: readonly ModelGroup<T>[],
  expandedGroupKeys: ReadonlySet<string>,
): ModelTableRow<T>[] {
  return groups.flatMap((group) => {
    if (group.models.length === 1) {
      const model = group.models[0];
      return model === undefined
        ? []
        : [{ kind: "model", key: `model:${model.uid}`, model, nested: false }];
    }

    const parent: ModelTableRow<T> = {
      kind: "group",
      key: `group:${group.key}`,
      group,
    };
    if (!expandedGroupKeys.has(group.key)) return [parent];
    return [
      parent,
      ...group.models.map((model): ModelTableRow<T> => ({
        kind: "model",
        key: `model:${model.uid}`,
        model,
        nested: true,
      })),
    ];
  });
}
