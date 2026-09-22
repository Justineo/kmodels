# Refresh and repair evidence audit

Status: deterministic source repairs; publication acceptance and remaining evidence gaps are tracked separately

## Decision

Start with an observed omission or unresolved discrepancy. Trace the original source, selected
documents, recognized facts, retained publication and repair input before choosing a fix.
Accepted publication and model-count bounds do not prove source coverage. A diagnostic alone
does not prove a parser defect.

The four Vercel Jev checks remain manual experiments: the real 2026-09-19 comparison added no
semantic findings or repair candidates. Scheduled refresh and repair do not run Jev.

## Current repairs

- Gemini: the video overview now links to the actual Veo parameter guide at
  `/gemini-api/docs/veo`. The manifest fetches that guide. Interactions recognizes structured
  field signatures as well as inline code. Live collection restored 21 Interactions mappings and
  two Veo selectors. The undocumented `generateAudio` selector stays missing.
- Cohere: the already-fetched Parse overview exposes identity under `Latest model`. The parser
  reads that exact label and independently verifies the Parse API endpoint. Structured page prices
  bind to the model; `meta.billed_units.pages` supplies the processed-page quantity. Model Vault
  instance rates remain excluded.
  Embed V2's indented Response field list also establishes billed image tokens; JSON examples
  need not include this optional field.
- Mistral: cards without clipboard IDs now follow bounded first-party model-document links and
  require an exact labeled API ID whose visible text agrees with its copy payload. A unique active
  repository ID or alias binds the card; exact active names remain a fallback. The latest full
  refresh has no unbound public pricing cards, while unresolved identity still fails closed.
- Bedrock: the removed `bedrock-mantle.md` companion is replaced by the official Responses API
  guide's Mantle region table. Exact region/endpoint agreement remains mandatory. Where the Price
  Lists have no model rate, exact model-card Standard token tables can supply scoped Kimi K3 and
  OpenAI rates. Kimi K3's day-first launch date and Runtime Responses route are read from its card.
  Modern cards' separate Runtime/Mantle availability tables are read without conflating endpoints;
  a current-source replay of the 15 previously omitted card paths restored all 15 without
  accepting `N/A` as an ID. The full refresh independently checks publication.
- Hugging Face/Featherless: rendered-text recognition accepts the current per-model-price wording
  while retaining the independent token formula, million-token unit and USD API contract.
- xAI: structured language prices are scoped to their actual public region. Identity and capability
  agreement remain mandatory; same-region conflicting prices still reject. Unscoped summary prices
  cannot overwrite differing regional amounts. Live source replay preserves Grok 4.6 input at
  2 USD/M tokens in us-east-1/us-west-2 and 2.2 USD/M tokens in us-central-1. The current Imagine
  Image 2.0 detail rows retain quality/resolution amounts; X Search now prices fetched posts and
  profiles separately, with no invented per-call conversion.
- DeepSeek: the peak-hour rule now excludes Chinese public holidays. Published categories retain
  the exact definition and source evidence, with no incomplete weekly schedule. The consumer
  supplies `billing_period`; collecting a price book does not require a holiday calendar.
  Accounting extraction reads rendered terminal-chunk prose and nested Responses cache fields,
  preserving the exact usage parent and stream-event requirements.
- Vertex: grounding allowances moved from the last cell to a labeled Usage column. Header-based
  extraction restores shared pools while retaining the topology guard and raw unknown clauses.
  Updated token tables, combined Omni labels, Lyria clips, and cache TTL rows are normalized from
  exact units. A Google text-embedding table's undefined `count` denominator remains bounded raw
  evidence instead of being guessed as tokens or characters.
- Anthropic: model frontmatter and pricing companions now supply current model IDs, cache
  multipliers, Fast pricing, and independently documented tool, thinking, and compaction facts.
  The unreleased Mythos preview remains unpriced.
