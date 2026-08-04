# Collection

Status: implemented

## Source trust

- `src/catalog/manifests.ts` is the reviewed provider registry and source allowlist. Requests never choose root URLs.
- Every source that can establish pricing declares a first-party pricing-evidence policy. The policy
  records whether the source is a model catalog, price book, billing catalog, commercial-terms
  surface, or scoped meter inventory; how identities may bind; and whether the source is an explicit
  snapshot, an observed current publication, or scoped current inventory. A source without this
  policy cannot contribute pricing.
- Discovered documents must match an exact same-host path policy. A source may declare one bounded
  level of nested indexes with its own exact path and count limits; only documents that satisfy the
  original content path may leave those indexes. Fixed companions require reviewed hosts, keys,
  byte limits, and an explicit format when content negotiation differs from the parent source.
- Prefer documented structured sources. Parse official catalogs only for facts structured sources do not provide.
- Provider adapters accept IDs only from labeled ID fields or reviewed structured properties and validate a provider-neutral grammar. Do not use product-name prefix lists or generic document extraction.
- Operator-defined local runtimes are configuration, not public providers.
- Publish only observed official facts. Never use an LLM, infer unsupported facts, or inherit facts across providers.
- A pricing audit reviews four first-party surfaces separately: the public commercial price book;
  request and response schemas that define rate selectors and returned usage; account, workspace,
  usage, and cost documentation that defines private adjustments and reporting delay; and
  lifecycle/release evidence needed for exact binding. A price table alone cannot establish that two
  similarly named selectors share one dimension.
- When the provider publishes a bounded documentation index such as `llms.txt`, a sitemap, or an
  OpenAPI route inventory, fetch it atomically with the reviewed companions and partition its
  commercial links against the manifest allowlist. A new relevant first-party page is a review
  signal, not an automatically trusted crawl target; failing closed here prevents a hand-picked
  pricing-page list from silently missing a new tool, account, usage, or cost surface.
- Before treating a missing rate as unknown, enumerate the official source's pricing-input
  denominator and assign every item a normalized, raw, exact non-numeric, excluded, or diagnostic
  disposition. If official prose publishes a multiplier, promotion interval, free allowance, or
  separate service charge, either parse it deterministically or record a stable explicit boundary;
  never let it disappear because the model table parsed successfully.
- Third-party registries may be used only as read-only coverage and drift comparisons. They cannot
  contribute production identities, prices, aliases, dates, or fallback values.

## Source roles and scope

- Each source declares `scope`, `exhaustive`, and `role`.
- Catalog sources create exact rows even when another row already exposes the ID as an alias.
  Supplements may create only identities that match neither a current exact ID nor a unique alias;
  otherwise they fill the matched row. Overlays may replace only declared fields on existing rows.
  This keeps a non-exhaustive lifecycle or price-book supplement from splitting a documented alias
  while still admitting an exact current identity omitted by the primary catalog.
- Account, region, workspace, and runtime inventories are scoped validation. They may fill fields the public catalog leaves undisclosed and add positive set-valued facts to exact public matches, but never override a known global fact or create or remove a global row.
- Only an exhaustive global catalog supports a completeness claim.
- Optional authenticated sources use named environment variables. Collection loads ignored `.env` values without overriding the process environment.
- Missing credentials or an optional-source failure emits a structured warning and does not weaken a successful global refresh.
- Never snapshot or publish authenticated raw responses. Redact source URLs, cloud principals, account IDs, email identities, and unmatched private identifiers from diagnostics.

## Identity matching

- An exact ID observed by a catalog creates its own row, even when another row uses it as an alias.
- Use alias matching only for overlays and scoped inventories. Remove aliases that equal a canonical ID before matching.
- Scoped matching is bidirectional but exact: match a canonical ID or alias only when the public target is unique.
- A reverse alias match cannot create a row or override a direct canonical match.
- Credential-like IDs are a publication barrier even when an official source repeats user-controlled content. Exclude them before row construction and never retain them from an older catalog.

## Provenance

- Public origin values are only `api`, `website`, and `repository`; a source may have more than one. Access method and wire format stay internal. Runtime is a scope, not an origin.
- Full catalog/API source records retain the reviewed pricing-evidence policy for audit. It is not
  copied into the website UI payload.
