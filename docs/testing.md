# Testing

Status: implemented

## Test layers

- Unit tests use synthetic inputs and test one code contract without reading `data/` or the
  checked-in projection mirrors. Keep them deterministic and independent so the default project
  can run files in parallel.
- Adapter tests use reviewed files under `tests/fixtures/`. Exact IDs, values, ordering, and counts
  are appropriate here because the input is immutable until the fixture and its expected behavior
  are intentionally updated together.
- Generated-data tests read the accepted catalog/pricing pair through
  `tests/generated-data-context.ts`. They validate schemas, referential integrity, projection
  parity, security boundaries, and explicit resource budgets. They must not encode
  the current existence, price, status, or variant count of an otherwise volatile provider record.
  Source-reference closure requires every model, canonical pricing and accepted replay reference to
  resolve to a catalog source. A collected service or accounting source need not have a consumer
  in the current pair: compatible catalog observations may advance while pricing retains its
  previous inputs. Source ownership and reviewed hosts are checked independently.
- Production build validation checks that the already-validated pair can be consumed and
  materialized. It is not a substitute for unit or adapter behavior tests.
- Semantic audit tests use reviewed source fixtures and mock HTTP to verify independent source
  judgments, deterministic gap routing without inference, parser replay, cache reuse, evidence
  integrity, exact dismissals and failure isolation. The separate opt-in live evaluation measures
  marker-preserving semantic drift; see [Source semantic audit](semantic-audit.md).

The generated-data file list is defined once in `tests/generated-data-tests.ts` and consumed by Vite+
configuration and the test-boundary guard. Adding a test that reads durable generated state
requires adding it to that list. The boundary guard follows test helpers, static imports,
re-exports, dynamic imports, and URL paths recursively, including nested test directories.
The generated project reads its shared accepted pair through the normal checked mirror reader
in a bounded setup hook. The shared context retains the checked graphs and inference mapping,
releasing canonical publication fragments before consumer tests. Replay prepares its candidate
through the parallel boundary for that assertion; website projections reuse the checked inference
mapping and end caches with their synchronous phase, as in production. The reader checks schema,
metadata hashes, provenance and canonical identity; generated tests additionally exercise parallel
provider validation and compare replay and consumer outputs. This keeps cold filesystem,
decompression and schema-validation cost out of the first assertion's default five-second budget.
The full public-endpoint projection test has a 15-second budget
for rebuilding and decoding the catalog assets. Assertion and production resource limits
remain independent.

The website suite rebuilds the full inference and website publication once in a five-minute
setup hook, outside each consumer assertion's budget. On CI this shared synchronous projection
can take nearly three minutes; the assertions still enforce schema, parity and byte limits.
The Vercel request-denominator regression likewise collects its complete reviewed inventory in a
30-second setup hook, then checks the two affected rows within the normal test budget. Keep the
full provider fixture: its independent service books satisfy the provider topology contract.

For replay performance changes, compare the same committed data and pinned Node version with
the same heap limit. Measure elapsed time and peak process RSS, including worker threads;
JavaScript heap usage alone misses encoding buffers and worker memory. Verify the replayed
pricing hash and pair identity remain unchanged. Also exercise the generated-data project with
`NODE_OPTIONS=--max-old-space-size=2048 vp run test:data` to expose temporary full-graph copies
that a larger local heap would hide. Keep schema, byte-budget and global semantic checks intact.

Both test projects block unmocked Fetch, Node HTTP(S), and child-process transports. Transport
tests provide local responses explicitly; a fixture containing an official URL does not authorize
a request to that URL. Unit-test filesystem reads also reject the repository's generated `data/`
directory, including indirect default-path reads through production helpers. Temporary directories,
reviewed fixtures, repository source files, and pinned dependency assets remain valid inputs.
Time-dependent behavior uses explicit instants or a controlled clock. Environment stubs are restored
after each test, including failures.

## Assertions

- Assert public behavior and durable invariants. Do not copy the implementation into the expected
  value when a smaller relational assertion expresses the contract.
- Use exact counts for controlled fixtures and fixed vocabularies. For generated provider catalogs,
  compare projections back to the same source snapshot. Do not require minimum model, variant, or
  observation counts, complete optional-field coverage, a fixed union of source IDs or service
  families, or the presence of a particular pricing feature. Naming a changing count a calibration
  does not make it stable. Completeness and drift belong to the collector's source contracts and
  previous/candidate validation; tests exercise those rules with fixed inputs.
