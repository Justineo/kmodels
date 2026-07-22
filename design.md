# Kmodels design

Status: implemented compact revision
Last decision update: 2026-07-22

## Product boundary

Kmodels is a credential-free, best-effort catalog of model offerings published by 19 providers. Its two public resources are `Provider` and `ProviderModel`; identical names across providers remain distinct. Presence means “observed in an official public source”, never account availability. Missing price means unknown, never free.

The repository ships two things from one TypeScript project:

1. `scripts/collect.ts` produces versioned static JSON without an LLM or inference call.
2. A plain HTML/CSS website reads that JSON. Void deploys the built `dist/` directory as a static site; there is no production worker.

## Collection decisions

- `src/catalog/manifests.ts` is the reviewed source allowlist and provider registry. Root URLs never arrive from a request; linked documents are resolved only from an allowlisted source under an exact same-host path policy.
- Prefer documented JSON catalogs. Vercel, Cerebras, Hugging Face and Ollama have dedicated structural adapters. Other providers use a conservative document adapter that only accepts code-formatted identifiers matching a provider-specific exact pattern. Bedrock follows only same-host model-card links whose paths match a reviewed allowlist, then publishes the `Model ID` values in each card's Programmatic Access table. vLLM is reported as not configured unless an explicitly allowlisted runtime is added in code.
- Every response is size-limited, time-limited, conditionally fetched with ETag/Last-Modified, and redirected only to a host listed for that source. The TypeScript collector invokes `curl` without a shell so CI and proxied developer environments use a mature TLS/proxy transport while URL policy remains in code. Retries apply only to transient failures.
- Raw bodies are content-addressed, gzip-compressed snapshots. A source record binds URL, observation time, hash, extractor version and snapshot path.
- Candidate catalogs are validated per provider. Empty successful responses, duplicate IDs, invalid prices, model drops over 10%, price-rate drops over 20%, and non-promotional price changes over 50% are quarantined.
- Publication is failure-closed and provider-atomic. A rejected provider keeps its last validated models; providers do not block one another. One missing observation never deletes a model.
- Money is stored as source decimal strings. Scaling uses decimal-string arithmetic; binary floating-point is never used for price calculations.
- Generated files are `data/catalog.json` (durable previous state) and static endpoints under `public/v1/`. The website consumes `/v1/catalog/index.json`.

## Public data semantics

- `account_availability` is always `unknown`.
- `model_id` is an official request identifier when observed as one; otherwise it is an explicitly typed source identifier. `name` retains a separately observed display label. Bedrock model cards may publish different IDs for `bedrock-runtime` and `bedrock-mantle`; each unique callable ID is a separate provider-model row with the shared display name.
- Capability flags are tri-state. Absence from a source stays `unknown`.
- `source_refs` resolve into catalog source records.
- Pricing rates retain meter, currency, unit and applicable context/route conditions. Hugging Face routes are separate rates; no minimum or average is invented.
- A provider coverage entry says `fresh`, `stale`, `unavailable`, or `not_configured` and carries a machine-readable reason without exposing private runtime URLs.

## Website decisions

Visual thesis: a compact monochrome index—white canvas, near-black text, cool-gray rules and green reserved for source freshness.

Content plan: one narrow status bar, one filter row and the model index. Model identifiers and separately observed display names have distinct columns; the display-name cell is blank when `name` is only the required `model_id` fallback. There is no hero, methodology section, footer narrative, marketing copy, card grid or decorative imagery. Provenance remains available through model details and the raw JSON link.

Interaction thesis: filter feedback is immediate, rows use a quiet hover state, and model details open in a compact native dialog. The app header, controls and table heading remain sticky; all motion is removed under `prefers-reduced-motion`.

The CSS begins with a modern reset, uses system fonts, and remains usable without JavaScript through an explanatory HTML shell. JavaScript writes external values with `textContent`, not HTML interpolation.

## Automation and ownership

- GitHub Actions checks the project on pushes and pull requests.
- pnpm is the sole package manager. Its version is pinned in `package.json`, `pnpm-lock.yaml` is authoritative, and CI uses a frozen lockfile. Only the reviewed native tooling dependencies in `pnpm-workspace.yaml` may run install scripts.
- A scheduled workflow checks sources every 30 minutes, applies jitter, commits only validated generated changes, and never requires a collection secret.
- The deploy workflow uses the repository’s pinned `void` dependency and GitHub OIDC; `void.json` declares a plain static `dist` deployment. `VOID_PROJECT` is the only repository variable.
- Renovate follows the repository’s Shanghai timezone, seven-day minimum release age, grouped automerge for non-major updates, and isolated manual major updates.

## Change rule

When code and this document disagree, update the code or this document before merging. New providers, extraction heuristics, public fields, drift thresholds, deployment shape, or visual system changes are repo-scope decisions and must be recorded here.
