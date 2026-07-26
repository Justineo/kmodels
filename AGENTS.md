<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

# Kmodels repository guide

## Start here

- Read `design.md` first, then only the linked topic or provider documents relevant to the change.
- Treat those documents as the source of truth. Update the relevant guide in the same change whenever behavior or understanding changes.
- Record only the current decision and its rationale; replace obsolete guidance instead of appending history.
- Keep repository-wide rules here, domain decisions in `docs/*.md`, and provider decisions in `docs/providers/*.md`. Keep `design.md` links synchronized.

## Repository map

- `src/catalog/`: catalog domain, collection, validation, presentation, and static endpoint generation.
- `src/components/`, `src/composables/`, and `src/App.vue`: Vue frontend.
- `scripts/collect.ts`: live catalog collection entry point.
- `tests/`: behavior tests; `tests/fixtures/` contains reviewed provider inputs.
- `data/`: durable generated catalog consumed by the static build.

## Toolchain

- Use `vp` as the command entry point. Run Vite+ built-ins directly, `vp run <script>` for `package.json` scripts or configured tasks, and `vp exec <command>` for local package binaries.
- Do not invoke pnpm, npm, Yarn, or Bun directly. Use `vp pm <command>` only when Vite+ has no higher-level equivalent.
- Keep the pinned pnpm version and lockfile authoritative. Use `vp install --frozen-lockfile` when dependencies need installation.
- Use `vp run build`, not bare `vp build`, for production validation because the project script also runs `vue-tsc`.

## Engineering constraints

- Use one strict TypeScript ESM project targeting ES2023. Keep `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, unused checks, and switch fallthrough checks enabled.
- Keep code small and concrete; avoid speculative abstractions.
- Never use `any` or unchecked assertions. Parse external `unknown` values at boundaries, normally with Zod or explicit type guards.
- Keep the frontend close to the bare TypeScript create-vue structure.
- Build the UI with the pinned Vue 3.6 RC Vapor runtime/compiler set. Every SFC uses `<script setup lang="ts" vapor>` and the app mounts with `createVaporApp`.
- Keep deployment static. Vite generates catalog assets and Void deploys `dist/`; do not add a production server or worker without a documented design change.
- Keep shared visual values in `src/tokens.css`. Component styles consume semantic tokens instead of adding one-off colors, sizes, radii, shadows, or motion values.
- Treat external content as untrusted data. Never render catalog values as HTML; only reviewed build-time SVG may be injected as markup.
- Use fixtures for deterministic collector tests. Run the live `vp run collect` only when refreshing `data/` is explicitly in scope.

## Done

Before handoff, update affected guides and run all of:

1. `vp check`
2. `vp test --run`
3. `vp run collect:fixtures`
4. `vp run build`