- Keep explicit upper bounds on payload size, chunk size, offer count, and preview length: those
  protect consumer resource contracts. Test their behavior with synthetic inputs and verify the
  current published assets stay within the same bounds.
  Website core data splits at complete model/price row boundaries into 128 KiB UTF-8 chunks.
  Verify per-chunk bounds, complete round trips, local dictionary remapping, deterministic order,
  and rejection of missing, reordered or mixed-version chunks. Normal inventory growth creates
  more chunks and has no fixed aggregate-size assertion or warning.
  Deferred model-detail, shared-offer, and provider pricing assets likewise enforce their
  2 MiB limit per chunk.
- Test provider-specific parsing and presentation examples against fixtures or synthetic pricing.
  Generated-data tests should apply the same invariant to every applicable provider or model.
  This includes table-cell amounts and statuses and model-specific selector examples: a current
  price, model ID, or context threshold must not become a scheduled-refresh requirement. Keep
  these examples in adapter, pricing-presentation, and website projection unit tests.
- Generated pricing replay checks current extractor inputs against their manifests and verifies
  obsolete-input providers keep their exact accepted partitions. An extractor bump must not require
  a live data refresh merely to validate code changes.
  An empty current replay or one rejected by the adopted-topology gate may preserve only an already-retained,
  valid accepted partition with an explicit compilation failure report; fresh failures still abort.
  An obsolete extractor preserves the already validated snapshot under its collected topology;
  new topology requirements apply to current replays and fresh collection. Registering a provider
  does not require a live refresh during code validation. Generated tests require every published
  provider to remain configured, covered, and internally valid; fixture tests validate newly
  registered adapters and features before their first authorized collection.
  A retained price snapshot is validated under its accepted evidence, rather than requiring features
  of the current extractor. Compilation inputs must follow the final composed publication state.
- Exercise applicability budgets on both sides of the boundary. Equal-value claims that exceed one
  applicability must remain normalized as deterministic bounded shards with complete observations;
  a selector-limit raw fallback is reserved for a single indivisible claim that is itself too large.
- Keep equal-price accounting contracts scoped through assembly: different signals, formulas, or
  mappings must survive, and an unbound scope must not inherit a sibling's binding. Drift tests
  preserve independently known calculations and partial input mappings, while graph validation
  still reports every missing signal.
- Treat projection closure and interaction budgets as behavior: shared resource books must not leak
  sibling-model offers, every provider pricing row must expose readable applicability, model-detail
  offer counts stay bounded, provider loading is chunk/offer-lazy, deferred offers match their
  summaries, conditional states remain visible, applicability labels stay within their display
  budget, raw-only resources remain distinct, and raw-fact previews never exceed their documented
  limit even when the canonical audit contains more facts.
- Test pricing query projection separately from component markup. Equal rate variants may bypass a
  selector only when their combined applicability covers the remaining numeric state; unequal or
  partial-scope variants must keep the selector unresolved. Component SSR tests cover the visible
  consequence: invariant rates render immediately, while price-changing context produces a focused
  prompt and no premature numeric answer.
- A published service payload or an isolated component render does not prove website availability.
  Changes to service discovery must also exercise the model inspector's real disclosure, deferred
  resource and offer loading, currency selection and current/upcoming rates in the browser. Check
  note grouping against complete offer coverage and partial or unknown scopes; keep canonical facts
  intact. A completion claim distinguishes data/lookup support from a reachable UI flow.
- Unification requires a common interaction path as well as common rate objects. Exercise a model-linked
  service and an independent provider service through the same other-charges disclosure and offer-card
  renderer. Preserve exact model/mechanism scope while checking deduplication, bounded offer loading,
  unknown pricing, future rates and individual retries. A separate resource browser that happens to
  reuse the rate body does not satisfy this contract.
- Require the subject to exist before asserting that one of its optional fields is absent; optional
  chaining must not allow a missing subject to satisfy the assertion accidentally.
- Prefer explicit structural assertions over large snapshots. A failure should identify the model,
  provider, asset, or contract that broke.
- Test recognizer infrastructure with properties and metamorphic examples in addition to provider
  fixtures: input order must not change bounded evidence, numeric positions must normalize, private
  identifiers must never enter samples, unrelated root extensions must be stripped and signaled,
  and malformed owned semantics must reject the complete provider candidate.

