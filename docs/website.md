# Website

Status: implemented

## Product shape

- The site is a full-width, full-height precision workspace, not a centered marketing page.
- One compact header shows Kmodels, model/provider totals, generation time, the JSON entry point, and a light/dark toggle.
- Keep freshness details and catalog/pricing hashes in machine-readable data rather than persistent chrome.
- One toolbar keeps model-ID/name search and a provider selector visible. A secondary popover contains task, lifecycle, and release-stage filters.
- Keep the provider selector as one alphabetized list using the same provider marks as the table and inspector.
- One semantic table fills the remaining viewport. Model details open in a right-side inspector.
- Unknown values stay explicit. Rows without a representative numeric price
  show a short model-level status with an explanatory tooltip.

## Table and details

- Give each inspector fact one home. The header owns provider, display name,
  exact request identity, primary lifecycle/release status, and catalog scope;
  overview does not repeat those status fields. Suppress the identifier line
  when it exactly repeats the display name, while retaining a distinct version.
  Keep task, delivery, limits, dates, availability, modalities, supported
  capabilities, endpoints, and pricing in their respective sections.
- Show `@version` in a dense row only when the same provider has duplicate exact model IDs. Always show the complete version in details and JSON.
- Use short task badges for scanning while accessible labels, filters,
  tooltips, and details retain full names.
- Shared pricing headings stay generic because meter and unit are row-specific.
  `Input`, `Cache`, and `Output` are plain right-aligned labels: the reviewed
  default meter/unit contract does not need a tooltip. Normalize comparable
  token rates per million without repeating `/ 1M tokens` in every cell.
  Non-token rates retain their native unit in the cell. Only provider-owned
  meters, units, or credits add a price tooltip with namespace-qualified exact
  copy.
- Representative columns are derived only from canonical price books. A cell
  shows a number when one unconditional normalized rate is safe to present;
  otherwise one dotted-underlined text status spans the three pricing columns
  and explains the model-level outcome in a tooltip. Use `Varies` for a
  context-dependent offer, an offer count for several base offers, and retain
  the exact `Free`, `Quote`,
  `Unpublished`, `Incomplete`, `N/A`, `Unknown`, `No base offer`, or `Details`
  distinction. This status is never owned by the input meter. There is no
  secondary flat-price path.
- The detail flow is `offer → context → commercial structure`. It never
  flattens books into one rate list or chooses a provider default. Base offers
  and add-ons are stable parent choices; a sole base offer is fixed and shown as
  a summary rather than a one-item selector. Offer choices show one reviewed
  title; they omit generated book labels, a second billing-mode paraphrase,
  repeated default `Metered pricing` copy, and explanatory prose already implied
  by the control. Multiple offer choices form a compact wrapping radio group;
  its native keyboard behavior owns arrow keys and must not navigate between
  models. Fresh pricing shows its verification time. A retained partition
  instead shows one provider-level status note with both the preserved
  verification time and the latest rejected-attempt time plus a reviewed
  explanation. For an unknown model it says that the last verified provider
  snapshot contained no pricing; it never implies that the model previously had
  a price or that model-level validation failed.
  Selecting another offer resets its child context, and context filtering never
  hides or reorders the choices above it. Context controls use the shared
  customizable-select component. A categorical dimension with one possible
  value is resolved and shown as compact fixed context instead of rendered as a
  control. A rate appears only when the current partial context proves that it
  applies; unresolved
  alternatives stay hidden behind a prompt for their missing dimensions. The
  calculator resolves exact applicable rates but does not estimate usage,
  consume allowances, or calculate an invoice. Selected applicability is not
  repeated on each resolved rate, allowance, or state; validity qualifications
  remain visible. A single offer state stays in the offer summary; state detail
  appears only when the offer has multiple possible outcomes.
- A representative preview requires one unconditional, unqualified,
  normalized fiat value after model binding and any categorical value required
  by every offer-state clause. Such an offer-wide singleton is fixed context,
  not a user choice; this lets a single fixed Batch offer expose its exact table
  rates. Reviewed provider-qualified units are eligible and retain their native
  label; the UI never converts or compares them with standard units. Qualified
  validity, unresolved selectors, ambiguous offers, applicable raw base-price
  facts, or bounded display-arithmetic failure remain detail-only or show a
  model-level status. The UI never chooses a provider default.
- Exact rates calculated by a reviewed provider adapter display their numeric
  result normally. Calculation provenance remains in the canonical audit asset;
  it does not demote an otherwise exact rate to raw.
- Render exact rationals without binary floating point. Use a decimal whenever
  the exact rational has a finite decimal expansion, retain an exact fraction
  only when it does not, and render USD amounts with `$` while preserving the
  currency code in accessible copy. Provider-owned units and
  credits retain namespace-qualified canonical copy so equal source spellings
  cannot make distinct atoms equivalent. Visible provider-unit labels use the
  reviewed native shorthand in their provider-scoped row. Exact token rates may
  use the same bounded per-million display scaling in the table and detail
  matrix; overflow falls back to the canonical per-token rational.
- Right-align numeric headings and cells with a shared sort-control gutter.
- The table date column shows `Released`, backed only by `release_date`.
  Provider API `created` timestamps are not treated as model release dates
  unless provider evidence establishes that meaning. `updated_date` remains a
  distinct detail field rather than being mixed into a generically labeled
  table date.
- All explanatory hover text uses `UiTooltip`; do not use native `title`.
  Pointer hover waits for a 700ms warm-up. After an open tooltip closes, every
  tooltip shares a 400ms cooldown during which moving to another trigger opens
  it immediately; once that window expires, warm-up is required again. Keyboard
  focus opens immediately, Escape dismisses the active tooltip, and dotted
  underlines mark terse text with additional explanation. Every tooltip
  teleports into the document's dedicated tooltip layer and uses CSS anchor
  positioning with viewport-aware fallback placement; components do not
  calculate viewport coordinates or own scroll/resize listeners.
