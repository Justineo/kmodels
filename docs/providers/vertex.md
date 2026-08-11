# Vertex AI

Status: current

## Sources and identity

- Use the current Gemini Enterprise Agent Platform Google, partner, and managed-open catalogs while
  retaining provider identity `Vertex AI`. Each catalog is regional, independent, and
  non-exhaustive. Use the MaaS model list, not the generic self-deployment chooser, as the
  managed-open index.
- Pin English and crawl bounded model-card namespaces. Same-depth capability guides can be fetched,
  but only documents containing labeled model cards satisfy card-coverage bounds. Card IDs come
  from labeled `Model ID` cells; paths, headings, display labels, and approximate dates do not
  create identity.
- Fixed first-party companions cover the shared pricing page, the `Gen AI` and `Gen AI v2` Cloud
  SKU groups, the machine-readable Vertex v1beta1 Discovery document, exact
  Search/Maps/customer-data supported-model lists, Standard/Flex/Priority PayGo, Provisioned
  Throughput routing and accounting, Claude web search, partner/open response usage, the Google
  Cloud Pricing API, and Cloud Billing export latency. These documents are accounting and API
  drift guards; they do not create model identity.
- The Discovery document is the canonical machine-readable contract for the Model Garden list
  route, pagination, view enums, `PublisherModel` fields, publisher-model inference methods,
  response usage, traffic type, and grounding metadata. Pin `version=v1beta1`, but accept a moving
  eight-digit revision. Keep the exact human route guides where their v1 production path or
  provider-specific behavior is more specific than the v1beta1 Discovery surface.
- The optional paginated Model Garden inventory is account-scoped. Query the fixed publisher set
  with an explicit 300-item requested page size, Basic view, English language, and
  `listAllVersions=false`. Bound it to 20 pages and 5,000 items per publisher with four concurrent
  publishers, and reject repeated page tokens. The API documentation does not call 300 a server
  maximum. An omitted repeated field is an empty page. The inventory can validate known public
  rows but cannot create catalog rows or retain raw account data. Enable it with
  `GOOGLE_SERVICE_ACCOUNT_JSON`.

## Mapping

- Keep publisher/API families, facts, lifecycle, and exact region/deployment pairs bound to the
  relevant card section. A publisher link elsewhere on a shared page cannot classify another
  model. Partner and open indexes can contribute an exact publisher, ID, name, description, and
  modality only when a unique Model Garden URL establishes that relation.
- Normalize documented `global endpoint` and geography-labeled `Multi-region` values to `global`,
  `us`, or `eu`. Other availability requires an exact region code. A future retirement date does
  not retire a model early.
- Endpoint evidence is family-scoped and requires a fixed first-party reference: Google
  `generateContent`, `embedContent`, `predict`, or `predictLongRunning`; Claude raw prediction;
  Grok/Llama OpenAI-compatible routes; or an exact managed-open sample. Mistral partner cards,
  unlisted open models, and Live/Realtime Google cards receive no inferred endpoint.
- Price joins preserve model version, parameter size, tier, context threshold, cache TTL, region,
  deployment scope, modality, resolution, native unit, and exact conditions. A family label can
  apply to every exact ID on one card; a less-specific label otherwise requires one unique
  most-specific target.
- Expand a shared `Flex/Batch` amount into the two selectable tiers. An explicitly labeled amount
  applies only to its tier; `Online requests` is Standard and `Batch requests` is Batch. Treat
  `<=` and the published `=<` 200K heading as the same closed upper bound.
- Normalize explicit token, character, image, frame, second, request, grounded-prompt, and search-
  query prices. A fixed-duration song is one request. Gemini 3 Search, Image Search, Web Grounding,
  and Maps are charged per executed query and use `thousand_search_units`; Gemini 2.5 and older
  grounding is charged per successful grounded prompt and uses `thousand_requests`. Grounding with
  customer data remains request-priced. Bind each operation only to the exact current models listed
  in its dedicated first-party grounding guide; do not widen a family-level price row to every
  similarly prefixed Gemini ID.
- Bind Claude web search's `$10 per 1000 searches` only to models listed by the dedicated current
  Claude web-search guide. The main pricing page's embedded supported-model sentence is stale, so
  it establishes the amount but not the complete applicability set. The response's
  `server_tool_use.web_search_requests` supplies the billable search count.
- Shared grounding allowances and success/input-token billing rules remain raw allowance or
  informational facts. They span models or depend on response outcome and must not become a model-
  local zero rate. `ON_DEMAND_OFF_PEAK` is a documented response value but has no reviewed public
  price, so it receives no invented rate.
- Detect damaged labeled-price cells from repeated table structure, retain rejected suffixes as raw
  evidence, and collapse Claude's unqualified cache-write label only when it exactly duplicates the
  explicit five-minute amount. Verify page/token alternatives and alternate SKU units with exact
  decimal or structured-SKU evidence; otherwise retain ambiguity as raw.
- The two public SKU-group pages are meter-identity evidence, not price books. Require every parsed
  row to belong to the exact Vertex AI service `C7E2-9256-1C43` and carry a structured SKU ID. The
  groups overlap and can change with contracts, so they neither establish exhaustiveness nor
  numeric price. The previously considered `Select Google Cloud Offerings` group currently has no
  Vertex rows and is not a valid Vertex evidence source.
- Every reviewed pricing item receives a reconciliation disposition. Numeric rates are normalized,
  duplicate bindings are excluded, published `N/A` cells are explicit non-numeric, unsupported
  commercial structures are raw, and out-of-scope retired generations are excluded. Unbound,
  ambiguous, unsupported, or unresolved current items remain diagnostics instead of being guessed.
- Numeric coverage is diagnostic, not an acceptance threshold. An unbound or newly structured
  price row cannot remove a valid model or reject recognized sibling rates. Provider-level agents,
  tuning, optimizer examples, and Provisioned Throughput are not token base rates and are never
  attached to ordinary model offers.

## Commercial topology audit

Design status: audited and implemented for the first-party commercial atoms recognized below.
Current Google documentation has renamed the broader product to Gemini Enterprise Agent Platform;
keep provider identity `vertex` while preserving exact service and billing identities.

