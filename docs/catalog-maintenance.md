# Catalog maintenance

Status: implemented

## Execution and evidence

Catalog repair keeps the pinned gh-aw Copilot CLI executor, AWF isolation, DeepSeek BYOK,
mandatory threat detection, automatic patch allowlist and exact-patch publication checks.
DeepSeek proposes repairs and no-defect conclusions. A separate trusted job runs pinned Codex CLI
0.163.0 with `gpt-6.2-sol` high to investigate and verify every proposed closed conclusion. A
specific evidenced error permits one Codex repair attempt, followed by fresh independent
verification. Missing evidence is incomplete work. No model evaluation, benchmark or paid
experiment is added.

Refresh saves changed public source bodies and parser/contract failure evidence before losing the
bytes to retention. Captures are gzip receipts with source identity, observation time, extractor
version and SHA-256. Authenticated sources are excluded. Individual bodies are limited to 32 MiB
and each collector process to 256 MiB; oversized captures explicitly record omission. Capture
failure produces a warning and cannot change collection acceptance. Plan, shard and public-source
artifacts live for 14 days. Failed assembly investigations download the matching plan and shards;
the plan revision and artifact identity must match the actual refresh attempt. Failure logs keep
both first-error context and the tail. Missing or expired artifacts remain an evidence limit.

The repair tools unpack hash-checked captures, generate dependent parser context from actual parser
output, compare JSON facts, and update individual review rows with computed hashes. They do not
turn parser counts into consumer or transition evidence. Use the existing diagnostic `probe`
with real provider regression tests for those boundaries. No command refreshes stored data.

## Durable work and scheduling

Trusted jobs maintain `state.json` on an orphan `catalog-maintenance` branch. The agent has no
write credential for this branch. State mutations use the shared `catalog-maintenance-state`
concurrency group and compare-and-swap writes. They never hold the main publication lock while
waiting for investigation or inference. An unavailable or invalid ledger stops preparation.

Tasks retain candidate identity, source/implementation fingerprint, attempts, evidence run, coverage,
reason and next action. A changed fingerprint reopens the question and invalidates saved coverage.
Incident selection respects severity, cooldown and waiting time; seven-day-old work cannot be
starved by new high-severity work. New failures absent from the accepted snapshot still qualify.
Blocked work backs off up to 72 hours; a checked no-defect conclusion lasts seven days unless the
fingerprint changes. The daily provider/global rotation remains independent. Idle incident slots
resume unfinished periodic reviews, and admitted tasks can load up to two prior investigation
artifacts, including available semantic-review and publication-validation feedback. An unpublished
proposal explicitly directs the next run to address those findings. Prior evidence is a lead: freshness, implementation applicability and proof must be
rechecked. The investigation checker copies referenced historical proof into the current artifact
after validating the review, preserving each receipt's contents, hash and original timestamps.
It updates the review paths before independent verification. Previous artifact directories are
excluded from new uploads to avoid recursive growth.

Incident batches admit at most two due candidates from the selected provider; additional work
remains explicitly deferred. Mandatory source/execution completeness checks are still added, and
periodic provider reviews retain their full coverage contract.

Difficulty is deterministic: transport/parser work is routine; pricing, contract and provider
reviews are semantic; architecture and repeated attempts are complex. Investigation deadlines
are respectively 20, 30 and 35 minutes within the existing 45-minute execution limit. Timeout,
unknown, no-defect, code publication, data adoption and deployment remain different outcomes.

## Model routing and the USD 120 allocation

Configure repository secrets `CATALOG_REPAIR_DEEPSEEK_API_KEY` and
`CATALOG_REPAIR_OPENAI_API_KEY`. DeepSeek pays the executor and threat detector separately.
OpenAI is reserved for independent verification and concrete-error takeover, both using
`gpt-6.2-sol` high with Codex CLI. Optional GPT assistance during DeepSeek investigation is disabled.

Preparation and DeepSeek investigation reserve USD 0 of OpenAI spend. After admission, a
serialized budget job reserves up to USD 10 for the entire run attempt, subject to the remaining
monthly allowance. Each blinded baseline may use half the remaining balance and half the
remaining calls, up to 24 calls.
The proposal comparison can use all remaining funds and calls. New
reservations stop at USD 110 per UTC month, leaving USD 10 of the USD 120 allocation as headroom.
Trusted settlement releases unused funds. The inference job has no ledger write token.

