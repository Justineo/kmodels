# Website

Status: implemented core; provider pricing convergence is in progress

## Product shape

- The site is a full-width, full-height precision workspace, not a centered marketing page.
- One compact header shows Kmodels, model/provider totals, generation time, a GitHub repository icon, and a light/dark toggle. The generation time links to the catalog-producing GitHub Actions run when that run is recorded on the commit; otherwise it links to the catalog-producing commit.
- Keep freshness details and catalog/pricing hashes in machine-readable data rather than persistent chrome.
- One toolbar keeps model-ID/name search and a provider selector visible. A secondary popover contains task, lifecycle, and release-stage filters.
- Keep the provider selector as one alphabetized list using the same provider marks as the table and inspector.
- When the selected provider has standalone commercial resources, show their
  count as an action that opens a provider-level pricing inspector. This is the
  home for separately priced request services that do not belong to one model row.
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
- Keep single-variant provider models as one ordinary row. When the filtered
  result contains multiple exact versions of one `(provider_id, model_id)`,
  show one collapsed parent row with the variant count. A parent cell shows an
  exact value only when every visible variant agrees; otherwise it says
  `Varies`. Varying status uses the same dotted tooltip treatment as pricing
  status and names the distinct values. Expanding inserts the exact variants as
  fixed-height child rows, and selecting a child opens its details. Never infer
  or label a latest version from version spelling. Always show the complete
  version in child details and JSON.
- Use short task badges for scanning while accessible labels, filters,
  tooltips, and details retain full names.
- The `Status` heading is a shared tooltip trigger that defines lifecycle and
  active-model maturity values in separate compact definition lists rather than
  one prose paragraph. Each definition reuses the table's status badge color as
  a legend. The heading uses the same trigger structure and styling as the
  pricing headings.
- Shared pricing headings stay generic because meter and unit are row-specific.
  `Input`, `Cache`, and `Output` are right-aligned labels whose tooltips explain
  that the columns show representative prices, normalize comparable token rates
  per million, and retain a verified source-native fixed-unit scale for other
  meters when it exactly reproduces the canonical price. Internal rational
  fractions are never exposed. Do not repeat `/ 1M tokens` in every cell. Only
  provider-owned meters, units, or credits add a price tooltip with
  namespace-qualified exact copy.
- Representative columns are derived only from canonical price books. A cell
  shows a number when one normalized rate is proven invariant across the
  complete applicable offer context;
  otherwise one dotted-underlined text status, framed by fine, evenly spaced,
  light-neutral 45-degree hatch marks across the three pricing columns, explains
  the model-level outcome in a tooltip. Use `Varies` for a
  context-dependent price, an offer count for
  several base offers, and retain the exact `Free`, `Quote`,
  `Unpublished`, `Incomplete`, `No offer`, `Unknown`, `No base offer`, or `Details`
  distinction. This status is never owned by the input meter. There is no
  secondary flat-price path. On an exact model row, activating the status opens
  that model's inspector at the pricing section; it does not choose an offer or
  pricing context on the user's behalf.
