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
- Mistral: paragraph card titles can bind to one exact active repository model name when clipboard
  IDs are absent. The first full post-repair refresh restored 40 USD/EUR price facts and reduced
  unrecognized cards from 20 to 7. Partial, ambiguous or differently named products remain unbound.
- Bedrock: the removed `bedrock-mantle.md` companion is replaced by the official Responses API
  guide's Mantle region table. Exact region/endpoint agreement remains mandatory. The first full
  post-repair refresh accepted the Bedrock pricing partition again.
- Hugging Face/Featherless: rendered-text recognition accepts the current per-model-price wording
  while retaining the independent token formula, million-token unit and USD API contract.
- xAI: structured language prices are scoped to their actual public region. Identity and capability
  agreement remain mandatory; same-region conflicting prices still reject. Unscoped summary prices
  cannot overwrite differing regional amounts. Live source replay preserves Grok 4.6 input at
  2 USD/M tokens in us-east-1/us-west-2 and 2.2 USD/M tokens in us-central-1.
- DeepSeek: the peak-hour rule now excludes Chinese public holidays. Published categories retain
  the exact definition and source evidence, with no incomplete weekly schedule. The consumer
  supplies `billing_period`; collecting a price book does not require a holiday calendar.
  Accounting extraction reads rendered terminal-chunk prose and nested Responses cache fields,
  preserving the exact usage parent and stream-event requirements.
- Vertex: grounding allowances moved from the last cell to a labeled Usage column. Header-based
  extraction restores shared pools while retaining the topology guard and raw unknown clauses.
- Kimi: formerly separate model pages now share a combined overview with two tables. Extraction
  deduplicates identical documents and preserves the new 5-minute/1-hour cache-write rates. The
  revised tools page contributes independent Search, Search Pro and Fetch fees while retaining the
  separately documented legacy built-in fee. Batch scope bindings follow source evidence.
- DashScope: recommendations now use `/<region>/model/market/detail/<encoded-id>` alongside the
  existing hash routes. Exact path parsing restores 28 models from the historical body that the
  previous parser reduced to two; the 15–60 count guard remains unchanged.
- Kimi releases: the Moonshot company homepage independently links the research companion's
  successor `https://www.kimi.ai/blog/`. Transport and parsing admit this exact host/path and the
  card's hyphenated dates. The optional China inventory has its own injected credential.
- Azure local transport: Retail Prices requests through the local HTTP proxy timed out during
  TLS before receiving an HTTP response. The identical public request succeeded directly, followed
  by complete pagination. A local `NO_PROXY=prices.azure.com` setting restores that route without
  changing collector proxy policy. Cloud and ordinary transport errors now retain bounded curl
  codes and failure categories instead of erasing the distinction between TLS, DNS and HTTP errors.

Provider guides and reviewed fixtures define each repaired boundary. No model inference is involved.

The complete local refresh at 2026-09-19T23:45:35.368Z published 3,640 models with 19/19 accepted
catalog partitions and 19/19 accepted pricing partitions. DeepSeek, Kimi and Vertex pricing are
accepted: DeepSeek has 48 regional/period rate facts, Kimi has 20 model rate facts per region plus
independent services, and Vertex retains four shared allowance pools. Azure Retail Prices now
contributes 21,303 normalized facts across 123 model records and its pricing partition is accepted
after correcting the local proxy route.
These totals describe publication acceptance, not complete source or accounting coverage.

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

- Mistral's remaining differently named/new products require exact identity evidence; they are
  still repair candidates. They must not be joined by family resemblance.
- Missing owned accounting fields remain visible, including Gemini's audio selector and xAI's
  partial input contracts. Restoring neighboring mappings does not prove those fields exist.
- The latest committed refresh still predates these parser repairs. Historical-body replay restores
  DashScope recommendations and Cohere/DeepSeek mappings without rewriting generated data. Kimi
  authentication recovery requires a new run with the updated regional credentials. Accepted
  provider publication does not erase these individual source failures.
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
- [DeepSeek price rule](https://api-docs.deepseek.com/quick_start/pricing/).
- Baseline local artifacts: `/tmp/kmodels-live-refresh.d9Q9X7/`; follow-up public artifacts:
  `/tmp/gh-aw/agent/catalog-evidence/`. Temporary artifacts are not repository fixtures.
- Final local refresh log: `/tmp/kmodels-azure-transport-collect.log`; the resulting sanitized
  report is stored in `data/refresh-summary.json` with the refreshed publication.
