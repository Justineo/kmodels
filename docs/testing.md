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
The generated project loads and decodes its shared accepted pair in a bounded setup hook. This
keeps cold filesystem, decompression and schema-validation cost out of the first assertion's
default five-second budget; assertion and production resource limits remain independent.

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
  preserve independently known calculations and partial input mappings, while quantity evaluation
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
  intact. A completion claim distinguishes data/calculator support from a reachable UI flow.
- Require the subject to exist before asserting that one of its optional fields is absent; optional
  chaining must not allow a missing subject to satisfy the assertion accidentally.
- Prefer explicit structural assertions over large snapshots. A failure should identify the model,
  provider, asset, or contract that broke.
- Test recognizer infrastructure with properties and metamorphic examples in addition to provider
  fixtures: input order must not change bounded evidence, numeric positions must normalize, private
  identifiers must never enter samples, unrelated root extensions must be stripped and signaled,
  and malformed owned semantics must reject the complete provider candidate.

## Required validation

Use `vp node scripts/validate-changes.ts BASE_SHA` (or `HEAD` for uncommitted work). `--plan`
prints the paths and selected commands. Ordinary CI compares against the push's previous commit
or the PR base. The same planner is used inside repair and by its trusted latest-main publication.

- Code changes run formatting/lint/type checks and Vitest's related unit tests. The test-boundary
  guard is included; workflow changes also select the harness workflow checks.
- Generated data or changes in its consumer dependency closure select the generated project.
  Site and package checks run only when their source/resource dependency closures change;
  generated catalog/projection assets also select the production build.
- Filesystem-loaded fixtures cannot be fully traced by Vitest's import graph. Their change uses
  the unit-project fallback, rather than pretending that an incomplete graph proves a narrower
  scope. Focused tests remain preferable during editing when the actual readers are known.
- Shared configuration, runtime, lockfile and test-setup changes select one complete test run,
  the production build and package gates. An unavailable/initial comparison also selects this
  complete gate. `collect:fixtures` is a convenience subset, never a second gate after full tests.
- Documentation-only changes need formatting. Unchanged passing checks are not rerun while
  awaiting delivery. Re-run a failed check after its cause changes, then validate the affected
  result; a different checkout or trust boundary needs its own relevant proof.

The scheduled refresh checks the generated project and production build because code-only
behavior was already verified in CI. Repair stages run affected checks while the agent can correct
failures. Trusted post-execution checking admits the exact patch and evidence without repeating
the tests; publication independently checks the affected delta against latest `main` before commit.
This keeps the independent trust boundary without three identical test/build passes.
Publication tests cover output completeness, forbidden paths and file modes, artifact identity,
validation mutation, and concurrent-update rejection. The commit must preserve the validated tree;
a successful test process alone does not authorize publishing a different patch.
Investigation-review tests separately exercise candidate coverage and saved evidence consistency:
missing/stale candidates, the Veo rejected-URL early stop, fallback-only conclusions, missing second
passes, unsupported source-blocker labels, failed acquisition, before/after parser checks, evidence
mutation, command-status disagreement, and interrupted pending work. Stage tests require investigation
review before validation, and workflow tests verify trusted post-execution checking and artifact
retention. These are deterministic harness regressions; they do not measure whether the model chose
or interpreted the right evidence. Review real agent traces to assess investigation quality.

Calculator/package inputs select `vp run package:build` and `vp run package:check`.
Synthetic language-neutral fixtures exercise exact calculation results and stable errors. Package
checks pack an allowlisted artifact, reject frontend/collection/transport dependencies and real
provider data, and execute the same vectors in Node and a browser-like ESM context with network
access blocked. `tests/pricing-calculator-data.test.ts` belongs to the generated project and verifies
all provider exports against the canonical pair. `vp run test:data` runs that project explicitly.

The package checker also compiles consumer fixtures against the packed declarations using NodeNext
and bundler-compatible module modes. These assertions cover optional input arrays and discriminated
result/requirement types, including invalid complete and incomplete result mocks. Production builds
verify the materialized calculation endpoints, coverage parity and initialization of every provider
partition, so checking the exporter in memory cannot hide a stale checked-in export pack.