The collector now separates synchronous inference from Batch, preserves Standard/Flex/Priority as
returned service-tier applicability, and emits independent resource books for explicit cache
storage, Google Search, Image Search, Maps, Web Grounding, Grounded Generation, Claude Web Search,
Agent Search, Provisioned Throughput, model tuning, Deep Research, CodeMender, AlphaEvolve, and the
dynamic Model Optimizer policy. Google-model offers settle directly through Google Cloud;
partner/open MaaS offers preserve Google Cloud's reseller role. Model Optimizer's `$1` SKU and
illustrative ranges remain raw because they do not establish a reusable rate.

The wider audit ledger remains the ingestion boundary for dedicated Agent Platform, RAG, eval, and
other-resource pages not yet present as normalized claims. Their absence never licenses copying a
model price or inventing a component. New recognized rows are withheld claim-locally as raw or
unbound evidence instead of failing the provider.

### Public commercial source graph

| Surface                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Exact authority and completeness boundary                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current Google, partner, and managed-open model indexes, exact model cards, lifecycle tables, the Model Garden API, and the [v1beta1 Discovery document](https://aiplatform.googleapis.com/$discovery/rest?version=v1beta1)                                                                                                                                                                                                                                                                                                            | Public managed-model identity, explicit aliases, route/version support, regional availability, lifecycle, account inventory, response schemas, and direct API methods. Model Garden also contains self-deployable artifacts; only exact managed API/MaaS routes create global catalog models.                                          |
| [Generative AI pricing](https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing)                                                                                                                                                                                                                                                                                                                                                                                                                               | Current public amounts for exact Google, partner, managed-open, media, cache-storage, grounding, agent, tuning, and Provisioned Throughput rows. It is not an exhaustive model inventory, compatibility guide, or account bill. Example totals and non-guaranteed optimizer ranges are not reusable rates.                             |
| [Consumption options](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/deploy/consumption-options), [Standard](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/standard-paygo), [Flex](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/flex-paygo), [Priority](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/priority-paygo), and [Batch](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/batch-inference) | Synchronous tier selection, downgrade/failure behavior, asynchronous job lifecycle, completed-item billing, and exact model/mechanism support. Advertised discounts and premiums corroborate explicit rows but never synthesize missing amounts.                                                                                       |
| [Context caching](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/context-cache/context-cache-overview)                                                                                                                                                                                                                                                                                                                                                                                                          | Implicit/explicit cache behavior, cache creation charge, persistent resource/TTL, cross-traffic-type use, and response cache counters. Pricing owns cache-read and storage amounts.                                                                                                                                                    |
| [Provisioned Throughput purchase](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/provisioned-throughput/purchase-provisioned-throughput), [routing](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/provisioned-throughput/use-provisioned-throughput), and [burndown](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/provisioned-throughput/measure-provisioned-throughput)                                                                                       | GSU commitment/resource lifecycle, exact project-region-model-version scope, minimum purchase increments, capacity burndown, request routing, whole-request spillover, and monitoring signals. Public GSU money rows apply only to the capacity products they name; partner and Single Zone capacity remain sales-scoped where stated. |
| [Partner MaaS](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/use-partner-models), [managed-open MaaS](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/maas/use-open-models), exact partner guides, and [managed-open Batch](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/maas/capabilities/batch-prediction)                                                                                                                                     | Serverless versus self-deployed route, seller/publisher, EULA/terms enrollment, regional endpoint differences, exact Batch support, and partner-capacity quote boundary. An upstream provider's own price or tool support cannot fill a missing Vertex row.                                                                            |
| Google Search, Image Search, Maps, Web Grounding for Enterprise, Agent Search, custom/RAG/third-party grounding guides, and the [Grounding response](https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/rest/v1/GroundingMetadata)                                                                                                                                                                                                                                                                               | Exact tool compatibility, executed-query or grounded-request denominator, successful-result conditions, retrieved-token treatment, response evidence, and downstream resource requirements. Dedicated pricing pages own the independently billed Agent Search retrieval and Grounded Generation amounts.                               |
| [Claude Web Search](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude/web-search), [URL Context](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/url-context), Gemini model Code Execution, Computer Use, and function-calling guides                                                                                                                                                                                                                                  | Provider/server tool event, token contribution, external execution, and exact model compatibility. These guides distinguish a billed search execution from a tool declaration and model-native code execution from a persistent Agent Platform sandbox.                                                                                |
| [Gemini tuning](https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/models/tuning), tuned-model deployment, and exact tuning support tables                                                                                                                                                                                                                                                                                                                                                                       | Eligible base model/method, training-token/character calculation, job and derived-resource lifecycle, endpoint mechanics, and current tuned-inference multiplier. Account-created model and endpoint IDs are not global catalog rows.                                                                                                  |
| Model Optimizer, Deep Research, CodeMender, AlphaEvolve, Interactions, and managed-agent guides                                                                                                                                                                                                                                                                                                                                                                                                                                        | Router/agent identity, selected preference or exact agent ID, component formula, asynchronous steps, token/tool usage, billing labels, and enrollment. Dynamic examples and estimated totals remain explanatory unless the exact table labels an independently charged component.                                                      |
| [Agent Platform pricing](https://cloud.google.com/products/gemini-enterprise-agent-platform/pricing), Agent Runtime, sandbox, Sessions, Memory Bank, Skill Registry, Agent Gateway, and Semantic Governance guides                                                                                                                                                                                                                                                                                                                     | Agent Compute/Memory/Storage amounts and account allowances, resource lifecycles, request-to-capacity conversions, effective dates, and separately billed model components. The generative-model price page remains the amount authority for model/agent token offers.                                                                 |
| [Agent Search pricing](https://cloud.google.com/generative-ai-app-builder/pricing), [RAG Engine billing](https://docs.cloud.google.com/gemini-enterprise-agent-platform/build/rag-engine/rag-engine-billing), and [Gen AI Evals](https://cloud.google.com/products/gemini-enterprise-agent-platform/pricing)                                                                                                                                                                                                                           | Grounded Generation, retrieval, evaluation, parser, embedding, reranking, vector-store, and backing-service composition. Spanner, Document AI, Cloud Storage, Cloud Run, and customer databases keep their own service identities and amounts.                                                                                         |
| `Gen AI`/`Gen AI v2` SKU groups, [Cloud Billing Pricing API](https://docs.cloud.google.com/billing/docs/how-to/get-pricing-information-api), and [detailed usage export](https://docs.cloud.google.com/billing/docs/how-to/export-data-bigquery-tables/standard-usage)                                                                                                                                                                                                                                                                 | Exact Vertex service/SKU identity, public/account price, effective cost, currency, credits, adjustments, labels, and invoice settlement. SKU groups are overlapping eligibility lists, not exhaustive price books; descriptions never establish model identity.                                                                        |

Generic Model Garden self-deployment is intentionally outside the global model-catalog boundary.
It is a distribution and account-deployment route: arbitrary artifacts become private endpoints
whose cost depends on selected compute, accelerators, replicas, region, uptime, management fee,
storage, and possibly Marketplace terms. Those account resources are relevant to cost
reconstruction, but admitting every deployable artifact would confuse availability through Vertex
MaaS with the theoretical ability to host almost any model.

### Resources, books, and offer boundaries

| Book/resource                                   | Proposed offers                                                        | Boundary rationale                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public managed model                            | Synchronous PAYG inference                                             | Standard, Flex, and Priority are requested/realized traffic variants of the same synchronous mechanism. Region, context, cache, modality, and served tier qualify terms; copying them into separate offers would misrepresent downgrade and failure behavior.                                             |
| Public managed model                            | Batch inference                                                        | Separate asynchronous job mechanism with input/output storage, independent quota, queue/processing windows, item outcomes, cancellation, and completed-work billing. A shared `Flex/Batch` price cell can supply both exact amounts without making the mechanisms identical.                              |
| Public managed model                            | Live, image, video, music, embedding, OCR, and other direct mechanisms | Preserve each exact route and native denominator. Direct and Batch remain distinct where both are documented. Token/page or token/item alternatives remain one charge only when first-party evidence proves they are equivalent denominators.                                                             |
| `vertex.model-optimizer` service                | Dynamic optimized inference route                                      | One meta-endpoint chooses a Gemini intelligence level from `cost`, `balanced`, or `quality`. The `$1` SKU is a purchasing unit and published ranges are non-guaranteed examples, so this is a variable account-settled service rather than a model alias or fixed composite of catalog rates.             |
| Grounding provider-service books                | Google Search/Image Search; Maps; Web Grounding for Enterprise         | Each service owns its exact generation-specific denominator, allowance, success condition, and retrieved-token rule. Identical Gemini 3 amounts do not collapse distinct product/security identities.                                                                                                     |
| `vertex.grounded-generation` service            | Grounding on customer-provided or retrieved data                       | The `$2.50/1,000` request charge is distinct from model tokens and retrieval. Agent Search retrieval, RAG Engine, Elasticsearch, and customer Search API costs remain additional components selected by the route.                                                                                        |
| `vertex.agent-search` service                   | Enterprise data retrieval                                              | Agent Search has its own per-retrieval price and data-store lifecycle. It composes with Grounded Generation and model inference; copying only the `$2.50` grounding row would understate the public example.                                                                                              |
| `vertex.claude-web-search` service              | Claude server-side Web Search                                          | Google bills a per-search add-on for exact supported Claude MaaS models, with an explicit response counter. It is Vertex-local commercial evidence even though Anthropic and a third-party search provider participate in execution.                                                                      |
| `vertex.explicit-cache-storage` service         | Stored explicit-context tokens                                         | The cache is an account resource accruing token-hours independently of inference. Cache-read is a model term. Cache creation consumes ordinary Standard input tokens; it is a usage contribution, not a new cache-write rate.                                                                             |
| `vertex.model-tuning` service                   | Supervised, preference, reinforcement, or exact published training job | Training tokens/characters and job lifecycle differ from inference. The exact base model and method qualify the term. The resulting model/version and endpoint are account resources, not public catalog identities.                                                                                      |
| Account-derived tuned model                     | Tuned synchronous inference; tuned Batch where independently priced    | Gemini 3 tuned inference currently carries a published multiplier while older generations retain base prediction price. No idle endpoint charge applies to shared adapter endpoints. Preserve unpriced tuned mechanisms raw rather than assuming every base-model tier or Batch multiplier.               |
| Provisioned Throughput order                    | Fixed GSU commitment by term/region                                    | Capacity is acquired and billed independently of requests. One-week, one-, three-, and twelve-month terms are variants of the same commitment mechanism; Single Zone and partner-model capacity remain distinct custom-quote products where Google says to contact sales.                                 |
| Deep Research agent                             | Managed asynchronous research                                          | The exact agent owns token rates and composes with Search, Web Grounding, Agent Search, and external MCP. It is an agent resource, not a base model, and its billing label supports aggregate reconciliation.                                                                                             |
| CodeMender and AlphaEvolve agents               | Agent-token component                                                  | Their tables separate the selected Gemini-model component from an additional agent-token component; AlphaEvolve also prints the total. Keep the components additive instead of flattening the total into a fake model price. AlphaEvolve's Gemini Enterprise license is enrollment, not a token discount. |
| Agent Runtime and sandbox resources             | Runtime/Sandbox compute and memory                                     | Persistent runtime, Code Execution, and Computer Use sandbox resources accrue vCPU-seconds and GiB-seconds. This is distinct from model-native Code Execution, whose generated/reused tokens use model rates and which does not by itself prove an Agent Platform sandbox resource existed.               |
| Agent state and governance resources            | Sessions, Memory Bank, Skill Registry, Agent Gateway, Semantic policy  | Storage, reads, writes, gateway operations, and evaluation-model tokens have independent lifecycles, effective dates, and meters. Shared Agent Compute/Memory/Storage rates and allowances do not erase their resource-specific charge signals.                                                           |
| RAG Engine resource                             | Orchestrated ingestion, retrieval, and reranking                       | RAG orchestration/default parsing/fixed chunking can be explicitly free while selected LLMs, embeddings, Agent Search ranking, Document AI, vector databases, transfer, and Spanner remain separately billed. It is a component graph, not one flat RAG price.                                            |
| `vertex.gen-ai-evals` service                   | Computation metrics and legacy evaluation terms                        | Computation metrics own character rates. Current model-based metrics charge only the selected autorater model; legacy model-based metrics retain their exact published character terms.                                                                                                                   |
| Prompt Optimizer job                            | Component-composed optimization                                        | Data-driven optimization runs a custom job and may invoke target/source models, Gen AI Evals, Cloud Run custom metrics, and Cloud Storage. Without a standalone published optimizer amount, represent these components rather than a speculative flat offer.                                              |
| Self-deployed/private endpoint account resource | Online or Batch machine-time inference                                 | Account-selected VM/GPU/replica uptime and management fees determine cost; idle online replicas remain billable. This resource is not projected into the global managed-model catalog or given a token price.                                                                                             |

Model-native URL Context, Code Execution, Computer Use planning, ordinary functions, and remote MCP
do not receive generic Vertex service prices. Retrieved content, generated code/results, and
function declarations contribute quantities to the selected model meter when documented;
customer browser/API/MCP execution remains external. A zero-priced tool offer would hide the
composed model, sandbox, or downstream charge.

### Relationship matrix

| Source                                      | Target                                                            | Relationship and applicability                                                                                                                                                                                                                         |
| ------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Batch model offer                           | Same model's synchronous PAYG offer                               | `exclusive_with` for one billable execution. An account may use both mechanisms for different work.                                                                                                                                                    |
| Google Search/Image Search execution        | Exact compatible Google-model offer                               | `requires` only for the realized qualifying query/prompt. Model inference remains additive, except exact generation-specific retrieved search tokens that Google excludes. A tool declaration or support row is not execution.                         |
| Maps or Web Grounding execution             | Exact compatible Google-model offer                               | `requires` for the qualifying result. Preserve the exact per-query versus successfully grounded-prompt rule and generation-specific model universe.                                                                                                    |
| Grounding with customer data                | Exact compatible Google-model offer                               | `requires` for realized Grounded Generation. The retrieval provider is a second relationship: Agent Search, RAG Engine, Elasticsearch, or customer Search API.                                                                                         |
| Agent Search grounding                      | Grounded Generation and Agent Search retrieval                    | Two cumulative `incurs` relationships in addition to required model inference. One grounded request does not imply one retrieval if response/account evidence reports a different quantity.                                                            |
| RAG Engine pipeline                         | Exact parser, embedding, vector database, reranker, and model use | Conditional `incurs` for realized components; selected external resources remain resource prerequisites. Free default parsing/chunking does not make LLM parsing, Spanner, Document AI, or external vector storage free.                               |
| Claude Web Search execution                 | Exact supported Claude MaaS offer                                 | `requires` when `server_tool_use.web_search_requests` is positive. Organization-policy permission and tool configuration establish only eligibility/request intent.                                                                                    |
| Explicit cache resource                     | Exact cache-creation model identity                               | The resource is model-bound and persists independently. Cache creation contributes Standard input usage; later requests combine their realized model tier/cache-read term with storage already accruing on the cache resource.                         |
| Model Optimizer invocation                  | Provider-selected internal Gemini route                           | No public exact model edge. The service can route to experimental versions and settles through its own dynamic SKU; requested preference and example ranges cannot manufacture a model choice or amount.                                               |
| Tuning job                                  | Exact eligible base model                                         | Resource dependency, not inference purchase. Training does not consume the public base inference offer merely because it names the base model.                                                                                                         |
| Tuned inference                             | Account-created tuned model/endpoint                              | Requires the derived resource and its base-model lineage. The applicable multiplier or same-price rule is a rate formula, not permission to create a public model row.                                                                                 |
| Provisioned processing                      | Active exact project-region-model-version GSU order               | `requires`. Capacity covers matching direct calls; GSU burndown consumes entitlement but is not a token charge. Agents and Agent Search calls do not inherit coverage from a direct-model order.                                                       |
| Provisioned spillover                       | Same model's Standard PAYG offer                                  | Whole-request alternative outcome. Default traffic can spill to PAYG and bill its full usage; `dedicated` rejects excess with 429, while `shared` bypasses capacity. The response/monitoring request type, not the client default, resolves the route. |
| Deep Research execution                     | Agent token offer and realized tool services                      | `incurs` the agent-token component on successful agent usage and each tool service only when executed. The agent's aggregate usage and billing label do not turn it into its powering model.                                                           |
| CodeMender/AlphaEvolve execution            | Exact selected Gemini model offer                                 | `incurs`; published model and agent token terms are cumulative. AlphaEvolve additionally `requires` eligible Gemini Enterprise enrollment rather than another token meter.                                                                             |
| Managed/custom agent execution              | Realized model, tool, Runtime, and sandbox resources              | Route-local composition. Runtime and sandbox may persist across turns, so their resource cost cannot be copied onto every model request; model/tool invocations remain independently metered.                                                          |
| Memory Bank or Skill vulnerability analysis | Exact selected generation/embedding model offer                   | `incurs` model usage through contribution terms plus independent storage/read/write operations. A Memory Bank write that also reads is one write under the published operation rule.                                                                   |
| Semantic Governance evaluation              | Exact evaluation-model offer                                      | `incurs` when a response evaluation occurs. Policy configuration alone is not a charge signal.                                                                                                                                                         |
| Gen AI model-based evaluation               | Exact autorater model offer                                       | `incurs`; the service adds no separate model-based metric charge beyond prediction. Computation and legacy metric offers remain separate alternatives.                                                                                                 |
| Prompt Optimizer                            | Custom Job, model, Eval, storage, and optional Cloud Run services | Conditional `incurs` relationships for realized components. Iteration and invocation signals determine usage; job existence is not a substitute for component counters.                                                                                |
| Third-party Exa/Parallel grounding          | Exact Marketplace or Separate Offering                            | Provider-integrated compatibility with external seller/enrollment. Use the exact account offer and settlement record; never copy a third-party website price or treat marketplace acceptance as a free Vertex tool.                                    |
| Client retry after Flex failure             | New synchronous route attempt                                     | A new independently priced runtime `attempt`, not automatic Standard fallback. Preserve its requested/resolved provider, model, route, credential, outcome, and usage; create no static offer edge.                                                    |

Standard, Flex, and Priority have no commercial edges because they are variants of one synchronous
offer. Region, global endpoint, context band, cache class, promotion validity, and served traffic
type also remain applicability facts. They become relationships only when a different acquired
resource or separately owned service is involved.

URL Context, model-native Code Execution, cache creation, RAG parsing/embedding/reranking, Memory
Bank generation, and evaluation use `contribution` terms when they produce quantity charged at
another offer's rate. The source `incurs` the target offer; copying rates into service books would
create drift and double counting.

### Meters, denominators, signals, and resolution phase

| Commercial atom                        | Published denominator                                                                                         | Charge or reconciliation signal                                                                                                                                                                      | Earliest reliable phase       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Uncached model input                   | Tokens/characters by modality and exact route                                                                 | Operation-native prompt/usage partitions and exact billing SKU. Subtract cache/tool partitions only where the response schema defines inclusion.                                                     | Outcome                       |
| Cached input read                      | Cached tokens by modality                                                                                     | Gemini `cachedContentTokenCount`, Claude/Grok cache fields, or exact partner usage. Cache hits use the realized traffic type/region/context variant.                                                 | Outcome                       |
| Cache creation                         | Input tokens at Standard input rate                                                                           | Explicit cache create operation and token count. This is ordinary model-rate contribution, not a separately published cache-write amount for Gemini.                                                 | Resource outcome / account    |
| Explicit cache storage                 | Cached tokens × retained hours                                                                                | Cache size, create/update/expiry timeline, TTL, and exact storage SKU. Implicit cache has no storage charge.                                                                                         | Account resource / settlement |
| Model output and thinking              | Output tokens by modality                                                                                     | Candidate/output plus separately reported thinking tokens where output totals exclude them. Thinking uses output price and never creates a second rate.                                              | Outcome                       |
| Tool-use/retrieved model content       | Input/tool-use tokens at the selected model rate, unless explicitly excluded                                  | `toolUsePromptTokenCount`, URL Context/RAG usage, and modality details. Gemini 3 Search/Maps-provided input is explicitly excluded; other routes retain exact source semantics.                      | Outcome                       |
| Long-context band                      | Full request input and output at the exact threshold                                                          | Tokenized request/context length selects the row; every covered token uses the long rate rather than only the excess. Preserve each table's `>`, `>=`, or closed-upper-bound wording.                | Request estimate / outcome    |
| Regional/non-global model use          | Same native meter at exact endpoint geography                                                                 | Requested endpoint plus realized billing SKU. Date-scoped non-global Gemini 3 pricing applies only after its published effective date.                                                               | Request / account             |
| Priority/Flex                          | Native model usage at returned traffic type                                                                   | Gemini `trafficType`, exact partner response/account meter, or billing SKU. Priority request can resolve to Standard; rejected Flex has no model usage charge.                                       | Outcome / account             |
| Batch inference                        | Completed result item's native input/cache/output/media/page meter                                            | Per-item output/usage and job statistics. Queue entries, submitted rows, and failed/incomplete work are not billable model quantities; canceled/expired jobs retain completed outputs.               | Job outcome / account         |
| Generated image/video/music            | Exact output tokens, images, successful seconds, or fixed-duration request                                    | Successful result count/duration/resolution and exact model route. A token-plus-dollar equivalence remains one charge; requested duration cannot substitute for failed output.                       | Outcome                       |
| Gemini Live                            | Reprocessed context-window tokens per turn by modality                                                        | Per-turn usage including accumulated context; proactive audio input bills while listening, and transcription text uses text-output price. Wall-clock session duration is not a generic model charge. | Outcome                       |
| Gemini 3 Search/Image/Web/Maps         | Executed query                                                                                                | Grounding query arrays/counts and exact search type. Empty/unexecuted tools are excluded; account billing resolves hidden count where response aggregation is incomplete.                            | Outcome / account             |
| Older Search/Web/Maps                  | Successfully grounded prompt                                                                                  | At least one exact qualifying support/result and operation-specific model/generation. Several internal queries remain one prompt charge.                                                             | Outcome / account             |
| Grounded Generation with customer data | Grounded request                                                                                              | Successful grounded-generation operation and exact service SKU; model inference remains separate.                                                                                                    | Outcome / account             |
| Agent Search retrieval                 | Retrieval request                                                                                             | Agent Search operation/account counter and SKU. Grounding metadata proves retrieval occurred but may be dimensionally insufficient when several retrievals occur.                                    | Outcome / account             |
| Claude Web Search                      | Executed web search                                                                                           | `server_tool_use.web_search_requests` and exact Vertex tool SKU.                                                                                                                                     | Outcome / account             |
| Tuning                                 | Training-dataset tokens × epochs, or exact training characters                                                | Tuning job data statistics, completed epochs/job state, and exact SKU. Do not substitute file bytes or examples.                                                                                     | Job outcome / account         |
| Tuned inference                        | Base mechanism's native usage at exact same-price/multiplier rule                                             | Derived model/endpoint lineage, generation, served tier, usage, and tuned SKU. Base-model amount alone is insufficient when the current generation has an uplift.                                    | Outcome / account             |
| Provisioned Throughput commitment      | GSUs × active week/month under exact term and endpoint geography                                              | Active order timeline, GSU quantity, renewal/term, region, and capacity SKU. Billing starts on activation; unused capacity does not roll over.                                                       | Account                       |
| Provisioned capacity consumption       | Burndown-adjusted input/output units per second against available GSUs                                        | PublisherModel monitoring by `dedicated`, exact model/version, cache/media burndown, and order. This consumes entitlement, not money per token.                                                      | Outcome / account             |
| Provisioned spillover                  | Whole request's Standard PAYG native usage                                                                    | `spillover`/`shared` traffic monitoring, response usage, and PAYG SKU. One oversized request is wholly spillover rather than partially capacity-covered.                                             | Outcome / account             |
| Model Optimizer                        | Dynamic consumption settled through exact optimizer SKU                                                       | Requested preference, response usage, exact SKU quantity/effective cost, and billing export. Published example ranges and the `$1` purchasing unit cannot quote a request.                           | Account settlement            |
| Deep Research agent                    | Agent input/cached/output-thinking tokens plus each executed tool denominator                                 | Interactions aggregate usage, grounding/tool steps, `is_deep_research` label, and exact SKUs. Tool configuration alone is insufficient.                                                              | Job outcome / account         |
| CodeMender/AlphaEvolve agent           | Exact agent input/cached/output-thinking tokens plus selected-model tokens                                    | Agent result usage and component SKUs. Printed totals are consistency checks, not a replacement for component accounting.                                                                            | Outcome / account             |
| Agent Runtime/Sandbox                  | Allocated vCPU-seconds and GiB-seconds                                                                        | Runtime/sandbox resource allocation and active duration, rounded to the nearest second; Runtime idle waiting between turns is excluded.                                                              | Resource outcome / account    |
| Agent Gateway                          | API/authorization operations converted at 15,000 per Agent Compute vCPU-hour                                  | Gateway operation counter and effective-date-scoped SKU, prorated to actual usage.                                                                                                                   | Account                       |
| Sessions/Memory Bank/Skill Registry    | GiB-month storage; reads at 3M per vCPU-hour; writes at 1M per vCPU-hour                                      | Exact resource bytes/time and operation class after each published billing start date. A combined read/write operation is one write where stated.                                                    | Account                       |
| Memory/Skill/Semantic model work       | Exact selected generation/embedding/evaluation-model usage                                                    | Service operation plus returned/billing model usage. Storage or request count cannot proxy token quantity.                                                                                           | Outcome / account             |
| RAG Engine                             | Selected model tokens, parser pages, vector capacity/storage/writes, reranking, transfer, and backing compute | Component APIs/resources and their service-native SKUs. Serverless orchestration/default parse/fixed chunking are explicitly no-fee, not evidence that downstream components are free.               | Job/resource/account          |
| Gen AI Evals computation metrics       | Input and output characters                                                                                   | Evaluation job metric class and service usage. Current model-based metrics instead use exact autorater model tokens; legacy model metrics retain their published character rows.                     | Job outcome / account         |
| Self-deployed endpoint                 | Region/machine/accelerator/replica node-time plus management and storage                                      | Deployment capacity timeline and infrastructure/management SKUs; online ready/idle time remains billable, while Batch posts after job completion.                                                    | Account                       |
| Public/account settlement              | Exact Vertex/Agent/other-service SKU amount in account currency                                               | Cloud Pricing API, detailed export, labels, credits, adjustments, and invoice. Exact service/SKU binding is mandatory.                                                                               | Account settlement            |

TPM/RPM, Dynamic Shared Quota, queued Batch tokens, GSU quota, purchase increments, model
availability, and spend/budget alerts are admission, sizing, or notification facts. They never
become charge quantities merely because their units resemble a commercial meter.

### Requested, realized, capacity, allowance, enrollment, and settlement facts

- Request/resource facts select model/version, endpoint geography, Standard/Flex/Priority, Batch,
  cache, tools, target/source model, tuning method, optimizer preference, PT header, agent, and
  runtime allocation. Outcome facts select returned traffic type, successful item/media quantity,
  cache partitions, executed grounding/search, agent steps, optimizer SKU usage, and component
  model identities. Account facts select active orders, allowances, accepted terms, contract
  prices, effective dates, credits, currency, and settlement.
- Priority fallback is one synchronous attempt served and billed as Standard. Flex rejection is
  uncharged model work; a client retry is a new attempt. `ON_DEMAND_OFF_PEAK` remains a documented
  outcome without a reviewed public amount and must not inherit Flex merely because both are
  lower-priority traffic.
- A Provisioned Throughput order is a fixed commitment, not prepaid token spend. Matching
  `dedicated` traffic consumes burndown capacity; default overflow becomes a complete PAYG request,
  `shared` deliberately bypasses capacity, and `dedicated` excess returns 429. Capacity coverage is
  `included`, not free, and unused throughput does not roll over.
- Grounding and Agent Compute/Memory/Storage allowances are account/project benefits with exact
  aggregation and reset scopes. They are not copied as per-model or per-agent zero rates. Future
  billing start dates remain term validity, not user-selectable promotions.
- A Claude promotional row and its already published successor rate are time-qualified variants of
  the same offer. Current and upcoming observations can coexist; only the date-valid one estimates
  a request. A marketing label is not a calculator toggle.
- Partner MaaS may require EULA/terms acceptance, publisher-specific access, and an eligible billing
  account. Partner or Single Zone Provisioned Throughput can require a sales quote. These are
  enrollment/procurement states, independent of model lifecycle and public PAYG price validity.
- Model Optimizer's examples are neither ceilings nor quotes. Deep Research, CodeMender, and
  AlphaEvolve require realized component usage. AlphaEvolve's license enables use but does not
  cover token components unless an exact license term says so.
- Generative model pricing's HTTP-200 rule governs its stated request scope. Batch completed items,
  tuning jobs, persistent agent resources, self-deployed compute, and other Google services keep
  their own completion and settlement rules; an HTTP status cannot erase independently realized
  work.

### Commercial-atom disposition ledger

| Reviewed atom class                                                                                                         | Design disposition                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact Standard/Flex/Priority PAYG model amounts                                                                             | Normalize into one synchronous model offer with returned traffic type, endpoint geography, context, cache, modality, and validity applicability.                                                          |
| Exact Google/partner/open Batch amounts                                                                                     | Normalize into a separate Batch offer only for exact supported routes. A shared amount may populate Flex and Batch independently; unsupported Batch remains non-applicable.                               |
| Media, embedding, OCR, translation, and modality/item/time alternatives                                                     | Normalize the exact native amount. Keep one primary charge where official evidence calls another unit an equivalence; retain ambiguity raw rather than adding both.                                       |
| Explicit cache read/storage and cache-creation rule                                                                         | Cache read stays with model inference; storage enters a provider-service book; creation is Standard-input usage contribution. No generic Gemini cache-write price is invented.                            |
| Search, Image Search, Maps, Web Grounding, Grounded Generation, Agent Search, and Claude Web Search                         | Normalize into precisely named provider-service books with generation/model applicability and realized outcome signals. Preserve every additive retrieval/model component.                                |
| Search/grounding and Agent resource allowances                                                                              | Normalize only with exact beneficiary, aggregation scope, quantity, denominator, and reset period; otherwise bounded raw. Never duplicate per model/resource.                                             |
| URL Context, model-native Code Execution, RAG/model/eval contributions                                                      | Normalize exact `incurs` relationships and contribution terms to target rates. Leave only unresolved target or quantity bindings bounded raw.                                                             |
| Provisioned Throughput public GSU prices, exact support, and burndown                                                       | Normalize into capacity offers/allowances with term, scope, and native capacity meter. Partner/Single Zone quote paths remain distinct `custom_quote`; no per-request token price is derived.             |
| Model Optimizer `$1` units and example ranges                                                                               | Preserve the exact dynamic account-SKU mechanism and examples as raw explanatory evidence. No fixed public rate, model alias, midpoint, or guaranteed range is emitted.                                   |
| Tuning training rows and tuned-inference rules                                                                              | Normalize training as provider-service offers and tuned inference on an account-resource template related to its exact base model; never publish a private model ID.                                      |
| Deep Research token rows and tool composition                                                                               | Normalize an agent-resource offer plus separately executed tool services. Never attach agent token prices to the powering Gemini model.                                                                   |
| CodeMender/AlphaEvolve model, agent, and total columns                                                                      | Normalize model and agent components separately when table structure is exact; retain printed total only as reconciliation evidence. Ambiguous cells are claim-local raw.                                 |
| Agent Compute/Memory/Storage, Gateway, Sessions, Memory Bank, Skill Registry, and Semantic Governance                       | Normalize into resource/service books with effective dates and shared account allowances. Model token components remain separate usage contributions.                                                     |
| RAG Engine default-free operations and paid downstream components                                                           | Preserve explicit no-separate-charge policies for orchestration/default parse/chunking; bind exact selected model/Google/external service components without manufacturing one RAG rate.                  |
| Gen AI Evals                                                                                                                | Normalize computation/legacy character rows as service offers; current model-based metrics contribute usage to the exact autorater model and have no duplicate Eval charge.                               |
| Prompt Optimizer                                                                                                            | Preserve the orchestration/component formula; no standalone amount is emitted without first-party numeric evidence.                                                                                       |
| Self-deployed Model Garden artifacts and private endpoints                                                                  | Exclude artifacts from the global managed-model catalog. Keep endpoint compute as account-scoped infrastructure and management cost; never convert a VM-hour schedule into a public per-token model rate. |
| Third-party grounding, customer API/MCP/browser, Spanner, Document AI, Cloud Run/Storage, and external vector-store charges | Preserve the exact external/other-service boundary and account relationship. Do not import third-party price pages or collapse all Google Cloud services into the Vertex model book.                      |
| `N/A`, unsupported cells, no-endpoint-cost statements, and explicit no-fee operations                                       | Exact non-numeric, exclusion, or no-separate-charge policy according to wording. Absence/dash never becomes numeric zero; no endpoint fee does not make tuned inference free.                             |
| Unknown identity, amount, unit, new tool/agent, SKU relationship, or allowance scope                                        | Retain a safely identified atom bounded raw with a coverage warning; withhold only the unresolved claim. Never erase recognized siblings, model identity, or independent sources.                         |

### Authority and conflicts

- Exact pricing cells own public list amounts. Model cards and capability guides own identity,
  route, model compatibility, and lifecycle. Mechanism guides own requested/realized semantics and
  billable outcomes. Dedicated Agent/Agent Search/RAG/Eval price pages own their service amounts.
  Exact Cloud SKUs/account export own contract and settlement.
- The current pricing page says Gemini 3 tuned prediction is 1.5 times base and earlier generations
  remain at base price, while a generic deployment guide still says tuned inference always equals
  base. The model-generation-specific pricing statement is more precise and current for amount;
  retain the guide mismatch as a local conflict instead of suppressing tuning or base inference.
- Agent Platform's current unified Compute/Memory/Storage page supersedes legacy Reasoning Engine
  overview amounts for the renamed services and supplies future billing dates. Preserve old exact
  SKU observations as superseded evidence only when the SKU identity proves they describe the same
  resource; similar labels never authorize replacement.
- Bind catalog rows by exact publisher/model ID or one unique documented alias. Bind commercial
  settlement by exact service and SKU. No fuzzy SKU-description match, family inheritance,
  comparator vote, or LLM participates in refresh. Upstream Anthropic/xAI/Meta prices never replace
  the Vertex reseller row.
- Parse each model/card, price cell, region, promotion period, grounding/tool rule, capacity row,
  agent component, allowance, and SKU binding independently. A malformed CodeMender table cannot
  erase Gemini prices; an unknown RAG component cannot erase grounding; a broken SKU group cannot
  erase public amounts.
- A new model, price column, route, agent resource, or recognized but unsupported meter becomes a
  bounded coverage warning. Retain previous accepted claims only when the fresh authority is not
  exhaustive for absence, with their original observation and stale marker. Fresh exhaustive
  identity/lifecycle absence can remove a row; pricing and billing cannot re-admit it.
- Every discovered commercial atom receives one disposition: normalized, raw/unbound,
  non-numeric, or excluded. Completeness is measured per source/section and claim class, not by
  rejecting the provider because one fast-moving product surface drifted.

### Model-detail composition and cost coverage

Model details should present synchronous PAYG and Batch as alternative mechanisms. Standard, Flex,
and Priority are requested/realized variants inside synchronous inference; Provisioned Throughput
is a separate acquired capacity offer whose matching use is covered and whose spillover can add a
full Standard request. Regional/context/cache/media terms remain precise applicability, not extra
cards.

Search, Maps, Web Grounding, Grounded Generation, Agent Search, and Claude Web Search appear as
independently named services only on exact compatible models. Grounding with Agent Search must show
model inference + Grounded Generation + retrieval, not just one attractive subtotal. Explicit
cache storage and RAG/agent resources can accrue without a current model request and therefore stay
standalone.

Model Optimizer, Deep Research, CodeMender, AlphaEvolve, managed agents, tuning, and self-deployed
endpoints must not appear as ordinary public model aliases. Their detail views should expose the
resource/component graph, account/enrollment requirements, exact known rates, and incomplete
coverage. URL Context, model-native Code Execution, RAG, memory, and evaluation should show usage
contributions without duplicated rates.

Before dispatch, the catalog can estimate exact public PAYG/Batch/model/service components from
requested model, endpoint, tier, context, modality, cache, tools, and active public enrollment.
After response/job completion, returned traffic type, per-item usage, cache partitions, grounding
queries/supports, agent steps, media outcome, and capacity route refine the estimate. Optimizer
dynamic SKUs, PT allocation, Agent resource duration/storage, private endpoint capacity, other
Google services, contracts, credits, currency, tax, and invoice adjustments remain partial until
account evidence exists. A known model-token subtotal must never be labeled the complete Vertex
charge.

## Public estimate and account-exact cost

- The public pricing page can calculate a list-price estimate only when the gateway knows the exact
  provider surface, model/version, operation, returned Standard/Flex/Priority tier, global or non-
  global endpoint, context threshold, input/output modality, cache hit/write/storage behavior,
  resolution or duration, grounding/search count, and whether an outcome was billable. Request
  configuration alone is insufficient when Priority can downgrade or a tool can execute multiple
  queries.
- Standard PayGo's account spend tier controls quota and baseline throughput; it is not a separate
  published token price. Flex is client-selected and discounted. Priority can fall back to
  Standard, in which case the request is charged at Standard rates. The returned `trafficType` is
  the authoritative per-request tier observation.
- Provisioned Throughput is a fixed GSU subscription scoped to a project, region, model, and
  version. Its token burndown measures capacity rather than an on-demand token charge. By default,
  an overflowed whole request is processed and billed as PayGo; `dedicated` blocks overflow and
  `shared` deliberately bypasses provisioned capacity. Public token tables therefore cannot
  reconstruct a subscription's allocated per-request cost.
- The preview Google Cloud Pricing API is the first-party source for public SKU prices and custom
  contract prices associated with a billing account. It is useful only after an exact Vertex charge
  is joined to the right Cloud SKU. The Cloud Billing detailed export supplies effective price,
  negotiated discount, credits, currency, adjustments, and invoice attribution. Public tables do
  not establish those account-specific values.
- Account-level adjustments include contract discounts, promotional credits, currency conversion,
  tax, quota/allowance sharing, Priority fallback, and Provisioned Throughput commitments. They
  cannot be inferred from a public model price book or from the client request alone.

## Request, response, and freshness

- The v1beta1 Discovery schema confirms that Gemini
  `GenerateContentResponse.usageMetadata` reports prompt, candidate, tool-result prompt, thinking,
  cached-content, and total token counts. It also reports prompt/cache/candidate/tool modality
  breakdowns and `trafficType`, distinguishing Standard, Priority, Flex, Off-Peak, and Provisioned
  Throughput processing. Preserve modality breakdowns because one total-token number is not enough
  to select every public meter.
- `GroundingMetadata` reports `webSearchQueries`, `imageSearchQueries`, chunks, and supports. For
  Gemini 3, executed query arrays support query-based pricing; for older Search/Web grounding, a
  successful response with grounding support determines whether the grounded prompt is billable.
  Maps and customer-data operations still require their operation-specific response evidence.
- Claude Messages reports input, output, cache-creation, and cache-read tokens; Claude web search
  additionally reports `server_tool_use.web_search_requests`. Grok Responses reports input,
  cached-input, output, reasoning, and Google traffic-type details. Managed-open Chat Completions
  reports prompt, completion, and total tokens. These response schemas improve the estimate but do
  not reveal negotiated account price or every billing adjustment.
- Cloud Billing says detailed costs are typically available within a day and can take more than 24
  hours. Some account charges may post in 5–15 minutes, but reports, exports, alerts, and dashboards
  still lag. Provisioned Throughput monitoring is minute-granularity. None is a reliable hot-path
  cost oracle.
- Cost-based routing should use a locally cached first-party public or account-contract price book,
  deployment/account policy, and request parameters before dispatch. Update future estimates from
  returned usage, actual traffic tier, cache result, and tool counts; reconcile later against Cloud
  Billing export and invoices. Do not load-balance on delayed aggregate cost reports.

## Extraction and reconciliation

- Refresh is deterministic and non-LLM. Bounded model-card tables own identity; exact pricing table
  headers/cells own public rates; the machine-readable Discovery contract and fixed route/billing
  contracts fail closed only when their meaning can corrupt established accounting. Fast-moving
  price-table and compatibility drift is claim-local raw/unbound evidence. Pricing and SKU evidence
  never creates a catalog identity.
- Scoped SKU groups may resolve an otherwise ambiguous unit from their descriptive names; all other
  rates remain bound from the public pricing page.
- The live main pricing page and the dedicated Claude feature guide conflict on the embedded
  supported-model list: the feature guide is newer and lists current Claude 5 and newer Claude 4.x
  models omitted from the pricing table note. Keep the numeric price from the pricing row and bind
  it only through the dedicated first-party feature list. If either fast-moving structure drifts,
  withhold only Claude Web Search and report the affected claim.
- ccusage remains comparison-only because it obtains pricing through LiteLLM. The inspected
  LiteLLM snapshot has 172 Vertex-labeled entries and overlaps 18 of 69 current IDs literally or 59
  after reviewed provider-prefix normalization. Its ten normalized misses are
  `gemini-3.1-flash-lite-image`, `gemini-live-2.5-flash-native-audio`, `grok-4.3`,
  `llama-3.3-70b-instruct-maas`, all three current Lyria IDs, both managed E5 IDs, and
  `veo-3.1-lite-generate-001`. LiteLLM's single community-maintained price map represents aliases,
  retired IDs, and Gemini Developer API variants as additional entries; its richer tier keys are a
  useful completeness probe, not first-party evidence.
- models.dev has 41 `google-vertex` entries and overlaps 13 current IDs literally or 35 after
  removing reviewed publisher/version syntax. Its manually reviewed TOML files can extend a base
  family but still carry Vertex-specific cost overrides. Current gaps concentrate in legacy/new
  Claude, Grok, media/live/embedding models, and most managed-open partners. Its generated output
  flattens important conditions and is not an official-live sync.
- Portkey's published Vertex price file has 170 named entries excluding its default row, 133 with
  at least one positive numeric price, and 54 normalized current overlaps. Its community workflow
  asks contributors to edit provider JSON and cite a source. It covers more current exact IDs than
  models.dev but still misses 15 current IDs, including every current Lyria model, four Grok 4.1/4.20
  variants, both E5 models, and the newest managed-open/media outliers. These comparator books are
  useful for locating gaps, but none of their identities or values enters collection or canonical
  pricing.
