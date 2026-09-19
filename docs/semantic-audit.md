# Semantic contracts in collection and repair

Status: manual experiment only; not adopted by scheduled refresh or repair

The real 2026-09-19 refresh and four cold Jev requests produced zero incremental semantic findings
and zero additional repair candidates (31,827 input tokens). This does not justify recurring use.
Synthetic marker-preserving changes establish feasibility, not an observed workflow need. Start
with the [refresh/repair evidence audit](refresh-repair-audit.md); existing checks are not a premise
for selecting the next integration. The mechanics below describe the retained manual experiment.

## Division of responsibility

The objective is a correct, reproducible catalog. A successful HTTP response proves transport,
a valid schema proves shape, and a recognized phrase proves a lexical match. None proves that
the source still means what our quantity mapping says. Conversely, a language model's plausible
interpretation does not prove an exact model ID, numeric rate, unit, or executable calculation.

| Boundary                        | Mechanically observable failure                                                                                     | Owner and reason                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Source discovery and trust      | Unreviewed host/path, missing fixed companion, crawl budget                                                         | Manifest and bounded transport. A model cannot authorize a source or prove that an unobserved page does not exist. |
| Fetch                           | HTTP/auth failure, redirect, bytes, incomplete source bundle                                                        | Code and operational reporting. Jev adds no information to a known transport failure.                              |
| Structural extraction           | JSON type, missing ID/card, unexpected field, missing known accounting mapping                                      | Parser contracts and deterministic repair admission. Do not pay to classify a failure already detected in code.    |
| Meaning of an emitted field     | Keywords still match, but the field now counts attempts instead of successes, or requested instead of served values | Independent Jev claim verification against original source text. This is the narrow probabilistic gap.             |
| Exact normalization and joining | Decimal conversion, currency/unit, model identity, scope and precedence                                             | Code, reviewed provider rules and deterministic tests. Never infer a missing price or join from a probability.     |
| Assembly and publication        | Invalid quantities, unbound terms, partial provider, retained/fallback state                                        | Existing validators and provider-atomic publication. No model writes or gates production data.                     |
| Diagnosis and repair            | Multiple documents, new semantics, source conflict, schema/code change                                              | Reasoning LLM plus tools: inspect evidence, develop a hypothesis, reproduce, edit, test and propose a draft PR.    |

Refresh reconciliation describes only the items a recognizer enumerated; omitted prose may never
enter its denominator. Published coverage can also hide failed current extraction behind fallback
rates. Inspect source-local attempts as well as accepted model counts. Mistral's explicit
`unknown_public_pricing_card` reason therefore enters repair directly, even on unchanged source
content. Generic unknown prices, unreviewed terms and a provider not publishing a rate do not.

Jev returns typed judgments and probabilities rather than an explanation or program. TypeSafe
describes calibration-oriented training, but its public documentation does not establish a specific
internal architecture or guarantee correctness on pricing documents. A reasoning LLM can generate
and revise an investigation using tools; that flexibility belongs after a bounded review signal,
where its assertions can be checked against source evidence and executable tests. Neither model
is a truth oracle. Typed responses remove parsing ambiguity, not semantic error.

