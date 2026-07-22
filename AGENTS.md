# Repository guidance

- `design.md` is the source of truth for repo-wide design decisions. Read it before changing code and update it in the same change whenever a decision changes.
- Keep TypeScript small and exact: no `any`, no unchecked assertions, and no speculative abstractions. Parse external data from `unknown` at the boundary.
- Collection is deterministic. Public catalogs require no credentials; optional authenticated inventories are scoped validation inputs, never global presence or persisted raw data. Publish only facts observed from allowlisted official sources; never add LLM inference or cross-provider inheritance.
- A failed or suspicious refresh must retain the last validated catalog.
- Before handing off, run `pnpm check`, `pnpm test`, `pnpm collect:fixtures`, and `pnpm build`.
