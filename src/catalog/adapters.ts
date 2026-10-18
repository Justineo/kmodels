import { parseTypesafeCatalog } from "./typesafe.ts";
import { z } from "zod";
import { parseAnthropicApi, parseAnthropicCatalog } from "./anthropic.ts";
import {
  parseAzureApi,
  parseAzureCatalog,
  parseAzureClaudePricing,
  parseAzurePortalCatalog,
  parseAzurePublicPricing,
  parseAzureRetailPrices,
} from "./azure.ts";
import { parseAzureAccounting } from "./azure-accounting.ts";
import { parseBedrockApi, parseBedrockCatalog } from "./bedrock.ts";
import { parseSagemakerCatalog } from "./sagemaker.ts";
import { parseSagemakerPricing } from "./sagemaker-pricing.ts";
import { parseSagemakerInventory } from "./sagemaker-api.ts";
import { parseSagemakerSdk } from "./sagemaker-sdk.ts";
import {
  parseCerebrasApi,
  parseCerebrasCatalog,
  parseCerebrasLifecycle,
  parseCerebrasPublic,
  parseCerebrasReleases,
} from "./cerebras.ts";
import { parseCohereApi, parseCohereCatalog, parseCoherePricing } from "./cohere.ts";
import { parseDatabricksApi, parseDatabricksCatalog } from "./databricks.ts";
import { parseDeepseekApi, parseDeepseekCatalog, parseDeepseekUpdates } from "./deepseek.ts";
import {
  parseDashscopeApi,
  parseDashscopeCatalog,
  parseDashscopeLifecycle,
  parseDashscopePricing,
  parseDashscopeRecommended,
  parseDashscopeReleases,
} from "./dashscope.ts";
import { parseGeminiApi, parseGeminiCatalog, parseGeminiPricing } from "./gemini.ts";
import {
  parseHuggingFaceFeatherless,
  parseHuggingFaceHub,
  parseHuggingFaceMapping,
  parseHuggingFaceNativePricing,
  parseHuggingFaceRouter,
} from "./huggingface.ts";
import { parseLlamaApi, parseLlamaCatalog } from "./llama.ts";
import {
  parseKimiApi,
  parseKimiCatalog,
  parseKimiOpenApi,
  parseKimiPricing,
  parseKimiReleases,
} from "./kimi.ts";
import { parseMistralApi, parseMistralCatalog, parseMistralPricing } from "./mistral.ts";
import { parseOllamaCloud, parseOllamaLibrary } from "./ollama.ts";
import { sourcePricingFacts, type ParsedProviderModel as ProviderModel } from "./pricing-source.ts";
import { parseSourceJson, SourceContractError, zodContractEvidence } from "./source-contract.ts";
import { parseVercelCatalog } from "./vercel.ts";
import { parseVertexApi, parseVertexCatalog, parseVertexPricing } from "./vertex.ts";
import { parseXaiApi, parseXaiCatalog } from "./xai.ts";
import {
  parseOpenAiCatalog,
  parseOpenAiModelPricing,
  parseOpenAiApi,
  parseOpenAiChangelog,
  parseOpenAiDeprecations,
  parseOpenAiDataResidency,
  parseOpenAiPricing,
  parseOpenAiAccounting,
} from "./openai.ts";
import type { SourceParseInput as ParseInput, SourceParseResult } from "./source-parse.ts";

export { multiplyDecimal, scaleDecimal } from "./pricing.ts";
export { classifyModelTasks, normalizeModelTasks } from "./task.ts";
export {
  modelStateFromLabel,
  normalizeModelReleaseStage,
  releaseStageFromIdentity,
} from "./lifecycle.ts";