- Provenance is additive. Every successful allowlisted source that exactly matches a published model remains in `source_refs`.
- A successfully fetched new extractor version recomputes that source's observations. Rows and provenance omitted by the new interpretation are not retained as if the obsolete extractor had still observed them; ordinary omissions from an unchanged non-exhaustive extractor remain protected.
- Publish the latest successful record for each referenced source. If an optional source is skipped, retain its last validated record.
- Omit sources that match no published model.
- After a replacement source succeeds, remove rows and references backed only by source IDs no longer present in the manifest.

## Fetching and raw data

- Every response is size-limited, time-limited, fetched in full, and redirected only to reviewed hosts.
- Invoke `curl` without a shell for HTTP transport. One shared retry policy handles transient HTTP
  failures and reviewed cloud throttling responses, including rate-limit bodies returned with a
  successful status. It makes at most three attempts, honors bounded `Retry-After`, and otherwise
  uses exponential backoff with full jitter. Transports do not add an independent retry loop.
- Do not use conditional requests: a `304` cannot be parsed without retaining the old body.
- Bounded multi-document fetches assign the next item to the first free slot while preserving
  deterministic result order.
- Keep raw bodies in process memory only. Never write them to the repository or local disk.
- Source records retain reviewed URL, observation time, content hash, available validators, and extractor version.
- Raw replay requires a separately configured external artifact system. The
  repository does retain a bounded public-only parsed pricing compilation
  input; it contains only model identity, pricing state, parsed source price
  facts, bounded source-native raw pricing facts, source content hashes, and
  extractor versions.

## Validation and publication

- Validate candidate catalogs per provider.
- A lossy source grammar must validate the admitted share of its in-scope rows; a plausible output-model count alone is not a completeness check.
- Quarantine empty successful responses; duplicate IDs, service families, endpoints, routes, or availability pairs; unresolved route provenance; invalid prices; model drops over 10%; service-family, price-rate, endpoint, route, or availability drops over 20%; and non-promotional price changes over 50%.
- A manifest may name exact superseded IDs or ID kinds after authoritative current evidence has been reviewed. Those rows are excluded from the old comparison baseline and are not preserved, while every unlisted deletion remains protected by the normal drift guard.
- `KMODELS_REBUILD_PROVIDER` may remove the old comparison baseline for one reviewed parser migration. Every other provider still validates against its previous catalog.
- Publication is failure-closed and provider-atomic. A rejected or suspicious provider keeps its last validated catalog; providers do not block one another.
- The collector classifies a retained pricing attempt with one finite public
  code: required source unavailable, reviewed source format changed, pricing
  validation failed, provider refresh failed, or no complete pricing snapshot
  observed. Public data retains only the latest attempt time and code. Detailed
  sanitized diagnostics remain in warnings, quarantine, and refresh summaries;
  raw responses, exception stacks, account data, and credentials never enter
  the pricing snapshot.
- A successful exhaustive global catalog refresh authoritatively removes that source's stale
  provenance and routes. A missing row is retained only while another catalog source still backs
  its presence; overlay and inventory provenance can never keep a row alive. Missing observations
  from non-exhaustive catalogs remain protected. Reviewed superseded rows may still be removed
  explicitly.

## Refresh evidence

- An observation attempt and its publication decision are separate facts. A rejected attempt
  records the candidate delta, structured validation issue, and source outcomes while the published
  provider remains the last accepted partition. Reports never make a rejected candidate look like
  a successful no-op.
- Source attempts use finite outcomes: changed, unchanged, fetch failed, parse failed, or skipped
  because configuration is absent. Provider drift guards use finite issue codes plus the measured
  previous value, candidate value, and threshold where applicable.
- A pricing source reports two independent observations. Extraction counts the parsed model records,
  pricing states, normalized facts, and raw facts that left the adapter. Reconciliation accounts for
  the adapter's pricing-input denominator: every reviewed source item is normalized, preserved raw,
  classified as an exact non-numeric state, deliberately excluded, unbound, ambiguous, unsupported,
  or unresolved. Source-item accounting is preferred for row-oriented price books and billing
  catalogs; adapters without a separately enumerable source denominator fall back explicitly to
  parsed-model accounting. The report names that basis, so output coverage cannot masquerade as
  input coverage.