- Keep all filtered results in one continuous, fixed-row virtual scroll surface.

## Interaction

- `/` focuses search.
- Search uses a small in-memory index of lowercase IDs and names with spaces and hyphens removed. Match literal substrings only; do not fuzzy-expand or relevance-rank.
- Filters update immediately. Selecting an inline facet replaces only that category and preserves other state.
- Keep separators between multiple facet values presentational and outside interactive controls.
- Sortable headings cycle default, ascending, descending, then default.
- Only model identity and its disclosure control open details; the whole row is not a button.
- The inspector is a non-modal `<dialog>`. Its panel receives pointer input while the catalog remains interactive.
- Up/Down selects the previous/next visible model unless focus is in a control that owns arrow keys. Selection resets inspector scroll. Explicit close and Escape dismiss it.
- Focus styles use `:focus-visible`, including containers with a focus-visible descendant.
- The appearance button switches directly between light and dark, labels the destination, and persists the explicit choice. Initial appearance follows the OS.
- Provider and pricing-context selection reuse one progressively enhanced
  `UiSelect` component using `appearance: base-select`; the browser owns
  selection, keyboard, focus, placement, and dismissal. The visual value mirror
  is pointer-transparent.
- The secondary filters use `<dialog popover="auto">` for non-modal top-layer behavior and light dismissal. Keep its title/actions outside its scroll viewport.
- Do not use modal-dialog `closedby="any"` for light dismissal until it is baseline.
- Filtering or sorting resets virtual scroll. Clearing filters does not move focus.
- Keep the workspace header and table header fixed while results scroll.
- Motion is short and removed under `prefers-reduced-motion`.

## Shareable state

- Use the query string without a router.
- Keys are `q` search, `p` provider, `o` task, `l` lifecycle, `r` release stage, `s` sort, and `m` selected model.
- Keep historical key `o` for shared URL compatibility even though the field is now `tasks`.
- Use stable one-character enum/sort codes and omit defaults.
- Replace the current history entry on state changes; `popstate` restores visited state.
- Theme is local preference. Popover visibility and scroll positions are transient.
- The browser loads `/ui/catalog/index.json`, which contains only row, search,
  filter, sort, and representative-price fields. Opening a model lazily loads
  one `/ui/models/<model-ref-hash>.json` detail asset. These UI projections exclude
  source records, observations, locators, raw source values, derivations,
  evidence arrays, and canonical envelope hashes. They retain only the displayed
  provider-snapshot freshness label.
- `/catalog/index.json` and `/pricing/index.json` are explicit download links,
  not application dependencies. Build-time pair validation establishes their
  binding before UI assets are emitted; the browser validates only the closed UI
  schemas it consumes. Revalidate browser caches for UI requests.

## Visual system

- Use Kong dark green `#000F06`, electric lime `#CCFF00`, Bay `#B7BDB5`, white, and the reviewed neutral scale through semantic tokens. Lime marks focus, selection, and active state; it is not decoration.
- Ground the system in Kong's 2026 brand rules, Apple HIG legibility, Vercel Geist utility patterns, and VoidZero/Vite+ structural restraint.
- Follow system-font legibility, a compact 13–14px utility scale, mono identifiers, tabular numerals, thin borders, crisp planes, compact radii, and low-elevation floating surfaces.
- Create hierarchy with alignment, weight, density, and information order. Do not add gradients, decorative imagery, oversized display type, floating-card composition, or decorative chrome.
- Reuse Kong's current ICO fallback plus 16px and 32px PNG favicon files.
- `src/tokens.css` owns immutable brand foundations, shared scales, light/dark semantic roles, and the smallest necessary repeated component roles.
- Components consume tokens; they do not introduce raw colors, font sizes/weights, radii, shadows, easing, transition duration, or shared custom properties.
- Theme and narrow-screen changes override token roles instead of component selectors.
- Use a 4px spatial base with a 2px compact step; 20/28/32px controls; 3px facet, 4–6px control/list, and 8px floating-surface radii; and 100/120/180ms motion tiers.
- Virtualization reads row/header metrics from CSS tokens. The token-contract test guards against one-off values.

## Icons

- Compile reviewed Lucide utility icons and Lobe provider marks into one hidden build-time SVG sprite. Visible icons use `<use>`.
- Scope definition IDs per symbol so gradients remain stable.
- Use reviewed local assets when Lobe is missing or stale: Microsoft Foundry uses the current Microsoft architecture mark; Databricks uses official Lava 600 Simple Icons geometry.
- Provider marks keep reviewed brand colors. Monochrome marks have explicit light/dark variants; Cerebras remains orange. Kimi uses its complete black mark on light surfaces and color mark on dark surfaces.

## Virtualization and scrollbars

- Keep rows fixed at 48px with eight rows of overscan on each side.
- Implement range math in a small framework-neutral utility and render Vapor-native table markup. Do not add a VDOM virtualization dependency or dynamic measurement.
- One Vapor composable initializes OverlayScrollbars on explicit host/viewport pairs for the table, filter popover, and inspector. It owns scrollbar chrome only; Vue owns content, native scrolling, and range calculation.
- The native select picker uses the same restrained scrollbar colors because it is not script-addressable.
- Publish total and absolute row indexes for assistive technology.

## Content safety

- Start CSS from a modern reset and system fonts.
- Keep an explanatory HTML shell usable without JavaScript.
- Interpolate only schema-validated catalog text and bind source URLs as normal links.
- Only reviewed build-time icon SVG may be injected as markup. Never treat external catalog values as HTML.