function parseSourceBody(input: ParseInput): ProviderModel[] | SourceParseResult {
  switch (input.source.extractor.kind) {
    case "openai-catalog":
      return parseOpenAiCatalog(input);
    case "openai-model-pricing":
      return parseOpenAiModelPricing(input);
    case "openai-api":
      return parseOpenAiApi(input);
    case "openai-changelog":
      return parseOpenAiChangelog(input);
    case "openai-deprecations":
      return parseOpenAiDeprecations(input);
    case "openai-data-residency":
      return parseOpenAiDataResidency(input);
    case "openai-pricing":
      return parseOpenAiPricing(input);
    case "openai-accounting":
      return parseOpenAiAccounting(input);
    case "anthropic-catalog":
      return parseAnthropicCatalog(input);
    case "anthropic-api":
      return parseAnthropicApi(input);
    case "vercel-catalog":
      return parseVercelCatalog(input);
    case "typesafe-catalog":
      return parseTypesafeCatalog(input);
    case "cerebras-public":
      return parseCerebrasPublic(input);
    case "cerebras-catalog":
      return parseCerebrasCatalog(input);
    case "cerebras-lifecycle":
      return parseCerebrasLifecycle(input);
    case "cerebras-releases":
      return parseCerebrasReleases(input);
    case "cerebras-api":
      return parseCerebrasApi(input);
    case "huggingface-mapping":
      return parseHuggingFaceMapping(input);
    case "huggingface-router":
      return parseHuggingFaceRouter(input);
    case "huggingface-featherless":
      return parseHuggingFaceFeatherless(input);
    case "huggingface-native-pricing":
      return parseHuggingFaceNativePricing(input);
    case "huggingface-hub":
      return parseHuggingFaceHub(input);
    case "ollama-library":
      return parseOllamaLibrary(input);
    case "ollama-cloud":
      return parseOllamaCloud(input);
    case "bedrock-catalog":
      return parseBedrockCatalog(input);
    case "sagemaker-catalog":
      return parseSagemakerCatalog(input);
    case "sagemaker-sdk":
      return parseSagemakerSdk(input);
    case "sagemaker-pricing":
      return parseSagemakerPricing(input);
    case "sagemaker-api":
      return parseSagemakerInventory(input);
    case "bedrock-api":
      return parseBedrockApi(input);
    case "databricks-catalog":
      return parseDatabricksCatalog(input);
    case "databricks-api":
      return parseDatabricksApi(input);
    case "azure-catalog":
      return parseAzureCatalog(input);
    case "azure-portal-catalog":
      return parseAzurePortalCatalog(input);
    case "azure-retail-prices":
      return parseAzureRetailPrices(input);
    case "azure-public-pricing":
      return parseAzurePublicPricing(input);
    case "azure-claude-pricing":
      return parseAzureClaudePricing(input);
    case "azure-accounting":
      return parseAzureAccounting(input);
    case "azure-api":
      return parseAzureApi(input);
    case "gemini-catalog":
      return parseGeminiCatalog(input);
    case "gemini-pricing":
      return parseGeminiPricing(input);
    case "gemini-api":
      return parseGeminiApi(input);
    case "vertex-catalog":
      return parseVertexCatalog(input);
    case "vertex-pricing":
      return parseVertexPricing(input);
    case "vertex-api":
      return parseVertexApi(input);
    case "cohere-catalog":
      return parseCohereCatalog(input);
    case "cohere-pricing":
      return parseCoherePricing(input);
    case "cohere-api":
      return parseCohereApi(input);
    case "mistral-catalog":
      return parseMistralCatalog(input);
    case "mistral-pricing":
      return parseMistralPricing(input);
    case "mistral-api":
      return parseMistralApi(input);
    case "llama-catalog":
      return parseLlamaCatalog(input);
    case "llama-api":
      return parseLlamaApi(input);
    case "xai-catalog":
      return parseXaiCatalog(input);
    case "xai-api":
      return parseXaiApi(input);
    case "dashscope-catalog":
      return parseDashscopeCatalog(input);
    case "dashscope-pricing":
      return parseDashscopePricing(input);
    case "dashscope-recommended":
      return parseDashscopeRecommended(input);
    case "dashscope-lifecycle":
      return parseDashscopeLifecycle(input);
    case "dashscope-releases":
      return parseDashscopeReleases(input);
    case "dashscope-api":
      return parseDashscopeApi(input);
    case "deepseek-catalog":
      return parseDeepseekCatalog(input);
    case "deepseek-updates":
      return parseDeepseekUpdates(input);
    case "deepseek-api":
      return parseDeepseekApi(input);
    case "kimi-openapi":
      return parseKimiOpenApi(input);
    case "kimi-catalog":
      return parseKimiCatalog(input);
    case "kimi-pricing":
      return parseKimiPricing(input);
    case "kimi-releases":
      return parseKimiReleases(input);
    case "kimi-api":
      return parseKimiApi(input);
  }
}

export function parseSource(input: ParseInput): SourceParseResult {
  try {
    const parsed = parseSourceBody(input);
    const result = Array.isArray(parsed) ? { models: parsed } : parsed;
    return { ...result, ...sourcePricingFacts(result.models, result) };
  } catch (error) {
    if (error instanceof SourceContractError) throw error;
    let value: unknown;
    if (input.source.format === "json") {
      value = parseSourceJson(input.body, "Source response");
    }
    if (error instanceof z.ZodError) {
      throw new SourceContractError(
        "Source response",
        zodContractEvidence([{ error, input: value, itemIndex: 0 }], 1),
      );
    }
    throw error;
  }
}
