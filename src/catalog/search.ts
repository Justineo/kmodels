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
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function indexModels<T extends SearchableModel>(models: readonly T[]): IndexedModel<T>[] {
  return models.map((model) => ({
    model,
    terms: [normalize(model.model_id), normalize(model.name)],
  }));
}

function longestCommonSubsequenceLength(left: string, right: string): number {
  const rows = left.length >= right.length ? left : right;
  const columns = left.length >= right.length ? right : left;
  const lengths = new Uint16Array(columns.length + 1);

  for (let row = 0; row < rows.length; row += 1) {
    let diagonal = 0;
    for (let column = 1; column <= columns.length; column += 1) {
      const above = lengths[column] ?? 0;
      const previous = lengths[column - 1] ?? 0;
      lengths[column] =
        rows.charCodeAt(row) === columns.charCodeAt(column - 1)
          ? diagonal + 1
          : Math.max(above, previous);
      diagonal = above;
    }
  }

  return lengths[columns.length] ?? 0;
}

function score(candidate: string, query: string): number | undefined {
  if (candidate === query) return 4;
  if (candidate.startsWith(query)) return 3 + query.length / candidate.length;

  const substringIndex = candidate.indexOf(query);
  if (substringIndex >= 0) return 2 + query.length / candidate.length;

  if (query.length < 3) return undefined;
  if (candidate.length > Math.max(query.length * 4, query.length + 8)) return undefined;

  const commonLength = longestCommonSubsequenceLength(query, candidate);
  const queryCoverage = commonLength / query.length;
  const minimumCoverage = query.length <= 4 ? 1 : 0.8;
  if (queryCoverage < minimumCoverage) return undefined;

  return queryCoverage + commonLength / candidate.length / 10;
}

export function searchModels<T extends SearchableModel>(
  index: readonly IndexedModel<T>[],
  value: string,
): T[] {
  const trimmed = value.trim();
  if (trimmed === "") return index.map(({ model }) => model);

  const query = normalize(trimmed);
  if (query === "") return [];

  const matches: Array<{ model: T; score: number }> = [];
  for (const { model, terms } of index) {
    const [modelId, displayName] = terms;
    let searchScore = score(modelId, query);
    const displayNameScore = score(displayName, query);
    if (
      displayNameScore !== undefined &&
      (searchScore === undefined || displayNameScore > searchScore)
    ) {
      searchScore = displayNameScore;
    }
    if (searchScore !== undefined) matches.push({ model, score: searchScore });
  }

  matches.sort((left, right) => right.score - left.score);
  return matches.map(({ model }) => model);
}
