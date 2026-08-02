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
  parity, security boundaries, and named resource or coverage calibrations. They must not encode
  the current existence, price, status, or variant count of an otherwise volatile provider record.
- Production build validation checks that the already-validated pair can be consumed and
  materialized. It is not a substitute for unit or adapter behavior tests.

The generated-data file list is defined once in `tests/generated-data-tests.ts` and consumed by Vite+
configuration and the test-boundary guard. Adding a test that reads durable generated state
requires adding it to that list.

## Assertions

- Assert public behavior and durable invariants. Do not copy the implementation into the expected
  value when a smaller relational assertion expresses the contract.
- Use exact counts for controlled fixtures, fixed vocabularies, and explicitly reviewed resource
  budgets. For live provider catalogs, compare projections back to their source catalog or use a
  named, documented calibration range instead of today's count.
- Test provider-specific parsing and presentation examples against fixtures or synthetic pricing.
  Generated-data tests should apply the same invariant to every applicable provider or model.
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
