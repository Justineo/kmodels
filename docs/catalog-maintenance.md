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

| Investigation or review result                                         | Controller action                                                                                                                  |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Empty admission with a checked no-op                                   | Record an idle run and skip independent inference.                                                                                 |
| Incomplete investigation or unavailable verification allowance         | Retain the reason and candidate history. Leave the overall repair incomplete.                                                      |
| Completed repair or no-defect proposal with candidates                 | Reserve the run allowance and independently verify every proposed closure.                                                         |
| Verified concrete contradiction                                        | Allow one bounded revision for the same evidence fingerprint and verify the resulting proposal.                                    |
| Insufficient evidence, unfinished revision, or unresolved final review | Save the available receipts and next action before the delivery job reports incomplete work.                                       |
| Supported closure                                                      | Send the verified artifact through detection and safe outputs. A repair additionally requires publication and deployment dispatch. |

A run can finish waiting for an upstream source after usage settles. Every admitted row must
document the source blocker, an alternative diagnostic and a failed acquisition receipt showing
HTTP 404 or 410 for an admitted source. The tasks remain blocked until their retry dates. A
matching removal on cooldown can sit out the next run. Unaccounted acquisition gaps, mixed
incidents with unresolved work, tool failures and incomplete verification still report incomplete delivery.

An invalid receipt or failed execution fails its owning stage. Settlement reads the journal from
the last stage that could have spent money. If that journal is missing, the reservation stays in
place. A completed initial decision reaches delivery directly. Only a takeover transfers the
initial evidence to another inference job.
Publication-validation retries load the proof from the job that uploaded the final verified
proposal and bind the regression receipt to its patch hash.

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

The refresh observer reconciles tasks, ingests discovery captures and dispatches repair only when
the event identifies the attempt that published the checked-out snapshot. A successful run that
skips publication because main advanced has no new observation to process. Older snapshot commits
with only the run URL identify the first attempt.

Tasks retain candidate identity, source/implementation fingerprint, attempts, evidence run, coverage,
reason and next action. Relocation tasks track the affected source, extractor version and failure
detail. Unrelated catalog code and sibling source changes preserve the cooldown. A changed fingerprint reopens the question and invalidates saved coverage.
Finishing a run cannot overwrite a newer attempt or results for a changed fingerprint.
An investigation superseded by a new fingerprint can still supply historical evidence for the
next run, without changing its status, cooldown or takeover allowance.
Incident selection respects severity, cooldown and waiting time; seven-day-old work cannot be
starved by new high-severity work. New failures absent from the accepted snapshot still qualify.
Blocked work backs off up to 72 hours; a checked no-defect conclusion lasts seven days unless the
fingerprint changes. The daily provider/global rotation remains independent. A cooldown-only batch with complete evidence is idle and leaves its tasks open. Idle incident slots
resume unfinished periodic reviews even when other incidents are cooling down. Admitted tasks
can load investigations from up to two prior runs. A run containing a concrete counterexample takes precedence over a later inconclusive attempt. The restored artifacts include the initial verifier, takeover
and publication-validation feedback. Candidate check results and interruption notes are leads
for the next investigation. An unpublished
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
monthly allowance. One independent comparison can use the remaining allowance to exercise the base and proposal together. New
reservations stop at USD 110 per UTC month, leaving USD 10 of the USD 120 allocation as headroom.
Trusted settlement releases unused funds. The inference job has no ledger write token.

A hash-bound concrete-error checkpoint authorizes takeover on the same lease. Takeover requires
at least USD 2 remaining and leaves USD 1 available for fresh final verification. Final verification
can use the entire remaining balance. Charges from earlier sessions count toward the USD 10 total.
For each candidate and source fingerprint, the controller records the rejected patch and its
cited executable checks. Repeated receipts for the same case do not spend another attempt.
A changed proposal or reproducer can receive a new revision under the ordinary scheduling,
call and budget limits. Older ledger entries without a case key allow the first identifiable
case. A spent candidate cannot block a new case for a sibling. A separate publication-validation
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
If the CLI exits after the gateway refuses the next call for lack of money, calls or a valid
lease month, the controller saves the interruption and returns pending work without needing a
final model message. Transport, protocol and runner failures retain their own failed stage.
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
requires no model call. One independent Codex session receives the immutable admission, original checkout and exact proposed patch. It checks the full original sources and runs its own consumer and counterexample against both trees before returning a per-candidate decision. Selected excerpts and changed-file risk heuristics do
not decide whether verification is required.

A supported conclusion needs hash-bound original evidence and successful consumer and
counterexample command receipts. A concrete error needs distinct expected and actual behavior
with supporting evidence. Receipt validation checks structure, hashes, coverage and successful
commands; it cannot mechanically prove that a model chose a sufficient semantic test. Ambiguous
or unavailable evidence remains `insufficient_evidence`. These are operational verification gates,
not a guarantee of semantic completeness.

The verifier may also cite a named read-only session input. The controller checks its exact
bytes and carries independent evidence and command receipts into the durable report. A patch,
assessment or replay summary cannot establish a finding alone. An unverifiable answer leaves
the work pending with the original response and validation reason.

Only concrete errors trigger Sol high takeover. It starts from the proposed tree, may edit only
the existing repair allowlist and must regenerate the ordinary review/regression proof for its
exact final patch. Its handoff includes the eligible contradictions, affected files, receipts
and the offline replay of any preserved verifier tests on the rejected proposal. The reviser
can act on that evidence immediately and must still prove the changed behavior.
A fresh session checks the revised patch starting from the original verifier's saved probes.
Partial notes and earlier counterexamples carry forward as investigation leads.

Independent tests live in the writable `/workspace/repair-probes` mount. The same files are
visible under `/baseline/repair-probes` for running the identical probe against the original
checkout. The reviewer can correct a probe and run it again within the same session.
The controller records the probe hashes and replays the final files offline against both
trees with read-only evidence and a three-minute test limit per tree. A no-op needs one replay.
Each supported claim still requires successful consumer and counterexample receipts.

Each Codex session runs in a disposable container with networking disabled, no capabilities,
non-root identity, read-only container filesystem, read-only Git metadata, dependencies and trusted
code. It receives no
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
The latest applicable verifier receipt settles independently of the zero-spend proposer receipt.

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
create discovery tasks even when a parser still succeeds. HTML and Markdown observations include the loss of the last tracked feature and changes beyond the first 128 features. Fenced Markdown examples contribute no navigation. Cold start establishes a baseline;
the ledger stores a bounded sample and reports additions or removals when the observations establish them.
Amount-only updates do not produce these leads. Discovery is deliberately
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
Out-of-order refresh and deployment delivery is reconciled by snapshot identity. Once deployment
is confirmed, subsequent refreshes and redeployments preserve the matched snapshot and run for
that task fingerprint. These facts
prove operational adoption, not that all provider semantics are complete. A retained old snapshot,
passing parser alone or deployment of another snapshot cannot close adoption.

State is bounded (2,000 tasks, three months of leases, 100 deployment receipts); exceeding a
schema/byte bound fails closed and requires deliberate maintenance. State and diagnostics are
operational evidence, not product data. Normal snapshot refresh remains the only owner of stored
catalog adoption, and deployment remains the existing static Void workflow.