- Azure: a Claude cache-read amount followed by a numeric HTML footnote parses as the same
  published MTok price; the footnote is not part of the amount. Delegated Foundry geography stays
  explicitly scoped.
- Kimi: formerly separate model pages now share a combined overview with two tables. Extraction
  deduplicates identical documents and preserves the new 5-minute/1-hour cache-write rates. The
  revised tools page contributes independent Search, Search Pro and Fetch fees while retaining the
  separately documented legacy built-in fee. Batch scope bindings follow source evidence.
- DashScope: recommendations now use `/<region>/model/market/detail/<encoded-id>` alongside the
  existing hash routes. Exact path parsing restores 28 models from the historical body that the
  previous parser reduced to two; the 15–60 count guard remains unchanged. The current price page
  also uses `USD` prefixes, `USD/million tokens` suffixes, and currency-bearing headers for newer
  Omni and audio models. The parser accepts those exact forms and preserves region and meter.
- Kimi releases: the Moonshot company homepage independently links the research companion's
  successor `https://www.kimi.ai/blog/`. Transport and parsing admit this exact host/path and the
  card's hyphenated dates. The optional China inventory has its own injected credential.
- Azure local transport: Retail Prices requests through the local HTTP proxy timed out during
  TLS before receiving an HTTP response. The identical public request succeeded directly, followed
  by complete pagination. A local `NO_PROXY=prices.azure.com` setting restores that route without
  changing collector proxy policy. Cloud and ordinary transport errors now retain bounded curl
  codes and failure categories instead of erasing the distinction between TLS, DNS and HTTP errors.

Provider guides and reviewed fixtures define each repaired boundary. No model inference is involved.

The complete local refresh at 2026-09-22T19:09:22.419Z published 4,310 models with 20/20 accepted
catalog and pricing partitions, no retained or withheld provider partitions. Bedrock added 15
formerly omitted model cards and now has numeric rates for 127 of 128 current models. DashScope
has numeric rates for 354 of 376, Vertex for 69 of 76 with 11 raw-rate models, Anthropic for 14
of 15, and Azure for 160 of 230. Mistral's 40 current models have no unknown prices (39 numeric),
and xAI's 22 current models all have numeric rates. These counts describe the published rate book,
not complete commercial or runtime accounting coverage.

## Repair admission and execution

Known missing accounting/endpoint/identity contracts and unrecognized public price cards now enter
repair even when publication succeeded or source bytes are unchanged. Candidates include reason
counts and diagnostic samples. Ordinary unknown meters or unbound products alone do not imply a
code defect. A source candidate does not suppress a separate pricing validation failure for the
same provider; both must reach repair.

Public HTTP 404/410 failures enter relocation review after two consecutive failures. Changing a
manifest requires an independent first-party index/link and verified replacement content. Transient
transport/auth failures are not parser repairs. When source evidence is unavailable and no
deterministic candidate exists, preparation reports incomplete rather than a healthy no-op.
Missing optional credentials alone remains normal configured scope.

The manifest-backed evidence CLI and reviewed source hosts are reachable in the remote sandbox:
run 35484173155 fetched all 13 public candidates with no firewall denial. Its premature missing-data
outcome was an investigation failure: it searched only the summary for historical hashes although
`data/fetch-state.json` contained them. Six refetched bundle hashes matched that checkout exactly.
The CLI now reports this comparison automatically, including fixed companion hashes and attempt
timestamps. Hash mismatch limits historical attribution, not independently reproducible current
repairs. A parser replay, rather than a text-link count, establishes each candidate's outcome.
The workflow completes independent validated fixes and lists unresolved candidates separately.
A deterministic post-execution check rejects incomplete, missing-data, missing-tool, or absent
final outcomes even if the agent process exits successfully. Remote execution of this new outcome
check remains a CI verification.

## Remaining boundaries

- Newly named Mistral products still require the same exact ID or alias evidence; a future card
  with only family resemblance remains a repair candidate rather than an automatic join.