- The detail flow is `[Run mode when selectable] → Rates → audit exceptions`. The first mechanism in
  stable presentation order is the initial browsing focus, not a provider default,
  recommendation, or cheapest-offer choice. A sole mechanism is named only by its base-rate block.
  The selected mechanism remains the context for the entire cost breakdown; exact mechanism
  references filter its related costs. One continuous rate sheet fully expands the base model,
  optional services, automatic charges, and independently callable services in that order. Each
  offer keeps its own heading, price-changing options, and meters; rates are billed separately and
  never combined into a total. Account plans and capacity are omitted. Offer choices show one
  reviewed title; they omit generated book labels, repeated default `Metered pricing` copy, and
  explanatory prose already implied by the control. Multiple mechanism choices form a compact
  wrapping radio group; its native keyboard behavior owns arrow keys and must
  not navigate between models. Fresh pricing shows its verification time. A retained partition
  instead shows one provider-level status note with both the preserved
  verification time and the latest rejected-attempt time plus a reviewed
  explanation. For an unknown model it says that the last verified provider
  snapshot contained no pricing; it never implies that the model previously had
  a price or that model-level validation failed.
  Selecting another Run mode resets only the outgoing mechanism's child context, and context
  filtering never hides or reorders the choices above it. Each related offer owns independent child
  context. Context controls use the shared
  customizable-select component. Configurable controls in the same grid row
  stay top-aligned when one control includes guidance or validation text. A
  categorical dimension or exact decimal selector with one possible value resolves internally.
  Price-query controls contain only dimensions that can change a rate or leave its numeric state
  partially covered. When every still-possible variant of one rate has the same
  amount, denomination, unit, driver, and validity and together covers the
  complete remaining numeric offer-state scope, that invariant rate appears
  immediately without repeating invariant dimensions. Unresolved unequal or
  partial alternatives remain hidden behind a prompt for only their missing
  dimensions. Account enrollment, settlement, capacity, and plan selectors are outside the Gateway
  rate-book UI. The controls resolve exact applicable rates but do not estimate
  usage, consume allowances, or calculate a total. Selected applicability is not
  repeated on each resolved rate, allowance, or state; validity qualifications
  remain visible. Its reset action appears only after a configurable selection
  and does not repeat a selection count. A single offer state stays in the offer
  summary; state detail appears only when the offer has multiple possible outcomes.
  Numeric context preserves its published domain: singleton predicates become
  choices, and complete non-overlapping range partitions become ordered range
  choices whose labels retain the exact `<`, `≤`, `>`, and `≥` boundary
  operators. Ranges with gaps or overlaps continue to accept an exact value and
  reject invalid or non-integral count/TTL input.
- The model rate matrix shows only the meter, rate, unit, and validity qualification. Driver metadata
  remains in the provider inspector and canonical audit; a missing driver never hides a rate.
  Contribution rows expose the same driver metadata without copying the target rate. Generic
  usage-based billing is omitted because the meter, unit, and rate already express it. These rows
  explain what affects cost without accepting usage input,
  multiplying quantities, or presenting an account total.
  Information priority is meter, amount, and unit; then rate-changing choices; then source
  exceptions on demand. Fixed metadata, driver definitions, and invariant explanations stay out of
  model details.
- Keep the Pricing section mounted after a detail request fails. Show a clear
  unavailable state with an in-place retry instead of removing the section when
  loading ends without a usable detail payload.
- The provider-level pricing inspector uses the same rate, driver, contribution, raw-fact, and
  retained-snapshot semantics. Known raw facts may expose only concise source-native parameters
  that affect cost; observations, locators, and audit evidence remain excluded.
  It renders conditional or validity-qualified offer states before rates while
  leaving unconditional singletons in the summary. Applicability follows the
  bounded pricing projection, with one link to the exact canonical audit.
  Raw-only official rows stay separate from normalized resources.
  The provider inspector has a literal resource/offer search. Entering a query
  loads the remaining bounded resource chunks before filtering so results are
  provider-complete rather than limited to the initially loaded page.
- A representative preview requires one validity-free normalized fiat value
  whose combined applicability covers the complete numeric offer-state scope
  after model binding and any categorical value required by every offer-state
  clause. An unresolved selector is allowed only when it cannot change the
  exact denomination, amount, unit, or first applicable meter. Conditions needed to resolve a rate
  stay visible as controls; the table collapses only their invariant result. An offer-wide singleton
  is resolved internally rather than presented as a user choice; this lets a single fixed Batch
  offer expose its exact table rates. Reviewed provider-qualified
  units are eligible and retain their native label; the UI never converts or
  compares them with standard units. Qualified validity, partial scope
  coverage, ambiguous offers, applicable raw base-price facts, or bounded
  display-arithmetic failure remain detail-only or show a model-level status.
  The UI never chooses a provider default.
- Exact rates calculated by a reviewed provider adapter display their numeric
  result normally. Calculation provenance remains in the canonical audit asset;
  it does not demote an otherwise exact rate to raw.