- Reconciliation dispositions partition the observed denominator exactly. Unbound, ambiguous,
  unsupported, and unresolved items produce bounded findings and an aggregate warning; exclusion is
  successful only with a stable reviewed reason. Public-source samples may contain a short public
  label, while authenticated or scoped sources suppress samples. This evidence is operational audit
  data only and never enters the accepted catalog, canonical pricing API, or website packs.
- Treat every structured upstream response as a language recognized at the source boundary. The
  parser contract is consumer-driven: require the fields and closed vocabularies whose meaning the
  catalog actually owns, permit documented omission when absence means unknown, and reject a new
  value or shape when accepting it could change a published fact. An extension outside the
  adapter's semantic ownership may be accepted only after the recognizer has discarded it and
  emitted `accept_with_signal` evidence; it must not silently enter the canonical model. Do not turn
  a currently common field into a requirement without a catalog invariant that depends on it.
- Contract findings carry bounded structural evidence: disposition, normalized field path,
  mismatch kind, expected and observed types, affected-item count, a stable fingerprint, and at
  most three validated public model IDs. Reports retain at most eight distinct diagnostics per
  finding and no response bodies, stack traces, private IDs, or unbounded source strings. Numeric
  array positions are normalized so the same fault has one low-cardinality identity across runs.
  `reject` findings stop that provider atomically; `accept_with_signal` findings preserve fresh data
  while making an unowned extension reviewable.
- Persist check time and consecutive failures even before a source first succeeds, and retain the
  last success when one exists. The first structured mismatch is immediately visible; repetition
  adds persistence and staleness signals. A successful parse resets the count.
- `data/refresh-summary.json` is the deterministic report for the accepted run. It includes exact
  added and removed model refs, changed refs and fields, leaf-level previous/current values for
  every changed model field, status and task transitions, exact changed sources, pricing outcomes,
  bounded per-provider pricing-resolution coverage, warnings, and the corresponding attempt
  evidence. Pricing coverage distinguishes models with public offers,
  exact not-applicable dispositions, and unresolved pricing; an unresolved model is a Kmodels
  collection outcome, not a claim that the provider publishes no price. It never copies raw response
  data, exception stacks, credentials, or private unmatched IDs. Model comparison uses the
  storage-visible JSON projection, so an omitted optional member and an explicitly `undefined`
  optional member cannot create a false model change.
- The run-level semantic outcome (`changed`, `evidence_only`, or `unchanged`) is independent of
  publication completeness (`complete` or `partial`). A retained provider therefore cannot hide
  behind an “unchanged” label, and provenance-only churn is not presented as a commercial change.
- `breaking_contract_mismatch` means a field or value owned by the projection became
  uninterpretable; `unreviewed_extension` means fresh data was accepted after an unrelated
  extension was stripped; `coverage_regression` covers explicit item or field-coverage failures;
  `possible_structural_change` is reserved for unclassified parse failures. None proves that the
  provider intentionally redesigned an API. Deterministic evidence supports, but does not replace,
  human judgment: semantic meaning, newly useful fields, and whether omission means false or
  unknown still require review. Encode repeated reviewed judgments in provider guides, parsers,
  fixtures, and explicit thresholds so later runs decide them mechanically without an LLM.
- `KMODELS_REFRESH_REPORT_PATH` may name an ephemeral copy written before pair publication. CI uses
  it for the job summary and retained artifact. This copy also carries provider wall-clock
  durations for performance diagnosis. The committed summary is written only after the
  catalog/pricing pair advances successfully and excludes nondeterministic timing data.

## Pricing

- Keep source money as decimal strings. Use decimal-string arithmetic for scaling; never use binary floating point.
- Rates are additive by meter, currency, unit, and exact conditions.
- A higher-priority observation replaces only the same rate identity. It cannot erase a distinct cache, batch, media, regional, or otherwise conditioned rate.
- An explicit empty non-unknown pricing state may clear rates.
- Adapters keep source price facts internal and assemble the sole public
  [pricing resource](pricing.md) as canonical provider price books. The model
  catalog does not publish a second flat-price projection.
