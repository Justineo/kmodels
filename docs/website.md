# Website

Status: implemented core; provider pricing convergence is in progress

## Product shape

When the accepted snapshot includes inference ID mappings, model pricing identifies the exact
**Inference model ID**. Group IDs with identical matching rules and pricing conditions and use
the same compact ID and copy icon control as in the header when all IDs share one group. With
multiple groups, show a single picker with an option for each exact ID and an adjacent copy icon
for the selection. Preserve the pricing inputs that remain applicable after changing the ID or
Pricing offer. When the
only inference ID equals the header's catalog ID, show that exact value with the same copy control
in Pricing.
Use associations for the selected catalog entry. When mapping is unknown,
keep ordinary catalog prices with an explicit notice. A catalog alias can also be an inference ID
when its pricing association is independently evidenced.
The shared commercial controls expose execution, billing basis and evidenced tier/speed options.
Use **Request mode** for execution, with **Request**, **Batch**, and **Realtime** options matching
the canonical values directly. Request includes streaming responses; Realtime denotes a live-session
API rather than a latency guarantee. Use **Billed service tier** for the observed tier. Group canonical controls into
**Plan** and **Usage conditions** using their declared ownership. Account plan identifies the active
pricing program; request mode and billed tier qualify its rates. Canonical condition choices and
native price selectors share one **Usage conditions** fieldset and one continuous two-column grid.
The canonical mapping is an input convenience, not a separate category of pricing condition.
Resolve native single-value fields before generating mapped commercial controls, and keep those
values in the matching context. Show only dynamic conditions needed to select the displayed
rates. Fixed values and a sole Pricing offer stay internal; do not add a Price scope summary or
one-option controls. Fixed request mode, billing basis, and cache mode also stay out of rate annotations.
For mapped commercial fields, determine fixedness from the unselected subject's domain, not the
values left after another commercial selection. A dependent singleton fills its editable control
while preserving alternatives; editing it removes only incompatible explicit selections. Commercial
alternatives stay selectable even when a native input such as Region conflicts. Give the edited
choice priority, retain compatible commercial choices, and then retain native inputs in selector
order while their joint scope still has price evidence. Clear conflicting native inputs and prompt
for the missing conditions before showing rates; preserve every compatible input. Derived
values never become explicit selections just because another control changes. Selection order must
not decide whether a field is editable. Fields with no remaining applicability can still disappear.
This ordering applies to model-ID, ordinary and provider-resource pricing.
For offer details, derive native control availability from the commercial scope before applying
user-entered native selections. Apply those selections when querying rates; feeding them back as
fixed scope would hide Region immediately after selection and prevent further edits.
Apply their native predicates without restricting unrelated price rows to a commercial claim's
narrower scope. Unknown price evidence remains unknown.
Use consistent control heights and borders, collapsing to one column on narrow
screens. Keep labels above controls without persistent help text. Choice controls with at most five
options render as a segmented radio group at its natural width, with each segment sized to its
own label. This also applies to **Other charges & services**. Use a dropdown when the group exceeds
the available width, when there are more options, or when the empty value has its own meaning,
such as following the pricing region.
Selecting the active segment again clears it, matching the dropdown placeholder. Region and deployment-scope
labels use the shared keyboard- and touch-accessible tooltip. For Alibaba Cloud Model Studio,
these explain API access/data storage region versus inference execution scope; Global does not
guarantee inference within the selected API region. Other commercial definitions remain in titles.
Automatically apply a sole condition value only when its mapping covers every remaining price
context, not merely every offer ID. A Standard speed scoped to Request cannot silently discard
Batch while Request mode is still unselected. Resolve fixed values without additional UI. The scope describes the displayed published prices;
it does not establish the caller's actual usage or provider support outside that scope. Keep the
underlying applicability predicate even for a singleton. Public lookup requires caller inputs or
evidenced ID bindings and never guesses an actual value from a one-value published domain.
Recompute these values from the
current options rather than storing them as user selections, so switching request mode or plan can
restore alternatives. Evaluate automatic scope without the value's own explicit selection and
native bindings. A scoped singleton resolves automatically only when it preserves every remaining
price context; automatic resolution does not by itself make the control read-only.
A sole account plan still requires an explicit choice; availability alone
does not establish enrollment.
Served fields are labeled as observed outcomes or explicit planning estimates. Options retain
correlations; selecting Batch does not invent Fast support. Provider-specific residuals remain
readable and unresolved coverage is explicit. Resource and fallback offer controls use the same
canonical-to-native resolver. Services and capacity retain their existing groups and composition.
When multiple offers remain without a canonical account-plan control, a **Pricing offer** radio
group uses their existing names and starts unselected. The label names a published price list such as `Public rates`;
it is not a mode and must not compete with **Request mode**, the canonical execution choice. Do not duplicate account-plan selection
with another offer picker or native account-eligibility control. Selecting an offer retains compatible condition inputs
and limits the displayed conditions and rates to that offer. Publication runs the
same `createInferencePriceLookup` used by external consumers and stores compact candidate references
and audit-free matching conditions in optional `inference_prices` detail metadata. The existing offer
chunks remain the price source. Interactive conditions execute the same matching function as the
public lookup, updating status, missing conditions and visible price rows together. Published menu
values remain scoped to the selected ID, commercial choices, plan and evaluation time. Prompt for the
required Pricing offer and conditions before showing rates with one line that names the missing
conditions. Once those inputs are complete, show applicable rates without a separate status heading,
or explain unresolved evidence such as imprecise validity or conflicting prices.
Fixed ID conditions remain in matching without a separate summary. Preserve candidate-specific
annotations when they distinguish multiple displayed prices.
When the ID picker has several groups, each ID's condition domain links back to the ID. A
categorical condition offers the values published by any ID, in the source option order, and a
chosen value narrows the picker to IDs whose published prices or fixed ID scope admit it. When
the selected ID no longer admits the value, a sole compatible ID replaces it as a dependent
singleton; with several compatible IDs the picker returns to an unselected state and rates wait
for an explicit ID. Linking never picks among compatible IDs, because each remains a distinct
request value with its own price. A Bedrock source Region therefore narrows Geo and Global profile
IDs without merging Region into the ID: the ID stays explicit and copyable. Unknown mappings
preserve ordinary catalog prices
with an explicit unverified-ID notice in the Inference model ID position; known exclusions do not fall back to unfiltered rates.
Snapshots without mappings retain the
catalog price view. Provider-specific conditions use readable English labels in controls, missing-condition
messages and rate annotations; namespace-qualified machine identifiers remain in structured data.
See [Inference model ID pricing](inference-pricing.md) for producer limits.