- Render exact rationals without binary floating point. Use a decimal whenever
  the exact rational has a finite decimal expansion, retain an exact fraction
  only when it does not, and use the shortest decimal spelling that preserves
  the exact value; source padding such as trailing fractional zeroes remains
  audit evidence and is not presentation. Render USD amounts with `$` while
  preserving the currency code in accessible copy. Provider-owned units and
  credits remain namespace-qualified in canonical audit data so equal source
  spellings cannot make distinct atoms equivalent. Public copy uses the reviewed
  native unit label or credit code. Exact token rates may
  use the same bounded per-million display scaling in the table and detail
  matrix; overflow falls back to the canonical per-token rational.
- Right-align numeric headings and cells with a shared sort-control gutter.
- The table date column shows `Released`, backed only by `release_date`.
  Provider API `created` timestamps are not treated as model release dates
  unless provider evidence establishes that meaning. `updated_date` remains a
  distinct detail field rather than being mixed into a generically labeled
  table date.
- All explanatory hover text uses `UiTooltip`; do not use native `title`.
  Reserve tooltips for terse or abbreviated values that need additional
  explanation. Do not repeat the self-evident action of controls such as clear
  filters, appearance switching, disclosure, or close buttons.
  Pointer hover waits for a 700ms warm-up. After an open tooltip closes, every
  tooltip shares a 400ms cooldown during which moving to another trigger opens
  it immediately; once that window expires, warm-up is required again. Keyboard
  focus opens immediately, Escape dismisses the active tooltip, and dotted
  underlines mark terse text with additional explanation. Every tooltip
  teleports into the document's dedicated tooltip layer and uses CSS Anchor
  Positioning directly against its trigger for viewport-aware placement and
  fallbacks. The table header is outside the table body's vertical scroll
  container, so heading anchors never depend on browser sticky-anchor scroll
  compensation. An application-level listener dismisses tooltips on scrolling
  or viewport resizing. Activating a
  tooltip trigger dismisses its open tooltip; pointer hover cannot reopen it
  until the pointer leaves and enters the trigger again. Switching an open
  tooltip to another trigger through hover or focus does not consume that
  trigger's first activation. Tooltip hit areas stay on their visible trigger
  content rather than filling a table cell. The tooltip surface consumes pointer
  input so clicks cannot pass through to obscured controls, while the content
  remains non-interactive. On a
  focusable explanatory text trigger, the first click or tap opens the tooltip
  and a subsequent activation toggles it closed or open. On touch, an action
  trigger such as a model pricing status uses the first tap to explain the
  value; a second tap on the open trigger performs the action and closes the
  tooltip. Mouse clicks and keyboard activation perform the action immediately
  and dismiss tooltip text because hover or focus already exposes the tooltip.
- Keep all filtered results in one continuous, fixed-row virtual scroll surface.
- Keep every semantic table column visible at every viewport width. On narrow
  screens, preserve the desktop column proportions and let the table scroll
  horizontally instead of hiding provider, task, pricing, or release data. The
  enclosing grid items must opt into shrinking with `min-width: 0`, while the
  native scroll viewport stays at the available width, so the table's minimum
  width creates viewport overflow instead of expanding into clipped workspace.
- Keep the semantic table intact and nest its scrollports by axis on every
  device: the outer table viewport owns horizontal scrolling for the header and
  body together, while `tbody` owns vertical scrolling below the header. On
  coarse touch devices, suppress page zoom gestures while preserving native page
  panning and momentum in both axes. Allow horizontal scroll chaining from the
  non-overflowing axis of `tbody` to the outer viewport, while containing vertical
  and outer-edge overscroll. Leave gesture direction locking to the browser
  instead of replacing its scrolling physics in JavaScript. Because iOS does not
  reliably expose an interactive scrollbar for a nested scrollport, attach
  axis-specific OverlayScrollbars instances to the real outer and `tbody`
  viewports. Keep the persistent horizontal scrollbar at the table edge and the
  vertical scrollbar below the header. They supply drag and track interactions
  without handling ordinary content panning.

## Interaction

- `/` focuses search.
- Search uses a small in-memory index of lowercase IDs and names with spaces and hyphens removed. Match literal substrings only; do not fuzzy-expand or relevance-rank.
- Filters update immediately. Selecting an inline facet replaces only that category and preserves other state.
- Keep separators between multiple facet values presentational and outside interactive controls.
- Sortable headings cycle default, ascending, descending, then default.
- Model identity, its disclosure control, and an exact model's pricing status
  open details; the whole row is not a button.