A hash-bound concrete-error checkpoint authorizes takeover on the same lease. Takeover requires
at least USD 2 remaining and leaves USD 1 available for fresh final verification. Final verification
can use the entire remaining balance. Charges from earlier sessions count toward the USD 10 total.
Unchanged evidence fingerprints cannot repeatedly trigger takeover. A separate publication-validation
continuation still requires all ordinary gates.

The Codex gateway accepts at most 60 serial Responses calls per stage, each bounded to 160 KB
of text and 4,096 output tokens, and at most 40 public source acquisitions. The gateway admits
one source acquisition and one Responses call concurrently so a slow acquisition cannot block
the verifier's next inference call. Each route serves requests in arrival order with up to eight
waiting for up to three minutes. A full queue returns HTTP 429 and an expired wait returns
HTTP 503. Disconnecting releases a waiting slot. Only requests that start processing count toward the
stage limits, and inference checks the available budget after the preceding call settles.
Codex reads full source receipts from their read-only mount and uses a 32,000-token context
with early compaction and bounded tool output. The last two call slots disable further tool
use so that context compaction after a tool result leaves a slot for the actual final response.
Both calls count toward the same limit and require a monetary reservation. The gateway can
also request a final answer early when the remaining budget is low. Unresolved claims remain open.
Prompts specify the session budget, request narrow
reads and focused checks, and reuse full acquired receipts without repeatedly dumping their bodies.
Each Codex session has a 20-minute wall-clock limit. There are no automatic HTTP/stream retries,
model fallbacks or unlimited escalation loops. Actions summaries report the stage reservation and
cumulative conservative charge for operational observation; no evaluation pipeline is added.

