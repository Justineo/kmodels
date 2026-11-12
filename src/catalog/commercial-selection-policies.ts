import type { CommercialSelectionPolicy } from "./commercial-selection.ts";
import { anthropic_commercialSelectionPolicy } from "./anthropic-commercial.ts";
import { bedrock_commercialSelectionPolicy } from "./bedrock-commercial.ts";
import { azure_pricing_commercialSelectionPolicy } from "./azure-pricing-commercial.ts";
import { cerebras_commercialSelectionPolicy } from "./cerebras-commercial.ts";
import { cohere_commercialSelectionPolicy } from "./cohere-commercial.ts";
import { dashscope_commercialSelectionPolicy } from "./dashscope-commercial.ts";
import { databricks_commercialSelectionPolicy } from "./databricks-commercial.ts";
import { deepseek_commercialSelectionPolicy } from "./deepseek-commercial.ts";
import { fireworksSelectionPolicy } from "./fireworks.ts";
import { gemini_commercialSelectionPolicy } from "./gemini-commercial.ts";
import { kimi_commercialSelectionPolicy } from "./kimi-commercial.ts";
import { meta_model_apiSelectionPolicy } from "./meta-model-api.ts";
import { mistral_commercialSelectionPolicy } from "./mistral-commercial.ts";
import { ollama_commercialSelectionPolicy } from "./ollama-commercial.ts";
import { openai_commercialSelectionPolicy } from "./openai-commercial.ts";
import { sagemaker_commercialSelectionPolicy } from "./sagemaker-commercial.ts";
import { togetherSelectionPolicy } from "./together.ts";
import { typesafe_commercialSelectionPolicy } from "./typesafe-commercial.ts";
import { vercel_commercialSelectionPolicy } from "./vercel-commercial.ts";
import { vertex_commercialSelectionPolicy } from "./vertex-commercial.ts";
import { xai_commercialSelectionPolicy } from "./xai-commercial.ts";
export const commercialSelectionPolicies: Readonly<Record<string, CommercialSelectionPolicy>> = {
  anthropic: anthropic_commercialSelectionPolicy,
  "amazon-bedrock": bedrock_commercialSelectionPolicy,
  azure: azure_pricing_commercialSelectionPolicy,
  cerebras: cerebras_commercialSelectionPolicy,
  cohere: cohere_commercialSelectionPolicy,
  dashscope: dashscope_commercialSelectionPolicy,
  databricks: databricks_commercialSelectionPolicy,
  deepseek: deepseek_commercialSelectionPolicy,
  fireworks: fireworksSelectionPolicy,
  gemini: gemini_commercialSelectionPolicy,
  kimi: kimi_commercialSelectionPolicy,
  meta: meta_model_apiSelectionPolicy,
  mistral: mistral_commercialSelectionPolicy,
  ollama: ollama_commercialSelectionPolicy,
  openai: openai_commercialSelectionPolicy,
  "amazon-sagemaker": sagemaker_commercialSelectionPolicy,
  together: togetherSelectionPolicy,
  typesafe: typesafe_commercialSelectionPolicy,
  vercel: vercel_commercialSelectionPolicy,
  vertex: vertex_commercialSelectionPolicy,
  xai: xai_commercialSelectionPolicy,
};