- The inspector is a non-modal `<dialog>`. Its panel receives pointer input while the catalog remains interactive.
- Up/Down selects the previous/next visible model unless focus is in a control that owns arrow keys. Selection resets inspector scroll. Explicit close and Escape dismiss it.
- Focus styles use `:focus-visible`, including containers with a focus-visible descendant.
- The appearance button switches directly between light and dark, labels the destination, and persists the explicit choice. Initial appearance follows the OS.
- Provider and pricing-context selection reuse one progressively enhanced
  `UiSelect` component using `appearance: base-select`; the browser owns
  selection, keyboard, focus, placement, and dismissal. Set the appearance
  directly on both the select and its complete `::picker(select)` rule so
  production CSS minification preserves the picker enhancement. The visual
  value mirror is pointer-transparent.
- The secondary filters use `<dialog popover="auto">` for non-modal top-layer behavior and light
  dismissal. Keep its title/actions outside its scroll viewport, and keep the toolbar trigger free
  of selection counts.
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
- Theme is local preference. Version-group expansion, popover visibility, and
  scroll positions are transient.
- The browser's first-render data dependencies are `/ui/catalog/index.json` and
  `/ui/catalog/pricing.json`. Request both concurrently and await both before
  mounting the application; preload both from the HTML shell so their transfers
  start in parallel with the core module graph. Core table data never has a
  deferred loading state.
  The catalog chunk contains provider labels and only the model fields needed
  for rows, grouping, search, filters, and sorting. The pricing chunk contains
  build-time representative pricing in matching model order. Browser-only UIDs
  are derived from the exact tuple; `updated_date`, inspector facts, audit
  fields, and random per-model references do not inflate either payload.
  Both chunks use versioned compact row tuples instead of repeating field names.
  Catalog rows index providers and fixed vocabularies; pricing rows index shared
  status and cell dictionaries. A display name identical to its model ID and a
  zero detail-chunk index use compact sentinel values and are restored at the
  boundary. Expand the rows once in the dependency-free parser, while retaining
  shared task, status, and pricing-cell objects in memory. This encoding is
  transport-only and does not weaken closed-schema validation or change UI
  semantics.
- Request model details only when their inspector opens. Detail assets are
  provider-scoped, deterministic chunks capped at 2 MiB uncompressed; large
  providers may own several numbered chunks. Model pricing refers to exact
  provider-local offers in `/ui/offers/<provider>/<chunk>.json` instead of
  copying the same display-ready offer into every applicable model. Standalone
  provider resources use the same offer dictionary. Offer chunks use the same
  bound and are requested only for the selected model or provider.
  Cache completed and in-flight chunks by data version, and retain parsed model
  details only after they are requested.
- Provider pricing detail uses
  `/ui/providers/<provider>/pricing/<chunk>.json`. It is requested on demand,
  split into deterministic whole-resource chunks capped at 2 MiB uncompressed,
  and cached by provider plus data version. Opening the inspector requests only
  chunk zero; later resource chunks require an explicit “Load more” action.
  Resources carry lightweight offer summaries and grouped offer references.
  Expanding one offer requests only its shared-offer fragments, verifies stable
  metadata, rejects duplicate rows, verifies the merged offer's ID, title,
  billing mode, and state summary against the selected summary, and mounts its
  detail DOM only while open. An explicit “Load more” action remains available
  during browsing; entering a provider-pricing search loads all remaining chunks
  before applying the literal filter.
  Provider projections retain the complete unnormalized-fact count but include
  at most 20 display-safe preview rows per offer; the canonical pricing audit
  remains the complete download.
- Use one `data_version` derived from the accepted catalog/pricing pair on the
  catalog, pricing-summary, model-detail, shared-offer, and provider-detail
  projections. Reject mismatched core
  chunks before mounting and mismatched deferred details before rendering them.
  Scope deferred-source, parsed-chunk, and model-detail caches to that version;
  evict rejected requests so a transient fetch or validation failure cannot
  poison later attempts.
