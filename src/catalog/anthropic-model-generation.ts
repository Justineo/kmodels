export interface AnthropicModelGeneration {
  major: number;
  minor: number;
}

/** Interpret only the naming grammar published by Anthropic's ID/version contract. */
export function anthropicModelGeneration(id: string): AnthropicModelGeneration | undefined {
  const match = id.match(/^claude-[a-z]+(?:-[a-z]+)*-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/);
  if (match?.[1] === undefined) return;
  const major = Number(match[1]);
  const minor = Number(match[2] ?? 0);
  return Number.isSafeInteger(major) && Number.isSafeInteger(minor) ? { major, minor } : undefined;
}

export function anthropicAtLeastGeneration(
  id: string,
  threshold: AnthropicModelGeneration,
): boolean {
  const generation = anthropicModelGeneration(id);
  return (
    generation !== undefined &&
    (generation.major > threshold.major ||
      (generation.major === threshold.major && generation.minor >= threshold.minor))
  );
}