## Pricing interaction performance

`vp run test:pricing-performance` builds a production browser harness around the actual
`InferencePrices` and `PricingOfferBreakdown` components. Install its pinned Chromium once with
`vp exec playwright install chromium` (Linux CI uses `--with-deps`). Run it serially, without
other benchmarks or builds competing for the same machine. It never collects sources or changes
the accepted snapshot. `--fixture-only` limits the command to the stable synthetic workload.

The fixed workload has 24 regions, four tier/speed combinations, two tariff meters, and cache-TTL
overlap: 192 rate variants and 480 commercial claims. Three fresh browser contexts per component
measure cold mount and first Priority selection, followed by repeated Standard/optimized/Region/
Priority/Flex transitions. Regions alternate and have different prices; assertions require both
tariffs to match, incompatible Speed to disappear, and Region to remain editable and selected.
The offer control domain excludes user-entered native selections: those selections filter rates,
not the controls needed to change them. A declared singleton still renders as fixed scope.

A second four-region fixture varies commercial coverage: both speeds, Standard speed only,
unmapped speed, and no Standard tier. Cache rows omit Speed to exercise commercial/price scope
intersection. Both components run all 216 initial selection paths (including unset Speed) and all
enabled edits and clears from the reachable rendered states. Assertions reject empty price matches
and commercial edits that discard Region. This deterministic graph complements the fixed performance
workload; uniform regional tariffs alone cannot detect availability regressions.

Browser budgets are 750 ms for cold mount, 150 ms for first selection, and 50 ms median / 100 ms
P95 for each interaction separately. Timing covers event dispatch, matching, Vue updates and forced
layout; the next animation-frame delay is recorded separately, not treated as paint completion.
Transport, bundle loading and data decoding are outside the interaction budget. Do not average a
slow action into unrelated fast actions or retry a failed budget into a pass. Threshold changes
require a measured workload/runner rationale; they must not merely accommodate a regression.

The same run selects up to five distinct models from the checked publication, ranked by commercial
scope condition count, and exercises their available controls. Selection records the snapshot
version and model names without requiring any changing provider ID or price to exist. Models with
no editable controls report mount-only evidence; the fixed workload always requires interactions.
Reports include raw samples, percentiles, runtime/browser versions and failures, with screenshots
for browser assertion failures. Default output is `node_modules/.cache/pricing-performance/report.json`;
`PRICING_PERFORMANCE_REPORT` overrides it. CI and refresh retain reports for seven days.
Deployment also runs this gate against its actual checkout before contacting Void and retains the
same evidence. Direct main pushes and manual dispatches cannot race ahead of CI's performance check.

Deterministic unit guards complement wall-clock limits: regional scope preparation has a linear
clause-work bound and warm reuse assertion, and full matcher queries at 24 and 48 regions allow
at most eight tariff-row validation passes. These protect both batching and native-row reuse
independently of runner speed. Browser checks cover the reactive/rendering work those guards omit.
Selector validation groups predicates by dimension and serializes each caller-supplied numeric
unit once per call, using canonical keys for immutable published units. A 128-scope work guard
prevents repeated unit serialization; negative controls preserve late kind/unit conflicts,
duplicate selectors, and validation of changed caller inputs on subsequent calls.

## Required validation

For read-only offline performance comparisons, run `vp node scripts/benchmark-catalog.ts`
in a fresh process against the same hydrated snapshot and runtime. It measures pair reading
and validation, replay-input validation, compilation/preparation, and projection/packing;
it never publishes data or fetches provider sources. Results include replayed and preserved
providers, pair identity, pack/manifest hashes, output sizes, CPU time and memory observations.
It also reports reference reuse for the pricing graph and books. An unchanged replay measures
the equal-value reuse path; changed-price and changed-evidence controls are required before
generalizing its memory or latency gains to refreshes that replace pricing content.
Compare hashes before interpreting timing improvements. Repeat samples sequentially and report
their spread; do not run tests or other benchmarks concurrently. `process_max_rss_bytes` is
the process high-water mark including worker threads, while heap/Buffer measurements are
end-of-stage observations for the main thread. Neither is a per-stage allocation counter.
Network acquisition, source parsing and browser interaction need separate measurements; this
benchmark starts with accepted parsed inputs and cannot establish those costs.

