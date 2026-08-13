const uiIconNames = [
  "arrow-right",
  "arrow-up",
  "chevron-down",
  "chevron-right",
  "external-link",
  "github",
  "list-filter",
  "loader-circle",
  "moon",
  "search",
  "sun",
  "x",
] as const;

export type UiIconName = (typeof uiIconNames)[number];

const providerIconIds = [
  "amazon-bedrock",
  "anthropic",
  "azure",
  "cerebras",
  "cohere",
  "dashscope",
  "databricks",
  "deepseek",
  "gemini",
  "huggingface",
  "kimi",
  "llama",
  "mistral",
  "ollama",
  "openai",
  "vercel",
  "vertex",
  "xai",
] as const;
export type ProviderIconId = (typeof providerIconIds)[number];

const darkProviderIconIds = ["kimi"] as const;
export type DarkProviderIconId = (typeof darkProviderIconIds)[number];

const providerIds: ReadonlySet<string> = new Set(providerIconIds);
const darkProviderIds: ReadonlySet<string> = new Set(darkProviderIconIds);

export function providerSymbolId(providerId: string): string | undefined {
  return providerIds.has(providerId) ? `provider-${providerId}` : undefined;
}

export function darkProviderSymbolId(providerId: string): string | undefined {
  return darkProviderIds.has(providerId) ? `provider-${providerId}-dark` : undefined;
}
