export const fireworksRoot = "https://fireworks.ai/models";
export const fireworksDocs = "https://docs.fireworks.ai/serverless";
export const fireworksGuides = "https://docs.fireworks.ai/guides";
export const chatSlug = "publisher/example";
export const chatId = "accounts/fireworks/models/example";
export const routerId = "accounts/fireworks/routers/example-fast";
export const decisionId = "accounts/fireworks/models/decide";
export const embeddingAlias = "fireworks/example-embedding";
export const embeddingId = "accounts/fireworks/models/example-embedding";
export const rerankerAlias = "fireworks/example-reranker";
export const rerankerId = "accounts/fireworks/models/example-reranker";

const library = [
  {
    slug: chatSlug,
    serverless: true,
    serverlessApi: true,
    contextLength: "8192",
    tags: ["Chat"],
    supportsImageInput: true,
  },
  {
    slug: "fireworks/decide",
    serverless: true,
    serverlessApi: true,
    contextLength: null,
    tags: ["Chat"],
    supportsImageInput: false,
  },
  {
    slug: embeddingAlias,
    serverless: true,
    serverlessApi: true,
    contextLength: null,
    tags: ["Embedding"],
    supportsImageInput: false,
  },
  {
    slug: rerankerAlias,
    serverless: true,
    serverlessApi: true,
    contextLength: "4096",
    tags: ["Reranker"],
    supportsImageInput: false,
  },
  { slug: "publisher/dedicated-only", serverless: true, serverlessApi: false },
];

export const index = {
  url: fireworksRoot,
  body: `<a href="/models/publisher/dedicated-only/">Dedicated</a><script>self.__next_f.push(${JSON.stringify([1, `a:${JSON.stringify(["$", "$L1", null, { models: library }])}\n`])})</script>`,
};

export function card(
  slug: string,
  id: string,
  name: string,
  { price = "$1 / $0.2 / $3", unit = "Per 1M Tokens (input/cached input/output)" } = {},
) {
  return {
    url: `${fireworksRoot}/${slug}/`,
    body: `<link rel="canonical" href="${fireworksRoot}/${slug}"><h1>${name}</h1><div><span>model path:</span><span>${id}</span><button aria-label="Copy model path"></button></div><section><h2>Available Serverless</h2><p>${price}</p><div><p>${unit}</p></div></section>`,
  };
}

export const fireworksBundle = {
  index,
  documents: [
    card(chatSlug, chatId, "Example"),
    card("fireworks/decide", decisionId, "Decide"),
    card(embeddingAlias, embeddingId, "Example Embedding", { price: "$0.1" }),
    card(rerankerAlias, rerankerId, "Example Reranker", {
      price: "$0.2",
      unit: "Per 1M Tokens",
    }),
    {
      url: `${fireworksDocs}/pricing.md`,
      body: [
        "## Text and vision models",
        "| Model | Standard | Priority |",
        "| - | - | - |",
        "| [Example](https://app.fireworks.ai/models/fireworks/example) | $1 / $0.2 / $3 | $2 / $0.4 / $6 |",
        "| [Example Fast](https://app.fireworks.ai/models/fireworks/example) | $4 / $0.8 / $12 | — |",
        "## Decision models",
        "| Model | Standard | Priority |",
        "| - | - | - |",
        "| [Decide](https://app.fireworks.ai/models/fireworks/decide) | $1 / $0.2 / $0 | — |",
        "## Embeddings",
        "| Base model parameter count | \\$ / 1M input tokens |",
        "| - | - |",
        "| up to 150M | $0.008 |",
        "| 150M – 350M | $0.016 |",
      ].join("\n"),
    },
    {
      url: `${fireworksDocs}/serverless-modes.md`,
      body: [
        "## Fast",
        "| Model | `model` ID |",
        "| - | - |",
        `| Example Fast | \`${routerId}\` |`,
        "## Ultra-fast (Preview)",
        "| Model | `model` ID |",
        "| - | - |",
        "| Another Model | `accounts/fireworks/routers/another-ultrafast` |",
      ].join("\n"),
    },
    {
      url: `${fireworksDocs}/us-only-serverless.md`,
      body: "## Available models\n| Model | `model` ID |\n| - | - |\n| Another Model | `accounts/fireworks/routers/another-us` |",
    },
    {
      url: `${fireworksGuides}/spot-serverless.md`,
      body: [
        "## Models",
        "| Model | Spot model identifier | Standard model identifier |",
        "| - | - | - |",
        `| Example | \`${chatId}-spot\` | \`${chatId}\` |`,
        "## Pricing",
        "| Model | Tier | Cached input | Uncached input | Output |",
        "| - | - | - | - | - |",
        "| Example | Standard | $0.2 | $1 | $3 |",
        "| Example | Spot | $0.14 | $0.7 | $2.1 |",
      ].join("\n"),
    },
    {
      url: `${fireworksGuides}/querying-embeddings-models.md`,
      body: [
        "## Generating embeddings",
        "> [tab] Qwen3",
        "> | Model | Model ID | Availability |",
        "> | - | - | - |",
        `> | [Example Embedding](https://app.fireworks.ai/models/${embeddingAlias}) | [\`${embeddingAlias}\`](https://app.fireworks.ai/models/${embeddingAlias}) | Serverless and dedicated |`,
        "> [accordion] BERT-based models (legacy)",
        "> | Model id | Dimensions | Parameters |",
        "> | - | - | - |",
        "> | `Example/Small-Embed` | 384 | 33M |",
        "> | `Example/Large-Embed` | 1024 | 335M |",
        "> **Retired.** `Example/Retired-Embed`.",
        "## Reranking documents",
        "> [tab] Qwen3",
        "> | Model | Model ID | Context | Availability |",
        "> | - | - | - | - |",
        `> | [Example Reranker](https://app.fireworks.ai/models/${rerankerAlias}) | [\`${rerankerAlias}\`](https://app.fireworks.ai/models/${rerankerAlias}) | 4k | Serverless and dedicated |`,
      ].join("\n"),
    },
    {
      url: `${fireworksGuides}/video-audio-inputs.md`,
      body: [
        "## Available models",
        "| Model | Input support | Notes |",
        "| - | - | - |",
        "| Example | Image, video, text | Serverless |",
        "## Choose an inference option",
        "### Serverless",
        "```text",
        chatId,
        "```",
      ].join("\n"),
    },
  ],
};