Use `vp node scripts/benchmark-publication.ts` to measure cold mirror reads, actual projection
and snapshot commit, and accepted-snapshot recovery in a fresh process. Commit and recovery
always receive explicit paths in a temporary directory that is removed afterward; the script
never changes the checked-in snapshot or default journal. It records every committed file's
hash and size, provider coverage, recovered identity, stage time/CPU and process high-water
RSS. It releases the original candidate before recovery and hashes files with bounded streams
to avoid adding a measurement-only full-buffer allocation. The commit stage includes projection
work, not just filesystem writes; RSS high-water marks are cumulative, not stage-local peaks.
Cold reads mean a fresh Node process; filesystem caches are not flushed.
To isolate recovery from prior publication's process high-water mark, create a validated
temporary fixture with this flow, then recover a private copy in each fresh process. Exclude
fixture copying from the timed stage and compare identities, provider coverage and committed
file hashes against the original flow. Never recover benchmark fixtures through default paths.
File-reader controls cover large multibyte input, malformed/truncated UTF-8, duplicate decoded
keys, syntax and I-JSON rejection and encoded byte limits. Exact-comparison controls cover
cursor independence and atomic path replacement. Buffer lifetime changes must report both recovery
peak RSS and first-read latency; endpoint external memory alone is not proof of peak savings.
For peak attribution, keep diagnostic instrumentation in an isolated checkout. Sample process
RSS from another thread so synchronous parsing/serialization cannot hide the peak, and record
main/worker heap and external memory at decoding, schema cloning, worker dispatch/receipt,
semantic validation, canonical serialization and candidate construction. Correlate timestamps;
RSS is process-wide, while heap/external observations are isolate-local. Do not sum different
stages or charge external strings twice as heap and external memory. Separate forced-GC live
ownership diagnostics from ordinary runs, and use repeated uninstrumented processes for
acceptance: instrumentation itself can change allocation and GC timing. A cold-read gain does
not imply a recovery gain, or the reverse; keep each ownership path's comparison separate.
For inference publication, distinguish price-data projection, price data schema cloning,
semantic validation and mapping schema cloning. Count the selection records submitted across
all provider lookups rather than treating one small provider as representative. Partitioning
internal validation inputs must retain global negative controls for selections belonging to
providers without mapping rules, plus complete-output and caller-mutation checks.
Mirror and worker validation must agree on valid inputs and on global duplicate/I-JSON
failures, provider identity failures and foreign evidence ownership, including error context.
Cover failures in either execution path and both together, including a remote task selected
later than a failing local task in the original order. Scoped memoization controls must cover
nested calls, thrown errors and reuse of an object with changed values in a later scope.
Report wall time and CPU time separately when removing worker transport: lower CPU work and
peak residency can still increase elapsed time by giving up parallelism.
Keep graphs intentionally alive for live-cache diagnostics, then drop their owning scope and
use weak references after separate event-loop turns to distinguish strong retention from GC/OS
residency. Forced-GC observations are ownership evidence only. Repeat the complete publication
flow as well as its first-read stage; a lower live heap or first-read RSS does not establish a
lower cumulative publication peak. Freeze code and input identities, and retain any samples
excluded because an observed external validation overlapped the measurement.

At performance-series closure, verify the latest combined source rather than relying only on
earlier isolated candidates. Exercise offline replay and real temporary publication/recovery,
then check provider coverage, accepted/recovered identities, all published file hashes and the
actual generated/static/portable consumers. Keep unchanged-price, changed-price/evidence,
caller-mutation and failure/recovery controls. Report preserved obsolete-extractor partitions
separately from successful current-extractor replay. Freeze source and input fingerprints and
verify the stored publication and prepared package contract remain unchanged by verification.
Aggregate cumulative gains only within the same snapshot and workload; do not multiply
percentages across stages, diagnostics or independent schema/data migrations. State which costs
remain by design and the concrete evidence required to reopen them.

Use `vp node scripts/validate-changes.ts BASE_SHA` (or `HEAD` for uncommitted work). `--plan`
prints the paths and selected commands. Ordinary CI compares against the push's previous commit
or the PR base. Trusted repair publication uses the same planner against latest main.

- Code changes run formatting/lint/type checks and Vitest's related unit tests. The test-boundary
  guard is included; workflow changes also select the harness workflow checks.
- Generated data or changes in its consumer dependency closure select the generated project.
  A changed snapshot pointer also selects the static build because it can replace the projections.
  Site and package checks run only when their source/resource dependency closures change;
  generated catalog/projection assets also select the production build.