- Keep the initial catalog parser small and dependency-free. Provider/UI icons
  and table scrollbars belong to the first rendered state: start the icon
  sprite, applicable OverlayScrollbars runtime/CSS, and two core data requests
  concurrently; await them before mounting and initialize scrollbars during
  mount. These may be separate cacheable async chunks, but are not post-paint
  work. The first Vapor root renders only visible workspace chrome and the
  virtualized table. Keep catalog rows outside Vue's deep-reactive graph, and
  build the search index after first paint unless an earlier search needs it.
  After that paint, eagerly load the closed filter popover, inspector, their CSS,
  and the full closed-schema validator in parallel. Only provider/model JSON
  details remain interaction-demanded. On coarse touch devices, keep native
  scrolling for general surfaces; initialize the table's axis-specific
  OverlayScrollbars during the first mount against its real outer and nested
  body viewports.
  Keep both browser graphs browser-safe; canonical hashing and publication I/O
  remain build concerns. Keep post-paint chunks out of the HTML module-preload
  graph. Mount the inspector into a second Vapor root and share only the small
  reactive detail state.
- All UI projections exclude source records, observations, locators, undigested
  source fragments, derivations, evidence arrays, and canonical audit-envelope
  metadata. Raw commercial facts may retain only display-safe structured
  parameters such as amount, denomination, unit, meter, validity, formula, and
  conditions. They retain displayed commercial semantics—including reviewed usage-signal
  definitions, aggregation boundaries, resolution phases, and provider-snapshot freshness copy.
- Build-time projection indexes snapshots, dispositions, and model-scoped
  books once. Each model reuses one pricing view for its summary and detail.
  Equal display-ready offers are stored once per provider and referenced by
  chunk and position from model details and standalone resources. Equality is
  exact serialized content, so this changes storage only and cannot merge
  distinct commercial facts. The checked-in pack
  is compared with asset sources from that same publication instead of
  rebuilding the projection a second time.
- Development serves those projections from the pair-bound,
  indexed `data/website-assets.pack`; every entry is independently compressed,
  so Vite can return the requested bytes without decoding the pack. UI requests
  do not open the separate export pack. Explicit `/catalog/`, `/providers/`, and
  `/pricing/` requests are served from `data/export-assets.pack`; they do not
  parse either canonical mirror. When either checked-in pack changes, the dev
  server invalidates its in-memory profile; a UI-pack change reloads the page so
  the catalog index, detail schema, and deferred chunks always advance together.
- `/catalog/models.json`, `/catalog/summary.json`, `/catalog/ids.json`, the
  audit-rich `/catalog/index.json`, provider-scoped profiles, and
  `/pricing/index.json` remain explicit public downloads documented in the
  repository, not application dependencies. Build validates both compressed
  packs and their shared pair identity, then stream-materializes their entries
  into `dist/` without loading canonical catalog or pricing objects. Revalidate
  browser caches for UI requests.

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
- Derive alternating row surfaces from each row's absolute index in the virtual
  result set. Do not use structural child-position selectors because virtual
  spacers and range slicing make the rendered child position unstable.
- Implement range math in a small framework-neutral utility and render Vapor-native table markup. Do not add a VDOM virtualization dependency or dynamic measurement.
- Virtual range calculation follows the independently scrolling `tbody`.
- One Vapor composable uses explicit host/viewport pairs for the table, filter
  popover, and inspector. It initializes OverlayScrollbars only when a
  hover-capable pointer is available and otherwise leaves native touch scrollports
  intact, except for the table's axis-specific scrollbars. The library
  owns scrollbar chrome and direct handle/track interaction; Vue owns content
  and virtual range calculation.
- The native select picker uses the same restrained scrollbar colors because it is not script-addressable.
- Publish total and absolute row indexes for assistive technology.

## Content safety

- Start CSS from a modern reset and system fonts.
- Keep an explanatory HTML shell usable without JavaScript.
- Interpolate only schema-validated catalog text and bind source URLs as normal links.
- Only reviewed build-time icon SVG may be injected as markup. Never treat external catalog values as HTML.
