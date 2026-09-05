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
- Production build validation checks that the already-validated pair can be consumed and
  materialized. It is not a substitute for unit or adapter behavior tests.

The generated-data file list is defined once in `tests/generated-data-tests.ts` and consumed by Vite+
configuration and the test-boundary guard. Adding a test that reads durable generated state
requires adding it to that list. The boundary guard follows test helpers, static imports,
re-exports, dynamic imports, and URL paths recursively, including nested test directories.

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
- Test provider-specific parsing and presentation examples against fixtures or synthetic pricing.
  Generated-data tests should apply the same invariant to every applicable provider or model.
  This includes table-cell amounts and statuses and model-specific selector examples: a current
  price, model ID, or context threshold must not become a scheduled-refresh requirement. Keep
  these examples in adapter, pricing-presentation, and website projection unit tests.
- Generated pricing replay checks current extractor inputs against their manifests and verifies
  obsolete-input providers keep their exact accepted partitions. An extractor bump must not require
  a live data refresh merely to validate code changes.
- Exercise applicability budgets on both sides of the boundary. Equal-value claims that exceed one
  applicability must remain normalized as deterministic bounded shards with complete observations;
  a selector-limit raw fallback is reserved for a single indivisible claim that is itself too large.
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
- Require the subject to exist before asserting that one of its optional fields is absent; optional
  chaining must not allow a missing subject to satisfy the assertion accidentally.
- Prefer explicit structural assertions over large snapshots. A failure should identify the model,
  provider, asset, or contract that broke.
- Test recognizer infrastructure with properties and metamorphic examples in addition to provider
  fixtures: input order must not change bounded evidence, numeric positions must normalize, private
  identifiers must never enter samples, unrelated root extensions must be stripped and signaled,
  and malformed owned semantics must reject the complete provider candidate.

## Required validation

Run `vp check`, `vp test --run`, `vp run collect:fixtures`, and `vp run build` before handoff. The
scheduled refresh may run only the generated-data project because code-only behavior and reviewed
fixtures are validated on pushes and pull requests.