Pricing notes distinguish conflicting published prices from other unnormalized provider conditions.
A non-conflict warning names each affected charge and explains its evidence gap directly; an
unknown amount is an unavailable price, not an additional user-selectable condition. Keep the
known sibling rates visible and limit warnings to the applicable pricing context.
Describe the catalog's missing evidence without claiming the provider has not published a price.
Historical `Unpublished cache read` notes render as **Cache read** with an explicit catalog gap.
A conflict warning states that no single rate is available for the affected contexts. Group visible
conflicting quotes by billing meter in collapsed disclosures; count those groups in the notes summary
and show the quote count on each group. Expanding a group preserves every displayed quote, its
amount, and its applicability. Non-conflict notes remain individually visible. This presentation
does not resolve conflicts, alter canonical evidence, or merge the quotes into a selected price.

- The site is a full-width, full-height precision workspace, not a centered marketing page.
- One compact header shows Kmodels, model/provider totals, generation time, a GitHub repository icon, and a light/dark toggle. The localized relative generation time shows its complete timestamp in the viewer's current time zone in a tooltip and links to the catalog-producing GitHub Actions run when recorded on the commit; otherwise it links to the catalog-producing commit.
- Keep freshness details and catalog/pricing hashes in machine-readable data rather than persistent chrome.
- One toolbar keeps model-ID/name/alias search and a provider selector visible. A secondary popover contains task, lifecycle, and release-stage filters.
- Keep the provider selector as one alphabetized list using the same provider marks as the table and inspector.
- Pricing is browsed through model rows and their inspectors. There is no provider-level
  `Pricing & services` action. Independently priced request services remain in canonical
  price books; exact model-linked components appear in the model inspector.
- One semantic table fills the remaining viewport. Model details open in a right-side inspector.
- Unknown values stay explicit. Rows without a representative numeric price
  show a short model-level status with an explanatory tooltip.

## Table and details

- Give each inspector fact one home. The header owns provider, display name, and the original catalog
  identifier without a separate visible label. Primary lifecycle/release status and catalog scope begin the content in one compact
  metadata line; Overview does not repeat those fields. Keep the exact model ID as a compact copy
  control even when it repeats the display name, and show a distinct version beside it without
  including that separate field in the copied ID.
  Keep task, delivery, limits, dates, availability, modalities, supported
  capabilities, endpoints, and pricing in their respective sections. The inspector shows the
  Catalog ID in its header and evidenced Inference model IDs in Pricing. Static aliases remain
  available for catalog search and identifier lookup.
  Show regional availability in a collapsed
  `Availability details` disclosure, summarized by region and deployment-type
  counts. Inside, group the documented regions under a readable deployment-type
  label. Leave unlisted regions unknown rather than presenting the data as an
  exhaustive support matrix.
- Pricing has no target/case inspector, request-template step or account-resource confirmation.
  Protocol support and execution readiness do not gate published commercial rates. The independent
  [inference ID lookup](inference-pricing.md) uses only explicit verified associations;
  static aliases alone must not be presented as verified ID-to-price mappings.
