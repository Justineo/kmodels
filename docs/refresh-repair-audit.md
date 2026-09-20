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
- Vertex: grounding allowances moved from the last cell to a labeled Usage column. Header-based
  extraction restores shared pools while retaining the topology guard and raw unknown clauses.
- Kimi: formerly separate model pages now share a combined overview with two tables. Extraction
  deduplicates identical documents and preserves the new 5-minute/1-hour cache-write rates. The
  revised tools page contributes independent Search, Search Pro and Fetch fees while retaining the
  separately documented legacy built-in fee. Batch scope bindings follow source evidence.
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

A historical repair run (35174713625) attempted seven denied `curl` calls and then reported no
repairable issue. The workflow now explicitly permits the manifest-backed `vp` evidence CLI and
reviewed source hosts. The CLI exposes omitted companions even when its main bundle succeeds.
Blocked tools, missing evidence and unverified conclusions must produce an incomplete outcome.
The generated workflow compiles locally; actual remote sandbox execution remains a CI verification.

## Remaining boundaries

- Mistral's remaining differently named/new products require exact identity evidence; they are
  still repair candidates. They must not be joined by family resemblance.
- Missing owned accounting fields remain visible, including Gemini's audio selector and Cohere's
  image-token mapping. Restoring neighboring mappings does not prove those fields exist.
- The final refresh also reports the DashScope recommended-model count guard, a Kimi API 401,
  and transient Azure/Databricks transport failures. Accepted provider publication does not erase
  these individual source failures.
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
