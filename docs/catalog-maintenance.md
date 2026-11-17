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
rechecked. Previous artifact directories are excluded from new uploads to avoid recursive growth.

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

| Stage                                                    | Total run reservation                    |
| -------------------------------------------------------- | ---------------------------------------- |
| Preparation and DeepSeek investigation                   | USD 0                                    |
| Routine or semantic verification                         | Up to USD 1                              |
| Complex verification (architecture or repeated attempts) | Up to USD 2                              |
| Verified concrete error requiring takeover               | Incrementally increased to at most USD 4 |

These amounts are spending ceilings, not expected costs. New reservations stop at USD 110 per UTC
month, leaving USD 10 of the USD 120 allocation as headroom. Unused reservations are released on
trusted settlement. A dedicated serialized budget job reads the immutable admission after the
DeepSeek investigation to reserve the initial amount. The inference job has no ledger write token.

Initial verification finishes before any takeover reservation. Only its hash-bound concrete-error
checkpoint can authorize a separate budget job to extend the same lease to USD 4, subject to the
remaining monthly allowance. This is a total run ceiling, not an additional USD 4. At least USD 2
must remain before takeover starts: repair may spend at most USD 1, preserving at least USD 1 for
fresh investigation/verification. Remaining run allowance can fund that final verification.
Unchanged evidence fingerprints cannot repeatedly trigger takeover. A separate publication-validation
continuation still requires all ordinary gates.

The Codex gateway accepts at most 60 serial Responses calls per stage, each bounded to 160 KB
of text and 4,096 output tokens, and at most 40 public source acquisitions. Codex uses a
32,000-token context with early compaction. Prompts specify the remaining budget, request narrow
reads and focused checks, and reuse full acquired receipts without repeatedly dumping their bodies.
Each Codex session has a 20-minute wall-clock limit. There are no automatic HTTP/stream retries,
model fallbacks or unlimited escalation loops. Actions summaries report the stage reservation and
cumulative conservative charge for operational observation; no evaluation pipeline is added.

Accounting uses integer micro-USD and conservative token-price ceilings, including cache-write
and long-context headroom. Every call is reserved in a private atomic journal before HTTP starts.
Unknown, interrupted and failed calls retain their reservation; completed calls settle recorded
usage. A missing usage/reviewer artifact retains the larger run reservation. A month-boundary
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

The observer accepts successful main-branch refresh/deployment runs from this repository and
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
`deployed_run`. Out-of-order observer delivery is reconciled by snapshot identity. These facts
prove operational adoption, not that all provider semantics are complete. A retained old snapshot,
passing parser alone or deployment of another snapshot cannot close adoption.

State is bounded (2,000 tasks, three months of leases, 100 deployment receipts); exceeding a
schema/byte bound fails closed and requires deliberate maintenance. State and diagnostics are
operational evidence, not product data. Normal snapshot refresh remains the only owner of stored
catalog adoption, and deployment remains the existing static Void workflow.
