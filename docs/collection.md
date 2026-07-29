# Collection

Status: implemented

## Source trust

- `src/catalog/manifests.ts` is the reviewed provider registry and source allowlist. Requests never choose root URLs.
- Discovered documents must match an exact same-host path policy. Fixed companions require reviewed hosts, keys, and byte limits.
- Prefer documented structured sources. Parse official catalogs only for facts structured sources do not provide.
- Provider adapters accept IDs only from labeled ID fields or reviewed structured properties and validate a provider-neutral grammar. Do not use product-name prefix lists or generic document extraction.
- Operator-defined local runtimes are configuration, not public providers.
- Publish only observed official facts. Never use an LLM, infer unsupported facts, or inherit facts across providers.

## Source roles and scope

- Each source declares `scope`, `exhaustive`, and `role`.
- Catalog sources may create rows. Overlays may replace only declared fields on existing rows.
- Account, region, workspace, and runtime inventories are scoped validation. They may enrich exact public matches but cannot create or remove global rows.
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
- Provenance is additive. Every successful allowlisted source that exactly matches a published model remains in `source_refs`.
- Publish the latest successful record for each referenced source. If an optional source is skipped, retain its last validated record.
- Omit sources that match no published model.
- After a replacement source succeeds, remove rows and references backed only by source IDs no longer present in the manifest.

## Fetching and raw data

- Every response is size-limited, time-limited, fetched in full, and redirected only to reviewed hosts.
- Invoke `curl` without a shell for the common HTTP transport. Retry only transient failures.
- Do not use conditional requests: a `304` cannot be parsed without retaining the old body.
- Keep raw bodies in process memory only. Never write them to the repository or local disk.
- Source records retain reviewed URL, observation time, content hash, available validators, and extractor version.
- The accepted `data/catalog.json` and compressed `data/pricing.json.gz` pair is the sole
  durable last-known-good public-data input. Raw replay requires a separately
  configured external artifact system.

## Validation and publication

- Validate candidate catalogs per provider.
- Quarantine empty successful responses; duplicate IDs, service families, endpoints, routes, or availability pairs; unresolved route provenance; invalid prices; model drops over 10%; service-family, price-rate, endpoint, route, or availability drops over 20%; and non-promotional price changes over 50%.
- `KMODELS_REBUILD_PROVIDER` may remove the old comparison baseline for one reviewed parser migration. Every other provider still validates against its previous catalog.
- Publication is failure-closed and provider-atomic. A rejected or suspicious provider keeps its last validated catalog; providers do not block one another.
- The collector classifies a retained pricing attempt with one finite public
  code: required source unavailable, reviewed source format changed, pricing
  validation failed, provider refresh failed, or no complete pricing snapshot
  observed. Public data retains only the latest attempt time and code. Detailed
  sanitized diagnostics remain in warnings, quarantine, and refresh summaries;
  raw responses, exception stacks, account data, and credentials never enter
  the pricing snapshot.
- One missing observation never deletes a model.
- Every run writes `data/refresh-summary.json`, a deterministic semantic diff with provider/model/source counts, changed-field counts, content changes, coverage, and warning codes. It never copies raw data or private unmatched IDs.

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
- The refresh summary reports canonical pricing commercial additions,
  removals, changes, provenance-only changes, and retention.
- `KMODELS_PRICING_RELEASE_INPUT` is a reviewed manual release input for
  explicit fresh-empty, provider-removal, emergency pricing withdrawal, and
  accepted-pair-bound safety findings. Scheduled adapters do not infer or emit
  those operations.

## Durable outputs

The committed generated state is:

- `data/catalog.json`
- `data/pricing.json.gz` (the gzip-compressed canonical pricing envelope)
- `data/fetch-state.json`
- `data/quarantine.json`
- `data/refresh-summary.json`

Collection commits the catalog and pricing through one accepted-pair boundary: immutable pair
snapshots and an atomic current pointer are authoritative, and the durable
mirrors are repaired from that pointer after interruption. A reviewed pricing
withdrawal may temporarily leave a safe pricing-only source record in the
catalog; the next
successful fresh provider publication prunes it.

During development, Vite derives the canonical API endpoints and compact UI
projections from the accepted mirrors. Production builds recover and revalidate
the accepted pair before writing those assets to ignored `dist/`. The website
loads only `/ui/` projections; audit-rich canonical data remains available at
the explicit `/catalog/` and `/pricing/` endpoints. Do not commit duplicate
endpoint assets under `public/`.