Every verifier call reserves its worst-case cost in the private atomic journal before HTTP starts.
On completion the gateway uses the total input count to select GPT-6.2 Sol Standard rates for
short context (up to 272,000 tokens) or long context. It subtracts billed cache reads and writes
from input, prices 30-minute and 12-hour writes separately, and charges total output once.
The [pricing table](https://developers.openai.com/api/docs/pricing) owns the rates and the
[prompt caching guide](https://developers.openai.com/api/docs/guides/prompt-caching) defines the counts.
Aggregate writes with unknown lifetime use the 12-hour rate. If cache counters are missing,
the remaining input has its own unclassified line at the highest applicable rate.
Inconsistent counts, interrupted calls and failed requests retain the reservation.

Each stage's `review-usage.json` records its opening balance and one entry per dispatched request.
Successful entries include the reported token counts, context band, rate and charge per category
in integer nano-USD. The gateway rounds the sum up once to micro-USD and releases the difference
from the reservation. The opening balance plus the request charges reconciles to the cumulative
lease charge, including outstanding or retained reservations. Historical total-only receipts
remain readable. A missing usage/reviewer artifact retains the larger run reservation. A month-boundary
lease cannot make new calls. Budget exhaustion leaves any unverified repair unpublished and any unverified no-defect
conclusion open. There is no low-risk bypass or inference-confidence shortcut. The ledger is a conservative workflow allowance, not an invoice or a
provider-enforced account cap; other uses of the key are outside it. Review model prices before
changing aliases or ceilings. No live API spend is required by deterministic validation.

Only the trusted Codex gateway gets the OpenAI key. Budget jobs receive a separate GitHub token
for the maintenance branch and never receive the API key; model containers receive neither key.
Gateway accounting is private, atomic and outside model mounts. Original pages use the existing
reviewed public HTTPS hosts with ordinary redirect and byte bounds. OpenAI responses use
`store: false`, and model/source outputs remain untrusted evidence subject to ordinary repair review.

## Independent semantic review

Independent verification covers every `repaired` and `not_a_defect` review row, including an
all-no-defect run. Pending and blocked rows retain their existing meaning. An empty admission
requires no model call. The first fresh Codex session sees the original checkout and immutable
admission, before proposer explanations, patches or proof receipts are made available. It acquires
full original sources, traces consumed contracts and constructs counterexamples. The second fresh
session receives that assessment and the exact proposed patch, checks its actual consumers and
returns a structured per-candidate decision. Selected excerpts and changed-file risk heuristics do
not decide whether verification is required.

A supported conclusion needs hash-bound original evidence and successful consumer and
counterexample command receipts. A concrete error needs distinct expected and actual behavior
with supporting evidence. Receipt validation checks structure, hashes, coverage and successful
commands; it cannot mechanically prove that a model chose a sufficient semantic test. Ambiguous
or unavailable evidence remains `insufficient_evidence`. These are operational verification gates,
not a guarantee of semantic completeness.

Only concrete errors trigger Sol high takeover. It starts from the proposed tree, may edit only
the existing repair allowlist and must regenerate the ordinary review/regression proof for its
exact final patch. Even a rejected no-defect conclusion can become a repair. Two fresh verification
sessions then reassess the revised result. Their initial investigation cannot see the takeover's
explanation. Failed, exhausted or unsupported verification produces no publishable artifact.

Each Codex session runs in a disposable container with networking disabled, no capabilities,
non-root identity, read-only container filesystem, read-only Git metadata, dependencies and trusted
code. Only its disposable worktree and evidence/output directories are writable. It receives no
OpenAI key, GitHub token or Docker socket. A local relay reaches a host-owned Unix socket; the
trusted gateway supplies only bounded Responses inference and public sources belonging to the
admission, using existing reviewed HTTPS hosts and fetch limits. Original source receipts are
host-owned and mounted read-only. The gateway fixes the model, high reasoning, token limit,
endpoint and accounting; hosted tools and conversation handles are rejected. Private spending and
controller decisions are outside all model mounts. The Docker base, CLI release and downloaded
archive digest are pinned. Install the complete official CLI package with its companion executables,
including the Code Mode host, and create its writable state directory before starting a session.
The runner supplies a local model catalog to select Code Mode for GPT-6.2 Sol on the pinned CLI.

Model-writable directories are not uploaded directly. After a container stops, the controller
checks evidence for regular files only, bounded to 10,000 entries and 1 GiB, before copying it
into the artifact directory. Transcripts and results are copied through bounded regular-file
reads. Symlinks and special files cannot turn an artifact upload or host copy into filesystem
access outside the investigation.

The final job forwards a supported initial proposal without a second inference run, or resumes
the concrete-error checkpoint with the extended lease. A failed or missing final-stage usage
receipt retains the full reservation; initial spending can settle when the final job was skipped.

The final independently verified artifact is the only input to threat detection and publication.
Threat detection waits for this artifact and checks its exact hash; it still uses the existing
DeepSeek configuration. A trusted Codex repair intent can replace an original no-op only after
independent verification, safe-output processing and threat detection succeed. Publication retains
the existing allowlist, latest-main validation, exact-tree commit, normal push and bounded race
handling. The durable controller accepts closed conclusions only when the independent decision
matches the admission, review and candidate IDs, and accepts code publication only with the
matching final patch receipt. Stored data adoption remains a later refresh decision.

## Discovery, adoption and deployment

The observer accepts successful main-branch refresh runs from this repository and
executes only the trusted main checkout. Public heading, navigation and tariff-column changes
create discovery tasks even when a parser still succeeds. Cold start establishes a baseline;
unchanged structure and amounts alone do not produce these leads. Discovery is deliberately
bounded, not exhaustive web monitoring or proof of missing facts. Due tasks may dispatch repair
at most once per six hours, with the dispatch claim persisted first.

An agent saying repaired does not close the loop. Verified review plus a trusted publication
receipt records `code_published`. A subsequent successfully published refresh must contain the
repair revision, freshly accept the provider's tracked sources at the intended extractor versions,
pass the existing publication/consumer gates and no longer report the candidate before the task
becomes `adopted`. A successful deployment receipt must match that exact snapshot hash to set
`deployed_run`. Push and dispatched deployments pass the uploaded receipt's artifact ID to a
separate job in the same workflow. That job shares the maintenance ledger queue and records the
deploying run and attempt idempotently, including when only the ledger job is retried.
Out-of-order refresh and deployment delivery is reconciled by snapshot identity. These facts
prove operational adoption, not that all provider semantics are complete. A retained old snapshot,
passing parser alone or deployment of another snapshot cannot close adoption.

State is bounded (2,000 tasks, three months of leases, 100 deployment receipts); exceeding a
schema/byte bound fails closed and requires deliberate maintenance. State and diagnostics are
operational evidence, not product data. Normal snapshot refresh remains the only owner of stored
catalog adoption, and deployment remains the existing static Void workflow.
