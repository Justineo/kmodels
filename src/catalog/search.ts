interface SearchableModel {
  readonly model_id: string;
  readonly name: string;
}

interface IndexedModel<T extends SearchableModel> {
  model: T;
  terms: readonly [string, string];
}

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s-]+/g, "");
}

export function indexModels<T extends SearchableModel>(models: readonly T[]): IndexedModel<T>[] {
  return models.map((model) => ({
    model,
    terms: [normalize(model.model_id), normalize(model.name)],
  }));
}

export function searchModels<T extends SearchableModel>(
  index: readonly IndexedModel<T>[],
  value: string,
): T[] {
  const trimmed = value.trim();
  if (trimmed === "") return index.map(({ model }) => model);

  const query = normalize(trimmed);
  if (query === "") return [];

  return index
    .filter(({ terms }) => terms.some((term) => term.includes(query)))
    .map(({ model }) => model);
}