- Keep single-variant provider models as one ordinary row. When the filtered
  result contains multiple exact versions of one `(provider_id, model_id)`,
  show one collapsed parent row with the variant count. Its identity uses the
  first provider display name in stable catalog order that differs from
  `model_id`, falling back to `model_id`; this display choice never implies a
  preferred or latest version. Every other parent cell shows an exact value
  only when all visible variants agree. Otherwise it uses the shared dotted
  tooltip treatment to name the distinct values and make `Varies` a disclosure
  action. Mouse and keyboard activation toggle the exact version rows; touch
  follows the shared first-tap explanation and second-tap action behavior. The
  version-count badge toggles the rows immediately.
  Compare representative input, cache, and output independently so an agreed
  rate remains exact when only another pricing column varies. Expanding inserts
  the exact variants as fixed-height child rows, and selecting a child opens its
  details. Never infer or label a latest version from version spelling. Always
  show the complete version in child details and JSON.
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
  fractions are never exposed. Do not repeat `/ 1M tokens` in every cell. Exact numeric cells do
  not add a tooltip when their value and unit are already visible; accessible labels retain the
  namespace-qualified exact copy for provider-owned meters, units, or credits.
- Representative columns are derived only from canonical price books. A cell
  shows a number when one normalized rate is proven invariant across the
  complete applicable offer context;
  otherwise one dotted-underlined text status, framed by fine, evenly spaced,
  light-neutral 45-degree hatch marks across the three pricing columns, explains
  the model-level outcome in a tooltip. Use `Varies` for a
  context-dependent price, an offer count for
  several base offers, and retain the exact `0` (explicitly free), `Quote`,
  `Unpublished`, `Incomplete`, `No offer`, `Unknown`, or `No base offer` distinction. An exact offer
  that cannot fit the three columns shows the amount and explicit unit across those columns
  when it has one invariant, fully covered rate. This uses the same canonical projection and
  evidence checks as ordinary price cells, including provider-owned meters and zero rates.
  The tooltip identifies the offer so a software-only price is not presented as a total bill.
  These directly displayed single rates also count toward representative pricing coverage.
  Numeric zero rates remain visible as zero. Provider-owned token meters with an explicit
  canonical total-input or output token charge binding use the corresponding table column,
  including structured-decision output. An explicitly free offer displays `0` without inventing
  a currency or billing unit; unknown or conditional pricing never becomes zero.
  Multiple simultaneous rates retain their count. Provider credits such as
  DBUs and transcription duration still appear directly in a semantic column; simultaneous realtime
  message and session-duration charges remain a count because either single value would omit part of
  the cost. Interactive pricing status keeps the same body size as other table cells; its
  affordance comes from the dotted underline and interaction states. This status is never owned by
  the input meter. There is no
  secondary flat-price data source. On an exact model row, activating the status opens
  that model's inspector at the pricing section; it does not choose an offer or
  pricing context on the user's behalf.
