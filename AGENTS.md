# Repository guide

## Working agreement

- Read `design.md` and the linked topic or provider document before changing behavior.
- Keep guides current. Update them whenever implementation or understanding changes.
- Record only the latest decision and its rationale. Replace obsolete guidance; do not append decision history.
- Put repository-wide engineering choices here, domain decisions in `docs/*.md`, and provider decisions in `docs/providers/*.md`.
- Keep `design.md` as the decision index. Add, rename, or remove its links with the documents they describe.

## Engineering choices

- Use one strict TypeScript ESM project targeting ES2023. Keep `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, unused checks, and switch fallthrough checks enabled.
- Keep code small and concrete; avoid speculative abstractions.
- Never use `any` or unchecked assertions. Parse external `unknown` values at boundaries, normally with Zod or explicit type guards.
- Use pnpm only. Keep its pinned version and frozen lockfile authoritative.
- Use VitePlus for development, formatting, linting, tests, preview, and builds. Keep `vue-tsc` in the production type-check path.
- Keep the frontend close to the bare TypeScript create-vue structure.
- Build the UI with the pinned Vue 3.6 RC Vapor runtime/compiler set. Every SFC uses `<script setup lang="ts" vapor>` and the app mounts with `createVaporApp`.
- Keep deployment static. Vite generates catalog assets and Void deploys `dist/`; do not add a production server or worker without a documented design change.
- Keep shared visual values in `src/tokens.css`. Component styles consume semantic tokens instead of adding one-off colors, sizes, radii, shadows, or motion values.
- Treat external content as untrusted data. Never render catalog values as HTML; only reviewed build-time SVG may be injected as markup.

## Completion

Run all of these before handoff:

1. `pnpm check`
2. `pnpm test`
3. `pnpm collect:fixtures`
4. `pnpm build`
