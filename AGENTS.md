# Repository guidance

- `design.md` is the source of truth for repo-wide design decisions. Read it before changing code and update it in the same change whenever a decision changes.
- Keep TypeScript small and exact: no `any`, no unchecked assertions, and no speculative abstractions. Parse external data from `unknown` at the boundary.
- Collection is deterministic and credential-free. Publish only facts observed from allowlisted official sources; never add LLM inference or cross-provider inheritance.
- A failed or suspicious refresh must retain the last validated catalog.
- Before handing off, run `npm run check`, `npm test`, `npm run collect:fixtures`, and `npm run build`.
