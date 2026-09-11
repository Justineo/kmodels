# API Pricing

### Tool Pricing

When using tools with the Agent API:

| Tool                 |          Price          | Description                                                                                                                                                                                                                                                                                         |
| -------------------- | :---------------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`web_search`**     | \$0.0025 per invocation | Performs web searches to retrieve current information                                                                                                                                                                                                                                               |
| **`fetch_url`**      | \$0.0005 per invocation | Fetches and extracts content from specific URLs                                                                                                                                                                                                                                                     |
| **`people_search`**  | \$0.005 per invocation  | Looks up professionals, employees, and people. \$5 per 1,000 tool invocations                                                                                                                                                                                                                       |
| **`finance_search`** | \$0.005 per invocation  | Retrieves financial data and market information. \$5 per 1,000 tool invocations                                                                                                                                                                                                                     |
| **`sandbox`**        |   \$0.03 per session    | Isolated container for executing code during an Agent API request. A session covers up to 20 minutes of active use for billing purposes — this is the billing window, not a runtime cap. SDK search queries made from inside the sandbox are billed at \$0.0025 per request (same as `web_search`). |

<Note>
  Most tool costs are per invocation. `sandbox` is billed per container session — a 20-minute billing window per container, not a runtime cap — plus per SDK search query made from inside it. Tool costs are separate from model token costs.
</Note>

## Search API Pricing

| API            | Price per 1K requests | Description                                    |
| -------------- | :-------------------: | ---------------------------------------------- |
| **Search API** |        \$5.00         | Raw web search results with advanced filtering |

<Note>
  **Billing unit:** Search API charges for each successful `POST /search` request, not for each query in the request. A successful request containing an array of up to five queries is one billing unit. Invalid requests, rate-limited requests, and upstream failures are not billed. A successful response is billed even when it returns no results. There are no additional token-based charges.
</Note>

## Sonar API Pricing

<SonarDeprecationNotice />

<Info>
  **Total cost per query** = Token costs + Request fee (varies by search context size, applies to Sonar, Sonar Pro, and Sonar Reasoning Pro models only)
</Info>

<Tabs>
  <Tab title="Token Pricing">
    ## Token Pricing

    **Token pricing** is based on the number of tokens in your request and response.

    | Model                   | Input Tokens (\$/1M) | Output Tokens (\$/1M) | Citation Tokens (\$/1M) | Search Queries (\$/1K) | Reasoning Tokens (\$/1M) |
    | ----------------------- | :------------------: | :-------------------: | :---------------------: | :--------------------: | :----------------------: |
    | **Sonar**               |          \$1         |          \$1          |            -            |            -           |             -            |
    | **Sonar Pro**           |          \$3         |          \$15         |            -            |            -           |             -            |
    | **Sonar Reasoning Pro** |          \$2         |          \$8          |            -            |            -           |             -            |
    | **Sonar Deep Research** |          \$2         |          \$8          |           \$2           |           \$5          |            \$3           |

  </Tab>

  <Tab title="Request Pricing">
    ## Request Pricing by Search Context Size

    **Search context** determines how much web information is retrieved. Higher context = more comprehensive results. The following table shows the request fee for each model for every **1000 requests**.

    | Model                   | Low Context Size | Medium Context Size | High Context Size |
    | ----------------------- | :--------------: | :-----------------: | :---------------: |
    | **Sonar**               |        \$5       |         \$8         |        \$12       |
    | **Sonar Pro**           |        \$6       |         \$10        |        \$14       |
    | **Sonar Reasoning Pro** |        \$6       |         \$10        |        \$14       |

    <Note>
      * **Low**: (default) fastest, cheapest
      * **Medium**: Balanced cost/quality
      * **High**: Maximum search depth, best for research

      [Learn more about search context →](https://docs.perplexity.ai/docs/sonar/filters#context-size-control)
    </Note>

  </Tab>

  <Tab title="Pro Search Pricing">
    ## Pro Search Pricing (Pro Search for Sonar Pro)

    **Pro Search** enhances Sonar Pro with automated tool usage and multi-step reasoning. When enabled, the model can perform multiple web searches and fetch URL content to answer complex queries. [Learn more about Pro Search here](/docs/sonar/pro-search/quickstart).

    <Info>
      Pro Search requires `stream: true` and is enabled via the `search_type` parameter in `web_search_options`.
    </Info>

    ### Search Type Options

    | Search Type | Description                                        |   Request Fee (per 1K)   |
    | ----------- | -------------------------------------------------- | :----------------------: |
    | **`fast`**  | (default) Standard Sonar Pro behavior              |     \$6 / \$10 / \$14    |
    | **`pro`**   | Multi-step tool usage for complex queries          |    \$14 / \$18 / \$22    |
    | **`auto`**  | Automatic classification based on query complexity | Varies by classification |

    <Note>
      Request fees vary by search context size (Low / Medium / High). Token pricing remains the same as standard Sonar Pro (\$3 per 1M input, \$15 per 1M output).
    </Note>

  </Tab>
</Tabs>

## Embeddings API Pricing

Generate high-quality text embeddings for semantic search, retrieval-augmented generation (RAG), and other machine learning applications.

### Standard Embeddings

| Model                | Dimensions | Price (\$/1M tokens) |
| -------------------- | :--------: | :------------------: |
| `pplx-embed-v1-0.6b` |    1024    |       \$0.004        |
| `pplx-embed-v1-4b`   |    2560    |        \$0.03        |

### Contextualized Embeddings

| Model                        | Dimensions | Price (\$/1M tokens) |
| ---------------------------- | :--------: | :------------------: |
| `pplx-embed-context-v1-0.6b` |    1024    |       \$0.008        |
| `pplx-embed-context-v1-4b`   |    2560    |        \$0.05        |

<Card title="View Embeddings API Documentation" icon="cube" href="/docs/embeddings/quickstart">
  Learn how to use the Embeddings API for semantic search, RAG, and more.
</Card>

<AccordionGroup>
  <Accordion title="Token and Cost Glossary">
    ### Input Tokens

    The number of tokens in your prompt or message to the API. This includes:

    * Your question or instruction
    * Any context or examples you provide
    * System messages and formatting

    **Example:** "What is the weather in New York?" = \~8 input tokens

    ### Output Tokens

    The number of tokens in the API's response. This includes:

    * The generated answer or content
    * Any explanations or additional context
    * Search results and references

    **Example:** "The weather in New York is currently sunny with a temperature of 72°F." = \~15 output tokens

    ### Citation Tokens

    Tokens used specifically for generating search results and references in responses. Only applies to **Sonar Deep Research** model.

    **Example:** Including source links, reference numbers, and bibliographic information

    ### Search Context Size vs Context Window

    **Search context size** is *not* the same as the **context window**.

    * **Search context size**: How much web information is retrieved during search (affects request pricing)
    * **Context window**: Maximum tokens the model can process in one request (affects token limits)

    ### Search Queries

    The number of individual searches conducted by **Sonar Deep Research** during query processing. This is separate from your initial user query.

    * The model automatically determines how many searches are needed
    * You cannot control the exact number of search queries
    * The `reasoning_effort` parameter influences the number of searches performed
    * Only applies to **Sonar Deep Research** model

    ### Reasoning Tokens

    Tokens used for step-by-step logical reasoning and problem-solving. Only applies to **Sonar Deep Research** model.

    **Example:** Breaking down a complex math problem into sequential steps with explanations

    <Info>
      **Token Calculation:** 1 token ≈ 4 characters in English text. The exact count may vary based on language and content complexity.
    </Info>

  </Accordion>
</AccordionGroup>