- Stage 1 owns public/private admission, exact commercial-container mapping,
  stable provider atoms, and normalized-versus-raw fallback. Stage 2 validates
  the closed provider bytes and their proposed catalog slice. A failure retains
  the prior provider pair when one exists, records the failed attempt on its
  pricing snapshot, and never publishes a partial fresh partition.
- Source parsing and canonical pricing compilation are separate operations.
  Collection fetches and parses sources, validates provider candidates, and
  persists the minimal public pricing compiler input. `vp run compile:pricing`
  can rerun provider pricing assembly, full canonical validation, pair
  publication, and both consumer projections from that input without network
  access. Shared pricing assembly changes therefore do not require a source
  refresh; projection-only changes use `vp run prepare:assets`. Parser or
  extractor changes still require collection because raw response bodies are
  intentionally not retained.
- Compilation input is bound to the accepted catalog core. Provider snapshot
  metadata comes from the current accepted canonical pair rather than being
  duplicated in the input. Source IDs, extractor versions, content hashes,
  ownership, provenance, and required pricing-source completeness are
  revalidated before use. Any mismatch aborts the entire local compilation.
  Authenticated or otherwise non-public pricing inputs are never persisted;
  providers without replay input keep their exact accepted partitions.
- The refresh summary reports canonical pricing commercial additions,
  removals, changes, provenance-only changes, and retention.
- `KMODELS_PRICING_RELEASE_INPUT` is a reviewed manual release input for
  explicit fresh-empty, provider-removal, emergency pricing withdrawal, and
  accepted-pair-bound safety findings. Scheduled adapters do not infer or emit
  those operations.

## Durable outputs

Collection has four data layers:

1. allowlisted upstream response bodies, bounded and process-local;
2. minimal public parsed pricing inputs for deterministic local compilation;
3. the normalized, validated, audit-rich accepted catalog/pricing pair;
4. deterministic, pair-bound UI and JSON-export projections.

Only layers 2 through 4 are durable. Consumer code never reads layers 2 or 3
during normal development, build, or browser execution.

The committed generated state is:

- `data/catalog.json`
- `data/pricing.json.gz` (the gzip-compressed canonical pricing envelope)
- `data/pricing-inputs.json.gz` (catalog-bound, public-only parsed compiler input)
- `data/website-assets.json` (the pair-bound UI asset index)
- `data/website-assets.pack` (individually compressed audit-free UI assets)
- `data/export-assets.json` (the pair-bound public JSON-export index)
- `data/export-assets.pack` (individually compressed public JSON exports)
- `data/fetch-state.json`
- `data/quarantine.json`
- `data/refresh-summary.json`

Candidate preparation overlaps canonical serialization with work-conserving
provider validation, then freezes the exact accepted candidate. One projection
stage creates both packs without a redundant validation pass before the
accepted-pair pointer advances. Immutable pair snapshots and the atomic current
pointer remain authoritative during collection and recovery; canonical and
derived mirrors are repaired from that pointer after interruption. The
committed mirrors define the pair in a checkout, so `vp run prepare:assets`
reads them directly and regenerates projections without letting stale ignored
local state replace newer fetched or pulled data. `vp run compile:pricing`
instead reassembles canonical pricing first and then publishes the resulting
pair and projections. A reviewed pricing withdrawal may temporarily leave a
safe pricing-only source record in the catalog; the next successful fresh
provider publication prunes it.

During development, Vite lazily opens only the requested UI or export pack and
returns its compressed byte slice. It never parses `data/catalog.json` or
decompresses `data/pricing.json.gz`. Production validates the two small
manifests and compressed packs, verifies their shared pair identity, and
stream-decompresses each entry into ignored `dist/`; it never reconstructs the
canonical pricing object graph. The website loads only `/ui/` projections; the
public catalog profiles and audit-rich canonical data remain available at the
explicit `/catalog/` and `/pricing/` endpoints. Do not commit duplicate endpoint
assets under `public/`.
