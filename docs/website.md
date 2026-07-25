# Website

Status: implemented

## Product shape

- The site is a full-width, full-height precision workspace, not a centered marketing page.
- One compact header shows Kmodels, model/provider totals, generation time, the JSON entry point, and a light/dark toggle.
- Keep freshness details and catalog hash in machine-readable data rather than persistent chrome.
- One toolbar keeps model-ID/name search and a provider selector visible. A secondary popover contains task, lifecycle, and release-stage filters.
- Keep the provider selector as one alphabetized list using the same provider marks as the table and inspector.
- One semantic table fills the remaining viewport. Model details open in a right-side inspector.
- Unknown values stay explicit. Rows without a numeric price show an em dash.

## Table and details

- Keep display name and exact request ID together. Show provider, task, actionable lifecycle/release stage, context, representative input/cache/output prices, and update date.
- Show `@version` in a dense row only when the same provider has duplicate exact model IDs. Always show the complete version in details and JSON.
- Use short task badges for scanning while accessible labels, filters, titles, and details retain full names.
- Pricing headings expose the comparison units through the text itself. Normalize comparable token rates per million; display non-token rates in their native units.
- Representative columns are projections. Model details retain exact pricing status, rates, units, conditions, lifecycle, maturity, modalities, capabilities, endpoints, scopes, availability, and source links.
- Right-align numeric headings and cells with a shared sort-control gutter.
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
- Provider selection is one alphabetized progressively enhanced `<select>` using `appearance: base-select`; the browser owns selection, keyboard, focus, placement, and dismissal. The visual value mirror is pointer-transparent.
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
- Revalidate browser caches for catalog requests and migrate the previous `operations` envelope to `tasks` before validation so mixed static-asset versions do not blank the table.

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