- Pricing component/matcher dependencies, the performance harness, generated data and full gates
  select the pricing browser check. This dependency closure includes both UI paths and their
  shared query code; unrelated collector-only changes do not force a browser run.
- Filesystem-loaded fixtures cannot be fully traced by Vitest's import graph. Their change uses
  the unit-project fallback, rather than pretending that an incomplete graph proves a narrower
  scope. Focused tests remain preferable during editing when the actual readers are known.
- Shared configuration, runtime, lockfile and test-setup changes select one complete test run,
  the production build and package gates. An unavailable/initial comparison also selects this
  complete gate. `collect:fixtures` is a convenience subset, never a second gate after full tests.
- Package generation must preserve the prepared package source tree. Compare content and modes
  before and after generation, including intentional uncommitted edits and new source artifacts;
  ignore generated runtime output. An intentional schema/entry restoration is not a build mutation.
- Documentation-only changes need formatting. Unchanged passing checks are not rerun while
  awaiting delivery. Re-run a failed check after its cause changes, then validate the affected
  result; a different checkout or trust boundary needs its own relevant proof.

The scheduled refresh checks the generated project and production build on parallel runners
against the exact staged candidate archive and collection commit, because code-only behavior
was already verified in CI. The build runner also checks pricing interaction performance before
publication, including data-only changes that do not trigger push CI. Each runner checks that validation preserved its candidate's input
fingerprint; publication reuses that same archive only after both checks pass.
Fixture replay compares ordinary collection with compressed shard round trips through the
normal provider collector. Fresh and retained-price cases must preserve provider results, fetch
history, replay/inference inputs, accepted pair identity and portable price exports without
changing the accepted model/state inputs. Boundary tests reject incomplete/duplicate groups,
mixed plans, foreign ownership and malformed result artifacts. Workflow tests bind both matrices
to one plan/revision and keep the only snapshot publication behind complete assembly and checks.
Refresh and the Actions validation planner use the same
test runner. It retries the identical command once when every reported failure is a test-body
timeout. Both attempts are logged. Assertion, hook, collection, and unhandled failures stop
that check immediately. A second timeout remains an operational failure. The repair agent demonstrates
the defect and runs focused regressions. Trusted post-execution checking admits the exact patch and
evidence, and threat detection and publication use that same artifact. Publication checks the
affected delta against latest `main` before commit. Ordinary CI and repair publication cap Vitest at
two workers.
Actions test logs show outcome totals, failed-test output, and error annotations. Successful-test
console output stays out of these logs. The validation planner logs each executed command in
Actions and prints the full plan on request with `--plan`.
When a publication check rejects the patch, the revision uses the saved failed command and
diagnostics, fresh after-repair receipts, and the same complete trusted validation. Tests cover
eligibility, retry bounds and stale proof rejection.
Publication tests cover output completeness, forbidden paths and file modes, artifact identity,
snapshot hydration and identity, validation mutation, and concurrent-update rejection. Both
publication attempts use the same bootstrap, and each commit checks the validated Git tree
and snapshot inputs.
Investigation-review tests separately exercise candidate coverage and saved evidence consistency:
missing/stale candidates, the Veo rejected-URL early stop, fallback-only conclusions, missing second
passes, unsupported source-blocker labels, failed acquisition, before/after parser checks, evidence
mutation, command-status disagreement, interrupted pending work, and a valid repair with independent
pending work. Workflow tests verify trusted post-execution checking, detector input, and artifact
retention. These are deterministic harness regressions. They do not measure whether the model chose
or interpreted the right evidence. Review real agent traces to assess investigation quality.

Portable pricing inputs select `vp run package:build` and `vp run package:check`.
Synthetic fixtures exercise unit-price queries, conditions, unknowns, validation and mutation
isolation. Package checks pack an allowlisted artifact, reject frontend/collection/transport
dependencies, and execute identical queries in Node and a browser-like ESM context with network
access blocked. Consumer fixtures compile against packed declarations in NodeNext and bundler
modes and reject usage quantities and total-cost fields. No cost conformance suite is retained.

`tests/pricing-lookup-data.test.ts` verifies all provider exports against the canonical pair.
Production builds verify materialized lookup endpoints, coverage parity and every provider
partition, preventing a stale export pack from passing an in-memory exporter test.