- Missing owned accounting fields remain visible, including Gemini's audio selector and xAI's
  partial input contracts. Restoring neighboring mappings does not prove those fields exist.
- Current public sources still omit an exact price for Anthropic's Mythos preview and Bedrock's
  `amazon.titan-embed-g1-text-02`. Google lists three older Claude models without current token
  prices, and its embedding `count` denominator is undefined. These stay unknown or raw by design.
  SageMaker Marketplace and Hugging Face hardware-linked inventory likewise cannot be assigned
  a public per-model inference rate merely because a model is listed.
- `linkedUrls` checks selected hosts, paths, suffixes and counts but does not inventory excluded
  links. This is an observability limitation, not proof of a missed commercial page. Cohere
  demonstrates why fetched-page coverage and parser coverage must be examined separately.
- Refresh stores hashes and sanitized diagnostics rather than full original bodies. A maintenance
  refetch establishes current state; only a matching dependency hash establishes identical refresh
  evidence. Future collector snapshots need a bounded public-only design. Authenticated bodies
  remain prohibited.

## Criteria for an intelligent node

Prepare source URL/hash/time, exact relevant content and definitions, parser version/output,
publication fallback, missing items and related evidence. Distinguish original refresh evidence
from new observations. Use code for known rules, identities, rates, units and missing mappings.
Use the repair LLM for multi-document investigation and executable regression work.

Only evaluate Jev if independently reviewed real cases reveal a repeated, bounded semantic
decision left after those steps. Include an insufficient-evidence outcome. Compare confirmed
incremental defects, false dismissals, unnecessary reviews and total investigation cost against
code alone and existing repair. Typed probabilities guide review; source evidence and regression
tests establish the repair.

## Evidence

- [Repair run 35484173155](https://github.com/Justineo/kmodels/actions/runs/35484173155): its public
  evidence artifact supplies the reviewed DashScope link, Cohere field-list, and DeepSeek HTML
  fixtures. Source body hashes match that run's checkout: DashScope `1ac1c1294a26ee66…`,
  Cohere `20bad54ea66366db…`, DeepSeek `c6065126be55ea3a…`. Fixtures contain only relevant public
  excerpts; no authenticated responses were retained.
- [Moonshot company homepage](https://www.moonshot.ai/) links the successor
  [research index](https://www.kimi.ai/blog/), observed 2026-09-21. The current-card fixture
  preserves public title/date structure and an unrelated research product as a negative case.

- [Cohere model index](https://docs.cohere.com/docs/models/llms.txt),
  [Parse](https://docs.cohere.com/docs/parse.md),
  [Parse API](https://docs.cohere.com/v2/reference/parse.md), and
  [pricing](https://cohere.com/pricing).
- [Gemini Interactions](https://ai.google.dev/api/interactions-api) and
  [Veo](https://ai.google.dev/gemini-api/docs/veo).
- [Bedrock Responses API region table](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-responses-api.html).
- [Bedrock Kimi K3](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-moonshot-ai-kimi-k3.html),
  [Claude Opus 5.5](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-opus-5-5.html),
  and [GPT-5.5](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-55.html)
  show the reviewed card formats and explicit token prices where published.
- [Alibaba Cloud price book](https://www.alibabacloud.com/help/en/model-studio/model-pricing)
  contains the reviewed USD-prefixed Omni and audio pricing forms.
- [xAI API pricing](https://docs.x.ai/developers/pricing) publishes the X Search item prices and
  current Imagine Image 2.0 detail tiers.
- [DeepSeek price rule](https://api-docs.deepseek.com/quick_start/pricing/).
- Baseline local artifacts: `/tmp/kmodels-live-refresh.d9Q9X7/`; follow-up public artifacts:
  `/tmp/gh-aw/agent/catalog-evidence/`. Temporary artifacts are not repository fixtures.
- Final local refresh log: `/tmp/kmodels-research-final-v28-collect.log`; the resulting sanitized
  report is stored in `data/refresh-summary.json` with the refreshed publication.