The integration follows the [extraction cascade](https://docs.typesafe.ai/cookbooks/sde_cascade)
and [System One](https://docs.typesafe.ai/concepts/system-one) guidance. The useful role is a second
semantic witness at the extraction boundary. Broadly comparing every paragraph with a complete
price book mixes identity, precedence, assembly and localization into one judgment; this repository
does not use that approach. It also does not ask Jev to classify existing diagnostic messages.

## Current contract scope

Four independently reviewed claims cover Vercel's successful search-call counts, served speed,
served service tier, and served region. Seven accounting keys are involved because the search
contract covers four tools. `src/catalog/semantic-audit.ts` owns their explicit meanings and exact
reviewed companion URLs. Claims are written from domain intent, never generated from parser
markers or error messages. Changing an accounting meaning requires reviewing its claim too.

The maintenance process fetches only those four original public Markdown documents using existing
reviewed host/size/redirect controls. The production `extractVercelPricingInputs` runs on the same
bytes. Missing expected mappings immediately produce `parser_gap` and skip Jev for that contract.
This deliberately avoids spending inference on structurally observable problems.

For an emitted contract, Jev receives the complete document and one claim. It does not see parser
output, regexes, diagnostics, expected answers or a generated source summary. It independently
chooses `supported`, `contradicted` or `not_established`. Code compares the judgment with the actual
extraction. `P(contradicted) >= 0.8` requests repair review; it never changes a fact. Other distributions
are retained, including abstentions. The threshold is a provisional review-workload policy, not
measured calibration, a truth threshold, or a guarantee against missed drift.

This check cannot discover unknown new fees, missing pages or wholly new field contracts. It does
not audit every Vercel price, other providers, final assembly or runtime response completeness.
In particular, standard-tier omission assumes the client exposes complete gateway metadata;
clients dropping all metadata must not treat that absence as proof of standard billing.

## Evidence, cache and repair

Hourly collection and daily repair have no Jev dependency. The manual CLI is opt-in through
`JEV_API_KEY`. No key means a skipped report and no fetch or model request.
No scheduled workflow reads this key. No credentials, authenticated
source bodies or private inventory are sent to Jev.

`vp run catalog:audit` writes under `/tmp/kmodels-semantic-audit`, or the configured external
`KMODELS_SEMANTIC_AUDIT_DIR`. Artifacts contain:

- `snapshot.json`: exact public document bodies, URLs, observation time and source hash.
- `parsed-records.json`: the current production accounting extractor's selected facts.
- `report.json`: source/output/request hashes, contract IDs, versions, missing keys/documents,
  complete distributions, newly billed token usage, cache hits and model-request elapsed time.
- `cache.json`: successful source judgments keyed by exact request bytes, including the claim,
  full document, instructions, criteria and pinned model `jev-1.13.0`.

Fresh evidence is fetched every run. Identical requests reuse judgments; the current parser always
runs again. Parsing or threshold changes do not require another model call. Evidence, question or
model changes invalidate the relevant cache entry. Only current successful requests are retained;
the manual CLI stores this small file in its artifact directory. No automated retry or random re-sampling is used to
make a finding disappear. Deliberate reassessment can remove the cache or change a reviewed claim.

Candidate admission checks exact URLs, content hashes, current extractor/output/request hashes,
freshness within 24 hours, missing-key lists, contract identities and complete accounting of fetched
documents. Partial runs retain usable sibling findings but never establish full coverage. Failure
cannot suppress deterministic candidates. A failed/partial audit without other candidates produces
an incomplete report rather than a healthy no-op. An explicitly disabled audit remains optional.

The repair LLM independently reads the original source, surrounding definitions, related documents
and assembly rules. It must establish a concrete defect and add a deterministic regression that
fails before and passes after the repair. A model score changing is not validation. Replay needs
neither a key nor network:

```sh
vp run catalog:audit --replay /tmp/kmodels-semantic-audit/snapshot.json
```

This writes `replayed-records.json`. For other public candidates, the sandbox-permitted command
`vp node scripts/fetch-catalog-evidence.ts SOURCE_ID [FIXED_COMPANION_URL]` uses the existing
manifest transport and writes exact evidence under `/tmp/gh-aw/agent/catalog-evidence`. Arbitrary
URLs and authenticated sources are rejected; reviewed public transport headers such as
`Accept-Language` are preserved. Source hosts are
explicitly admitted in the repair workflow network configuration. Tool/fetch denial, insufficient
evidence or unresolved source meaning must result in `report_incomplete`, never a guessed fix or
an assertion that no defect exists. Remote sandbox operation still requires a real CI run to verify.

False semantic flags can be proposed as exact finding-ID dispositions in
`docs/semantic-audit-decisions.json` with a source-grounded rationale and normal draft-PR review.
These dispositions never dismiss deterministic parser gaps. Finding identities include evidence,
parser output, extractor version and the complete semantic request; changed inputs invalidate old
decisions. New ontology needs and unresolved contradictions stay incomplete. An open repair PR
deduplicates further runs; no model can publish, merge, or weaken a validation contract.

## Bounds and evaluation

At most four documents of 64,000 UTF-8 bytes and one question per document are allowed. The complete
text is retained without excerpts or truncation. Each model response is limited to 16,000 bytes,
each request times out after 20 seconds, redirects are rejected, and no retries occur.
Missing/oversized documents, unexpected model IDs, invalid distributions
or failed calls stay explicitly incomplete. Rounded API probabilities allow only their maximum
two-decimal rounding error; confidence is retained without treating it as workflow accuracy.

The opt-in paid evaluation `vp run catalog:audit:eval` uses a reviewed wrapped search-response
excerpt and synthetic changes. It checks the complete route: ordinary formatting passes, missing
mappings bypass inference, and retained obsolete markers with a changed counter meaning require
semantic review despite identical parser output. Controls include unrelated rates, a separate
attempt counter, undocumented evidence and an instruction embedded in source content. The latter
is one robustness example, not a prompt-injection security guarantee. Reports default to
`/tmp/kmodels-jev-contract-evaluation`. Unit tests mock inference and test workflow behavior,
integrity, limits and failure isolation; they do not measure model quality.

On 2026-09-19, independent inspection of the first live four-document run confirmed three extraction
defects affecting six mappings: wrapped search counts, wrapped regional default prose and equivalent
service-tier omission wording. All have deterministic fail-before/pass-after fixtures. These are
mechanically visible omissions, so the final pipeline routes them without Jev. The distinct value
under evaluation is marker-preserving semantic drift that otherwise passes the parser.

The final 11-case live evaluation with `jev-1.13.0` passed all route expectations: six synthetic
marker-preserving meaning changes triggered review, three supported controls did not, and two
mechanical gaps made zero model calls. Contradiction probabilities for the six semantic cases were
0.95–1.00. These authored examples are not a representative or independently labeled production set.
The repaired live snapshot replays from one to seven selected facts. All four complete source
documents support their reviewed claims; exact-cache replay uses zero inference tokens. A cold run
of these four documents uses approximately 32,000 input tokens, with document sizes and scope
explicitly bounded. This does not claim equivalent coverage to an exhaustive pricing audit.

Measure confirmed incremental semantic defects, false-positive review work, abstentions, cache-hit
rate, tokens and end-to-end latency separately. Synthetic success and a small live sample establish
feasibility, not production recall or net savings. Keep the scope small until reviewed outcomes
justify expansion. Current API/model contracts follow [Choice](https://docs.typesafe.ai/primitives/choice),
the [HTTP API](https://docs.typesafe.ai/api), and [model documentation](https://docs.typesafe.ai/models).
