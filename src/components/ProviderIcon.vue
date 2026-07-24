<script setup lang="ts" vapor>
import alibabaCloud from "@lobehub/icons-static-svg/icons/alibabacloud-color.svg?no-inline";
import anthropic from "@lobehub/icons-static-svg/icons/anthropic.svg?no-inline";
import bedrock from "@lobehub/icons-static-svg/icons/bedrock-color.svg?no-inline";
import cerebrasMono from "@lobehub/icons-static-svg/icons/cerebras.svg?no-inline";
import cerebras from "@lobehub/icons-static-svg/icons/cerebras-color.svg?no-inline";
import cohere from "@lobehub/icons-static-svg/icons/cohere-color.svg?no-inline";
import deepSeek from "@lobehub/icons-static-svg/icons/deepseek-color.svg?no-inline";
import gemini from "@lobehub/icons-static-svg/icons/gemini-color.svg?no-inline";
import huggingFace from "@lobehub/icons-static-svg/icons/huggingface-color.svg?no-inline";
import kimi from "@lobehub/icons-static-svg/icons/kimi-color.svg?no-inline";
import meta from "@lobehub/icons-static-svg/icons/meta-color.svg?no-inline";
import mistral from "@lobehub/icons-static-svg/icons/mistral-color.svg?no-inline";
import ollama from "@lobehub/icons-static-svg/icons/ollama.svg?no-inline";
import openAi from "@lobehub/icons-static-svg/icons/openai.svg?no-inline";
import vercel from "@lobehub/icons-static-svg/icons/vercel.svg?no-inline";
import vertex from "@lobehub/icons-static-svg/icons/vertexai-color.svg?no-inline";
import vllm from "@lobehub/icons-static-svg/icons/vllm-color.svg?no-inline";
import xai from "@lobehub/icons-static-svg/icons/xai.svg?no-inline";
import { computed } from "vue";
import databricks from "../assets/provider-icons/databricks.svg?no-inline";
import microsoftFoundry from "../assets/provider-icons/microsoft-foundry.svg?no-inline";

const icons: Readonly<Record<string, string>> = {
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

const monochromeProviderIds = new Set([
  "anthropic",
  "cerebras",
  "ollama",
  "openai",
  "vercel",
  "xai",
]);

const props = defineProps<{
  providerId: string;
  providerName: string;
}>();

const icon = computed(() => icons[props.providerId]);
const darkIcon = computed(() => (props.providerId === "cerebras" ? cerebrasMono : undefined));
const invertInDarkMode = computed(() => monochromeProviderIds.has(props.providerId));
const fallback = computed(() => props.providerName.slice(0, 1).toLocaleUpperCase());
</script>

<template>
  <span class="provider-icon" aria-hidden="true">
    <picture v-if="icon">
      <source v-if="darkIcon" :srcset="darkIcon" media="(prefers-color-scheme: dark)" />
      <img :class="{ 'provider-icon-invert-dark': invertInDarkMode }" :src="icon" alt="" />
    </picture>
    <span v-else>{{ fallback }}</span>
  </span>
</template>
