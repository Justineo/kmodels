# Catalog semantics

Status: implemented

## Product boundary

Kmodels is a best-effort catalog of model offerings from 18 providers. The public resources are `Provider` and `ProviderModel`. Equal names or IDs from different providers remain distinct.

The catalog records facts observed from allowlisted official sources. Global presence means presence in an official global catalog, not availability to one account, region, deployment, or runtime. `exhaustive` separately records whether the source claims completeness. Missing price means unknown, never free.

The repository ships:

1. A deterministic collector that produces versioned static JSON without an LLM or inference call.
2. A static Vue website that reads that JSON.

## Identity and merging

- Provider-model identity is the exact `(provider_id, model_id, version)` tuple.
- `model_id` is an observed request ID or an explicitly typed source ID. Never derive it from a display name.
- `version` is kept only when the provider observes it separately. Never concatenate it into, or infer it from, `model_id`.
- `name` is an independently observed display label.
- Merge repeated observations of one tuple. Union additive sets and conditioned facts; apply overlays only to declared fields. Reject incompatible facts from one source.
- Never merge bare IDs across providers, collapse a canonical ID through an alias, or merge distinct callable IDs that share a display name.
- An exact catalog ID always owns a row even when another row lists it as an alias.
- `account_availability` remains `unknown`; scoped inventories cannot establish global availability.

## Tasks, delivery, and routes

- `tasks` is a deterministic, non-exclusive set of positively observed task/result families. It may be empty.
- Values are `text_generation`, `embeddings`, `reranking`, `image_generation`, `video_generation`, `audio_generation`, `speech_synthesis`, `transcription`, `translation`, `speech_to_speech`, `moderation`, `classification`, `ocr`, `object_detection`, and `segmentation`.
- Chat, completions, Responses, assistants, agents, and code generation are `text_generation`. Their API differences stay in `api_endpoints`.
- Tool use, computer use, citations, and code execution are capabilities.
- Streaming, realtime, WebSocket, batch, and async are delivery semantics. Bidirectional realtime voice is `speech_to_speech`; realtime transcription remains `transcription`.
- Text and audio translation share `translation`; modality distinguishes input. Music/general audio generation is not speech synthesis. Image editing remains `image_generation`.
- `task_evidence` keeps the canonical task, source, provider namespace, raw value, and evidence kind only when the relation is exact. Never invent raw evidence from a canonical value.
- Evidence priority is structured task/type or exact supported endpoint, then an exact reviewed ID/name marker, then unambiguous output modality, then a reviewed provider default. Unsupported endpoint cards are negative evidence. Unknown raw tasks remain route evidence, not an `other` task. Never use an LLM or cross-provider inheritance for classification.
- `delivery_modes` contains only positive `streaming`, `realtime`, `batch`, or `async` evidence. Absence is unknown. Batch pricing alone does not prove batch delivery.
- `service_families` is exact, multi-valued product/API-family evidence. Never infer it from ownership, tasks, or another provider.
- `api_endpoints` is positive provider-published model endpoint evidence. Absence is unknown. Service-level Batch or Fine-tuning routes do not become model tasks.
- `routes` binds one source to an exact upstream provider, provider model ID, raw task, and route state. Normalized tasks never replace this relation.

## Lifecycle, dates, and capabilities

- Capability flags are tri-state; missing evidence stays unknown.
- `status` describes availability/support: `active`, `legacy`, `deprecated`, `retired`, or `unknown`.
- `release_stage` independently describes maturity: `stable`, `preview`, `experimental`, or `unknown`.
- `legacy` means callable but superseded or restricted. `deprecated` means migration is announced while some use remains. `retired` requires evidence that requests or deployments are unavailable.
- Publish stable/GA only from positive evidence, except when an official catalog explicitly defines unlabeled current rows as GA. Current membership may establish `active` when the source defines it that way; it does not imply `stable`.
- Scheduled lifecycle changes take effect only when the source declares that stage or the exact effective time is reached.
- `replacement_model_ids` contains only exact same-provider IDs from official lifecycle evidence.
- `release_date` is the first official availability date for the exact callable model. `updated_date` is an explicit model revision or artifact modification date. Preserve `YYYY`, `YYYY-MM`, or `YYYY-MM-DD` precision.
- Collection time, page-level update metadata, unlabeled dates in names, `first_seen_at`, and `last_seen_at` never substitute for product dates.

## Provenance, pricing, and diagnostics

- `source_refs` resolve to source records with standardized origins, scope, role, stability, exhaustiveness, extraction, and content hashes. Access method and response format are not model facts.
- Pricing keeps exact meter, currency, unit, and applicability conditions. Never invent a minimum, average, conversion, or free rate.
- Regional availability is exact `{region, deployment_type}` pairs; never publish independent arrays that create false combinations.
- Provider coverage is `fresh`, `stale`, `unavailable`, or `not_configured`, with a machine-readable reason that does not expose private URLs.
- Warnings use structured codes with optional provider, source, and field context. Aggregate missing authentication, fetch/parse failures, scoped mismatches, and missing-field coverage instead of warning once per row.
