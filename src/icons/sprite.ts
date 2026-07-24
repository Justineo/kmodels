import alibabaCloud from "@lobehub/icons-static-svg/icons/alibabacloud-color.svg?raw";
import anthropic from "@lobehub/icons-static-svg/icons/anthropic.svg?raw";
import bedrock from "@lobehub/icons-static-svg/icons/bedrock-color.svg?raw";
import cerebras from "@lobehub/icons-static-svg/icons/cerebras-color.svg?raw";
import cohere from "@lobehub/icons-static-svg/icons/cohere-color.svg?raw";
import deepSeek from "@lobehub/icons-static-svg/icons/deepseek-color.svg?raw";
import gemini from "@lobehub/icons-static-svg/icons/gemini-color.svg?raw";
import huggingFace from "@lobehub/icons-static-svg/icons/huggingface-color.svg?raw";
import kimi from "@lobehub/icons-static-svg/icons/kimi.svg?raw";
import meta from "@lobehub/icons-static-svg/icons/meta-color.svg?raw";
import mistral from "@lobehub/icons-static-svg/icons/mistral-color.svg?raw";
import ollama from "@lobehub/icons-static-svg/icons/ollama.svg?raw";
import openAi from "@lobehub/icons-static-svg/icons/openai.svg?raw";
import vercel from "@lobehub/icons-static-svg/icons/vercel.svg?raw";
import vertex from "@lobehub/icons-static-svg/icons/vertexai-color.svg?raw";
import vllm from "@lobehub/icons-static-svg/icons/vllm-color.svg?raw";
import xai from "@lobehub/icons-static-svg/icons/xai.svg?raw";
import arrowRight from "lucide-static/icons/arrow-right.svg?raw";
import arrowUp from "lucide-static/icons/arrow-up.svg?raw";
import chevronDown from "lucide-static/icons/chevron-down.svg?raw";
import chevronRight from "lucide-static/icons/chevron-right.svg?raw";
import externalLink from "lucide-static/icons/external-link.svg?raw";
import listFilter from "lucide-static/icons/list-filter.svg?raw";
import loaderCircle from "lucide-static/icons/loader-circle.svg?raw";
import moon from "lucide-static/icons/moon.svg?raw";
import search from "lucide-static/icons/search.svg?raw";
import sun from "lucide-static/icons/sun.svg?raw";
import x from "lucide-static/icons/x.svg?raw";
import databricks from "../assets/provider-icons/databricks.svg?raw";
import microsoftFoundry from "../assets/provider-icons/microsoft-foundry.svg?raw";
import { svgSymbol } from "./svg.ts";

const uiSources = {
  "arrow-right": arrowRight,
  "arrow-up": arrowUp,
  "chevron-down": chevronDown,
  "chevron-right": chevronRight,
  "external-link": externalLink,
  "list-filter": listFilter,
  "loader-circle": loaderCircle,
  moon,
  search,
  sun,
  x,
} as const;

const providerSources: Readonly<Record<string, string>> = {
  "amazon-bedrock": bedrock,
  anthropic,
  azure: microsoftFoundry,
  cerebras,
  cohere,
  dashscope: alibabaCloud,
  databricks,
  deepseek: deepSeek,
  gemini,
  huggingface: huggingFace,
  kimi,
  llama: meta,
  mistral,
  ollama,
  openai: openAi,
  vercel,
  vertex,
  vllm,
  xai,
};

export type UiIconName = keyof typeof uiSources;

export function uiSymbolId(name: UiIconName): string {
  return `ui-${name}`;
}

export function providerSymbolId(providerId: string): string | undefined {
  return providerSources[providerId] === undefined ? undefined : `provider-${providerId}`;
}

export const spriteSymbols = [
  ...Object.entries(uiSources).map(([name, source]) => svgSymbol(`ui-${name}`, source)),
  ...Object.entries(providerSources).map(([id, source]) => svgSymbol(`provider-${id}`, source)),
].join("");