- Mapped and catalog pricing share one detail flow: `Inference model ID (or its unverified-mapping
  notice) → [capacity charges when linked] → [Pricing offer when selectable] → dynamic Usage
  conditions → rates or a one-line selection prompt → collapsed related services → refresh status`.
  Model, capacity and service pricing use the same muted prompt after their controls while waiting
  for input. When some choices are in place, use the remaining controls' labels in their display
  order. The first mechanism in stable presentation order is the initial browsing focus, not a provider default,
  recommendation, or cheapest-offer choice. A sole mechanism resolves internally without a Pricing offer summary.
  The selected mechanism remains the context for its request-cost breakdown; exact mechanism
  references filter its related costs. Public running-capacity rates occupy a separate block and
  are never converted to per-request prices. Capacity books with the same offer identity and
  charge signal appear under one heading when each has a single fixed capacity option; the viewer
  chooses a resource before its regional rates appear. Only books exactly linked to that model are
  offered, and the first option is not treated as a default. The model rates are primary for request pricing. Services,
  automatic charges, included features, and independently callable services are grouped behind one
  closed disclosure by default because they do not change the base model rates. It expands them
  in that order. Each offer keeps its price-changing options and meters. Exact rates form one bordered
  list with a row per charge: the charge name and qualification on the left, then the amount and
  unit. When two or more visible charges share the same billing unit, they group together under one
  shared unit header (such as `Per 1M tokens` or `Per 1K requests`) and omit the repeated
  unit suffix from each row while preserving the complete accessible unit text; singleton-unit charges
  keep their slash-prefixed unit inline. Amounts align within each group. On narrow screens
  inline-unit rows give the name its own line above the amount, while shared-unit rows keep the
  name and amount together. Standard request meters follow input, cache, then output, and other
  charges follow by name. Rates are billed separately. When Pricing offer is selectable, the
  selected choice already names the active base
  mechanism and its rate block does not repeat that title. Supplementary offers use the user-facing
  relationship as a group heading. Independently offered services share one provider heading and
  compatibility note. The closed service row shows the relevant conditions or a resolved price.
  Opening it reveals the same controls and rate grid used for model usage prices. All choices
  apply together, including operation, billing currency, region and usage ranges.
  Account plans and prepaid commitments are omitted. Label an included service charge
  **No extra charge** and a published free state **Free**. Keep the unit on numeric zero prices.
  See [Service prices](commercial-topology.md#service-prices) for the projection rules.
  Offer choices show one
  reviewed title; they omit generated book labels, repeated default `Metered pricing` copy, and
  explanatory prose already implied by the control. Multiple mechanism choices form a compact
  wrapping radio group; its native keyboard behavior owns arrow keys and must
  not navigate between models. Keyboard focus is shown once on the complete choice surface rather
  than repeated around its native radio. Fresh pricing shows a localized relative verification time;
  its tooltip provides the complete timestamp in the viewer's current time zone. A retained partition
  keeps the verification time in the header and ends the Pricing section with one muted status line with both the preserved
  verification time and the latest rejected-attempt time plus a reviewed
  explanation. For an unknown model it says that the last verified provider
  snapshot contained no pricing; it never implies that the model previously had
  a price or that model-level validation failed.
  Selecting another Pricing offer resets only the outgoing mechanism's child context, and context
  filtering never hides or reorders the choices above it. Each related offer owns its local
  conditions and overrides. Categorical conditions with multiple values use the shared customizable-select
  component, with an empty choice and labels from reviewed vocabulary or projection data.
  Changing any condition preserves other selections whose meaning and applicable domain survive.
  The edited value takes precedence over conflicting earlier choices; there are no field-name reset
  lists. This rule applies to both model and provider-resource pricing, including plan and offer
  changes. Native inputs such as Region constrain commercial alternatives: excluded alternatives
  are disabled, and a dimension with no applicable alternative is hidden. Native option domains
  intersect the surviving prices with the selected commercial scope. Speed labels performance classes such as
  Standard/Fast; Service tier labels service classes such as Standard/Priority/Flex. Requested and
  billed service tiers remain distinct when the provider distinguishes them.
  Configurable controls in the same grid row stay top-aligned when one control includes guidance or
  validation text. A categorical dimension, exact decimal selector, or decimal bucket with one
  possible value in its unselected domain resolves internally without rendering a field or summary.
  A categorical selector whose values carry a recurring daily or weekly billing rule exposes one
  compact UTC rule disclosure below the control. Its values render as separated marker rows rather
  than an undifferentiated text list. Selecting a value highlights its row and filters rates; the
  viewer's clock never selects a recurring value. Exact UTC validity instead versions an entire
  published rate plan.
  Model details resolve those exact boundaries against the viewer's clock, show only the current
  plan by default, render its absolute times in the viewer's current time zone, and expose the next
  plan through one compact effective-time preview explicitly labeled `Upcoming rates`. Previewing it
  identifies it as future pricing and offers a return to current rates. Any dated offer fact,
  including a rate, allowance, contribution or pricing note, can establish this transition; a change
  to the overall pricing state is not required. The preview
  swaps the same rate surface rather than duplicating it. Imprecise year, month, or date validity
  remains unresolved and visible as source-published qualification.
  Price-query controls contain only dimensions that can change a rate or leave its numeric state
  partially covered. When every still-possible variant of one rate has the same
  amount, denomination, unit, driver, and validity and together covers the
  complete remaining numeric offer-state scope, and every possible state is numeric, that rate appears
  immediately without repeating invariant dimensions. Driver equality includes a compact quantity
  identity for exact scaling and calculation rules, so equal unit prices with different minimums or
  quantity formulas keep their required context. Acquisition field locations and evidence do not
  affect this identity; the browser receives neither those mappings nor the calculation graph.
  Unresolved unequal or
  partial alternatives remain hidden until their required controls are chosen; the control labels
  and empty choices communicate that requirement without a repeated section heading or prompt.
  Account enrollment, settlement, and plan selectors are outside the Gateway
  rate-book UI. Capacity selectors are shown only for linked public running-resource rates.
  The controls resolve exact applicable rates but do not estimate
  usage, consume allowances, or calculate a total. Selected applicability is not
  repeated on each resolved rate, allowance, or state. A resolved plan boundary appears once in
  a compact, icon-led status band instead of being repeated on every state and rate; unresolved
  validity remains visible. A single offer state stays in the offer
  summary; state detail appears only when the offer has multiple possible outcomes.
  Numeric context preserves its published domain: singleton predicates become
  choices, and contiguous finite or unbounded domains become ordered range
  choices whose labels retain the exact `<`, `≤`, `>`, and `≥` boundary
  operators. Overlapping integer bands are split at every predicate boundary so
  each choice resolves every original condition without guessing a representative
  value. Ranges with gaps or continuous-decimal overlaps accept an exact value and
  reject invalid or non-integral count/TTL input.
  A single contiguous band is one bucket and resolves internally in both
  pricing views; it never requires a fabricated usage count. Context labels abbreviate
  exact thousands and millions as K/M without rounding a boundary. The first positive
  token band may omit its lower bound in the label (`≤ 1M` for `0 < tokens ≤ 1M`),
  while its matching predicate retains that bound and the inclusive upper boundary.
  Changes to the projected selector contract advance the UI projection version and rebuild its
  snapshot, so an unchanged canonical price book cannot retain stale cached controls.
- The rate matrix shows the charge name, rate, unit, and unresolved validity qualification. A
  reviewed rate-term label names the charge when available, with the meter name as the fallback.
  Pricing notes and references to that term use the same name. Driver definitions, aggregation and
  resolution phase remain available in canonical pricing. A published minimum billable quantity
  qualifies its rate row.
  A missing driver never hides a rate. TTL and other rate-changing facts remain conditions. Selecting
  geography must not hide a still-required TTL; a sole published value resolves internally.
  The UI must not interpret provider-specific term keys.
  Contribution rows expose the same driver metadata without copying the target rate. Generic
  usage-based billing is omitted because the meter, unit, and rate already express it. These rows
  explain what affects cost without accepting usage input,
  multiplying quantities, or presenting an account total.
  Information priority is meter, amount, and unit; then rate-changing choices; then pricing notes on
  demand. Pricing notes translate unsupported normalized structures into a concise provider
  condition and user impact; internal reason codes, raw-impact names, and unconditional scope labels
  are not UI copy. Display dollar amounts as plain text without Markdown escape backslashes.
  Identical note content with the same impact, reason and validity is displayed once,
  with the union of its published scopes. A scope qualification is omitted only when that union covers
  every current offer state; available selector values alone do not prove complete coverage. Unknown
  scopes remain unknown, and different conditions or dates retain separate notes. Canonical facts and
  evidence are preserved independently of this display grouping.
  Time allowances use the largest exact readable unit. Fixed metadata, driver
  definitions, and invariant explanations stay out of model details.
- Keep the Pricing section mounted after a detail request fails. Model and service
  pricing failures share an alert with a “Refresh page” button. Reloading the current
  URL preserves the selected model and loads the current catalog and JavaScript modules
  together when a deployment has replaced assets used by an open tab.
- Model-associated charges and independently callable provider services share one collapsed
  `Other charges & services` disclosure and one `PricingServiceOffer` row. Both use the same
  price summaries, context controls, current/upcoming timeline, notes and charge definitions. Resource
  scope affects applicability and the card's context, never a second service browser or provider-specific
  presentation path. Provider services remain explicitly independent of model compatibility.
  When inference pricing is active, its surviving plan references scope model-associated cards.
  The cards share only conditions established across the surviving candidates. An exact, current
  composition link may bind a condition whose shared meaning is reviewed in the provider guide.
  A model association alone provides browsing context. When a service publishes prices for the
  same provider-qualified Region, its Region picker follows the main Pricing choice until the
  viewer makes a local override. The empty option resumes following. Services retain their own
  operation, execution scope, and other local conditions. The disclosure evaluates the inherited
  context when open and continues loading independent offer bodies lazily.
  A service can publish both metered and included operations. Both outcomes keep applicable
  plan properties fixed. Selecting an included operation shows its pricing state and hides
  rate details belonging to the metered operation.
  A button uses the detail disclosure styling and exposes the controlled panel's expanded state.
  Opening the disclosure loads provider resource metadata and the first 12 visible offer bodies.
  Pagination reveals another 12; a search can load remaining metadata chunks but hydrates only visible
  matches. Small lists omit search and paging controls. Offers already available through the model
  are excluded from the independent list by exact ID. A failed offer shows its alert in its
  own card so loaded siblings remain readable. Canonical books retain their original scopes and evidence.
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
  matrix, while other standard units retain reviewed source-native scales (such as `1K items`,
  `10K characters`, `1K events`, `1K frames`, or `megapixel`) when they match the observed source
  quote; overflow falls back to the canonical per-unit rational.
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
- Search uses a small in-memory index of lowercase IDs, names, and aliases with spaces and hyphens removed. Match literal substrings only; do not fuzzy-expand or relevance-rank.
- Filters update immediately. Selecting an inline facet replaces only that category and preserves other state.
- The default lifecycle selection is Active, Legacy, and Unknown. Legacy models remain available
  with restrictions or supersession, and Unknown preserves models with unresolved lifecycle
  evidence. Select Deprecated or Retired in the Lifecycle filter to include those models.
  An empty lifecycle selection shows zero results.
- Keep separators between multiple facet values presentational and outside interactive controls.
- Sortable headings cycle default, ascending, descending, then default.
- Model identity, its disclosure control, and an exact model's pricing status
  open details; the whole row is not a button.
- The inspector is a non-modal `<dialog>`. Its panel receives pointer input while the catalog remains interactive.
- On desktop, align the inspector header divider with the bottom of the catalog toolbar. On narrow
  screens, anchor the full-viewport inspector to the dynamic viewport and transition it vertically;
  retain the right-edge transition only for the desktop side panel.
- Up/Down selects the previous/next visible model unless focus is in a control that owns arrow keys. Selection resets inspector scroll. Explicit close and Escape dismiss it.
- Focus styles use `:focus-visible`, including containers with a focus-visible descendant.
- Catalog and inference model ID copy controls show success for two seconds, restarting that
  interval on each successful copy. Changing the model or selected inference ID clears the feedback.
- The appearance button switches directly between light and dark, labels the destination, and persists the explicit choice. Initial appearance follows the OS.
- Provider and pricing-context selection reuse one progressively enhanced
  `UiSelect` component using `appearance: base-select`; the browser owns
  selection, keyboard, focus, placement, and dismissal. Set the appearance
  directly on both the select and its complete `::picker(select)` rule so
  production CSS minification preserves the picker enhancement. The visual
  value mirror is pointer-transparent.
- The website displays SpaceXSI for the `xai` provider, including when a published
  catalog still carries the xAI label. Provider filters and model links use the
  catalog's stable IDs.
- The secondary filters use `<dialog popover="auto">` for non-modal top-layer behavior and light
  dismissal. Keep its title/actions outside its scroll viewport, and keep the toolbar trigger free
  of selection counts.
- Do not use modal-dialog `closedby="any"` for light dismissal until it is baseline.
- The toolbar and empty-state reset actions restore the default search, provider, task, lifecycle,
  and release-stage filters. The popover reset applies only to its filters. Reset is disabled
  when the corresponding filters are at their defaults. Filtering or sorting resets virtual scroll.
- Keep the workspace header and table header fixed while results scroll.
- Motion is short and removed under `prefers-reduced-motion`.

## Shareable state

- Use the query string without a router.
- Keys are `q` search, `p` provider, `o` task, `l` lifecycle, `r` release stage, `s` sort, and `m` selected model.
- Keep historical key `o` for shared URL compatibility even though the field is now `tasks`.
- Use stable one-character enum/sort codes and omit defaults.
- An omitted `l` uses the default lifecycle selection. An explicit empty `l=` selects no
  lifecycles. Nonempty lifecycle codes continue to identify their exact selections.
- Replace the current history entry on state changes; `popstate` restores visited state.
- Theme is local preference. Version-group expansion, popover visibility, and
  scroll positions are transient.
- Preload `/ui/catalog/index.json` from the HTML shell. This lightweight manifest
  contains provider labels, the data version, and ordered chunk row counts.
  Load `/ui/catalog/chunks/<data_version>/<chunk>.json` with at most four concurrent
  requests and await all chunks before mounting. Core table data never has a
  deferred loading state.
  Split deterministically at model-row boundaries using the serialized UTF-8
  size, capped at 128 KiB per chunk (including its envelope and dictionaries).
  Each chunk keeps model rows and their representative prices together, with
  local status and price-cell dictionaries. Inventory growth creates more chunks;
  there is no fixed aggregate-size target or growth warning. An indivisible row
  or manifest exceeding the chunk ceiling is a publication error.
  Verify each chunk's version, ordinal and row count, the complete pricing/model
  correspondence, and model uniqueness before mounting. Completion order cannot
  change row order. Versioned chunk URLs prevent mixing cached snapshots.
  Model rows contain only the fields needed for grouping, search, filters, and
  sorting. Browser-only UIDs
  are derived from the exact tuple; `updated_date`, inspector facts, audit
  fields, and random per-model references do not inflate either payload.
  Both kinds of rows use versioned compact tuples instead of repeating field names.
  Catalog rows index providers and fixed vocabularies; pricing rows index shared
  status and cell dictionaries. A display name identical to its model ID and a
  zero detail-chunk index use compact sentinel values and are restored at the
  boundary. Expand the rows once in the dependency-free parser, while retaining
  shared task, status, and pricing-cell objects in memory. This encoding is
  transport-only and does not weaken closed-schema validation or change UI
  semantics.
- After first paint, preload complete details for exact model rows in the
  current virtual window, including overscan, and refresh as filtering,
  expansion, or scrolling changes that window. Collapsed group children and
  models outside the window remain request-on-open. Opening an inspector reuses
  completed or in-flight work. Detail assets are
  provider-scoped, deterministic chunks capped at 2 MiB uncompressed; large
  providers may own several numbered chunks. Model pricing refers to exact
  provider-local offers in `/ui/offers/<provider>/<chunk>.json` instead of
  copying the same display-ready offer into every applicable model. A detail
  chunk also shares its provider pricing snapshot across models. Standalone
  provider resources use the same offer dictionary. Offer chunks use the same
  bound and are requested only for a selected or window-preloaded model.
  Model details share identical inference-matching tariffs across a model's
  request IDs while retaining each ID's own fixed selectors. The loader restores
  those references before use; the transport version participates in `data_version`.
  Local condition dictionaries, variant tuples, and shared selector options preserve the same
  matching input. Inventory and pricing coverage growth can add chunks. The
  2 MiB ceiling applies to each requested chunk.
  The writer emits strict schema 12 for chunks containing scoped limit or capability statements
  or inference price mappings. Statements retain their applicability, and inference prices retain
  their matching inputs. The projection keeps claim owners, evidence and mapping URLs in canonical
  and audit data. Affected publications add the `model-details-v12` salt to `data_version`.
  Chunks without those details retain the schema 7 shape. The reader accepts schemas 7 through 11
  for existing publications and discards their embedded evidence at parse time.
  Cache completed and in-flight chunks by data version, and retain parsed model
  details after either path. Failed preloads stay silent and are evicted so an
  explicit open can retry.
- Provider pricing projections remain at `/ui/providers/<provider>/pricing/<chunk>.json`,
  in deterministic whole-resource chunks capped at 2 MiB uncompressed. The model-browser
  loads them on demand through the shared other-charges disclosure in model pricing. Resources retain
  lightweight offer summaries and grouped offer references for data consumers.
  Provider projections retain the complete unnormalized-fact count but include
  at most 20 display-safe preview rows per offer; the canonical pricing audit
  remains the complete download.
- The model inspector shows published publisher, license, model-size/context-range labels,
  languages, upstream ID, access and framework under Model information. Deployment configurations
  are a separate disclosure with a profile selector, package/Region identity, default and supported
  instances, serving framework and conditional context controls. Never promote these controls to
  the table's model-wide context limit. These facts live only in the existing byte-bounded detail
  chunks; inventory growth and richer details do not inflate the core rows or create aggregate-size
  warnings. Provider strings are rendered as text.
- Keep Context window and Maximum output in Overview. Place meaningful scoped values directly
  under the corresponding value as compact notes with an endpoint, amount or explicit cap state.
  Generate note text from
  [structured applicability](catalog-schema-upgrade.md#scoped-limit-details). Show the known
  endpoint label when available, and otherwise its evidenced path. Describe a beta exception
  briefly. Suppress a duplicate summary of the same
  quantity. If the same structured scope has incompatible maxima or cap states, show
  “Sources disagree” for that scope.
- Modalities & capabilities answers only what goes in, what comes out and what the model can do.
  Input and output appear once as modality tags joined by a direction arrow. Supported
  capabilities follow; unsupported and unknown capabilities are not shown. A model with no
  supported capability shows one "No capability information published" note. Delivery modes
  remain in Overview.
- Capabilities without native options are one row of tags. Capabilities with structured options,
  currently reasoning effort and prompt caching modes, become label/value rows of option tags.
  The default option has a distinct tag style and a "Default" tooltip, never inline text; when
  only some APIs state the default, the tooltip reads "Default where documented". Scope prose is
  not displayed. Options that every evidenced API shares appear once. An unstated default is
  unknown, not a difference, while disagreeing defaults for the same API leave that default
  unknown and mark the row with a "Sources disagree" indicator.
- Option values that differ between APIs belong to endpoints, not to the capability. The row
  reads "Varies by endpoint" and each Published endpoints row lists its own values, joined by the
  statement's `applicability.endpoint` path. A binding without a matching published endpoint
  stays under the capability, labelled by its evidenced interface.
- `src/catalog/capability-presentation.ts` maps each statement to the capability it evidences
  and its documented options and defaults. An exhaustive switch checks coverage when the
  schema gains a statement kind. All kinds share grouping, merging and endpoint placement.
- Use one `data_version` derived from the accepted catalog/pricing pair and core
  transport version on the manifest, core chunks, model-detail, shared-offer,
  and provider-detail projections. Reject mismatched core chunks before mounting
  and mismatched deferred details before rendering them.
  Scope deferred-source, parsed-chunk, and model-detail caches to that version;
  evict rejected requests so a transient fetch or validation failure cannot
  poison later attempts.
- Keep the initial catalog parser small and dependency-free. Provider/UI icons
  and table scrollbars belong to the first rendered state: start the icon
  sprite, applicable OverlayScrollbars runtime/CSS, and core manifest request
  concurrently; await them before mounting and initialize scrollbars during
  mount. These may be separate cacheable async chunks, but are not post-paint
  work. The first Vapor root renders only visible workspace chrome and the
  virtualized table. Keep catalog rows outside Vue's deep-reactive graph, and
  build the search index after first paint unless an earlier search needs it.
  After that paint, eagerly load the closed filter popover, inspector, their CSS,
  and the full closed-schema validator in parallel. Out-of-window model details
  remain interaction-demanded. On coarse touch
  devices, keep native
  scrolling for general surfaces; initialize the table's axis-specific
  OverlayScrollbars during the first mount against its real outer and nested
  body viewports.
  Keep both browser graphs browser-safe; canonical hashing and publication I/O
  remain build concerns. Keep post-paint chunks out of the HTML module-preload
  graph. Mount the inspector into a second Vapor root and share only the small
  reactive detail state.
- Keep source records, observations, locators, source fragments, derivations, and evidence in
  canonical catalogs, captured source revisions and machine-readable audit resources.
  Raw commercial facts in the UI may
  retain only display-safe structured parameters such as amount, denomination, unit, meter,
  validity, formula, and
  conditions. They retain displayed commercial semantics—including reviewed usage-signal
  definitions, aggregation boundaries, resolution phases, and provider-snapshot freshness copy.
  Both ID associations and ordinary prices can show verification status and explanatory copy.
  Unknown associations and known conditions with no applicable published price
  use different labels and explanations; an empty candidate set is not proof of provider non-support.
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
- `/catalog/models.json`, `/catalog/summary.json`, `/catalog/ids.json`,
  `/catalog/identifiers.json`, the
  audit-rich `/catalog/index.json`, provider-scoped profiles, and
  `/pricing/index.json` remain explicit public downloads documented in the
  repository, not application dependencies. Build validates both compressed
  packs and their shared pair identity, then stream-materializes their entries
  into `dist/` without loading canonical catalog or pricing objects. Revalidate
  browser caches for UI requests.

## Visual system

- Use Kong dark green `#000F06`, electric lime `#CCFF00`, Bay `#B7BDB5`, white, and the reviewed neutral scale through semantic tokens. Lime marks focus, selection, and active state; it is not decoration.
- Ground the system in Kong's 2026 brand rules, Apple HIG legibility, Vercel Geist utility patterns, and VoidZero/Vite+ structural restraint.
- Follow system-font legibility, mono identifiers, tabular numerals, thin borders, crisp planes, compact radii, and low-elevation floating surfaces.
- Use one compact four-step type scale expressed in `rem`: 11px metadata, 12px body and controls,
  15px headings including inspector titles, and 20px standalone fallback titles. Apply the body size
  to `body`, not the root element, so the `rem` steps retain those browser-relative sizes. Inspector
  section labels, including Pricing, and fact labels, including rate names, share the metadata
  treatment; offer titles, fact values, and exact amounts use the body size. Dense selectors and
  recurring rules also use the metadata size. Prefer weight, color, tracking, and spacing over
  additional intermediate sizes. Persistent text never drops below the metadata size, and normal
  browser text adjustment remains enabled.
- Inside the inspector, use spacing and bounded data surfaces for section hierarchy. Keep the header divider, but do not place horizontal rules between every content section or offer.
- Create hierarchy with alignment, weight, density, and information order. Do not add gradients, decorative imagery, oversized display type, floating-card composition, or decorative chrome.
- Reuse Kong's current ICO fallback plus 16px and 32px PNG favicon files.
- `src/tokens.css` owns immutable brand foundations, shared scales, light/dark semantic roles, and the smallest necessary repeated component roles.
- Components consume tokens; they do not introduce raw colors, font sizes/weights, radii, shadows, easing, transition duration, or shared custom properties.
- Theme and narrow-screen changes override token roles instead of component selectors.
- Use a 4px spatial base with a 2px compact step; 20/28/32px controls; 3px facet, 4–6px control/list, and 8px floating-surface radii; and 100/120/180ms motion tiers.
- Virtualization reads row/header metrics from CSS tokens. The token-contract test guards against one-off values.

## Icons

- Compile reviewed Lucide utility icons and Lobe provider marks into one hidden build-time SVG sprite. Visible icons use `<use>`.
- Use Together AI's standalone color mark in the square provider icon slot. Its horizontal brand wordmark loses legibility at that size.
- Use the standalone SpaceXSI mark from the [official developer docs](https://docs.x.ai/developers/models) for the `xai` provider. Preserve its proportions and theme-aware fill.
- Scope definition IDs per symbol so gradients remain stable.
- Use reviewed local assets when Lobe is missing or stale: Microsoft Foundry uses the current Microsoft architecture mark; Databricks uses official Lava 600 Simple Icons geometry; Amazon SageMaker AI uses the supplied AWS Architecture Service Icons (2025-07-31) mark, preserving its green background and white artwork. TypeSafe AI uses the supplied path with its original proportions and 0.86 opacity; `currentColor` follows the provider icon's black/light and white/dark theme colors.
- Provider marks keep reviewed brand colors. Monochrome marks have explicit light/dark variants; Cerebras remains orange. Kimi uses its complete black mark on light surfaces and color mark on dark surfaces.
- Provider icon containers have no border radius, preserving the artwork's original corners.

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
