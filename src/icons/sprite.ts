import alibabaCloud from "@lobehub/icons-static-svg/icons/alibabacloud-color.svg?raw";
import anthropic from "@lobehub/icons-static-svg/icons/anthropic.svg?raw";
import bedrock from "@lobehub/icons-static-svg/icons/bedrock-color.svg?raw";
import cerebras from "@lobehub/icons-static-svg/icons/cerebras-color.svg?raw";
import cohere from "@lobehub/icons-static-svg/icons/cohere-color.svg?raw";
import deepSeek from "@lobehub/icons-static-svg/icons/deepseek-color.svg?raw";
import gemini from "@lobehub/icons-static-svg/icons/gemini-color.svg?raw";
import huggingFace from "@lobehub/icons-static-svg/icons/huggingface-color.svg?raw";
import kimi from "@lobehub/icons-static-svg/icons/kimi.svg?raw";
import kimiColor from "@lobehub/icons-static-svg/icons/kimi-color.svg?raw";
import meta from "@lobehub/icons-static-svg/icons/meta-color.svg?raw";
import mistral from "@lobehub/icons-static-svg/icons/mistral-color.svg?raw";
import ollama from "@lobehub/icons-static-svg/icons/ollama.svg?raw";
import openAi from "@lobehub/icons-static-svg/icons/openai.svg?raw";
import vercel from "@lobehub/icons-static-svg/icons/vercel.svg?raw";
import vertex from "@lobehub/icons-static-svg/icons/vertexai-color.svg?raw";
import xai from "@lobehub/icons-static-svg/icons/xai.svg?raw";
import github from "@lobehub/icons-static-svg/icons/github.svg?raw";
import arrowRight from "lucide-static/icons/arrow-right.svg?raw";
import arrowUp from "lucide-static/icons/arrow-up.svg?raw";
import calendarClock from "lucide-static/icons/calendar-clock.svg?raw";
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
import type { DarkProviderIconId, ProviderIconId, UiIconName } from "./manifest.ts";
import { svgSymbol } from "./svg.ts";

const uiSources = {
  "arrow-right": arrowRight,
  "arrow-up": arrowUp,
  "calendar-clock": calendarClock,
  "chevron-down": chevronDown,
  "chevron-right": chevronRight,
  "external-link": externalLink,
  github,
  "list-filter": listFilter,
  "loader-circle": loaderCircle,
  moon,
  search,
  sun,
  x,
} as const satisfies Readonly<Record<UiIconName, string>>;

const providerSources = {
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
  xai,
} as const satisfies Readonly<Record<ProviderIconId, string>>;

const darkProviderSources = {
  kimi: kimiColor,
} as const satisfies Readonly<Record<DarkProviderIconId, string>>;

export const spriteSymbols = [
  ...Object.entries(uiSources).map(([name, source]) => svgSymbol(`ui-${name}`, source)),
  ...Object.entries(providerSources).map(([id, source]) => svgSymbol(`provider-${id}`, source)),
  ...Object.entries(darkProviderSources).map(([id, source]) =>
    svgSymbol(`provider-${id}-dark`, source),
  ),
].join("");

export function installIconSprite(): void {
  const sprite = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  sprite.classList.add("icon-sprite");
  sprite.setAttribute("aria-hidden", "true");
  sprite.setAttribute("focusable", "false");
  sprite.innerHTML = spriteSymbols;
  document.body.prepend(sprite);
}
