---
name: Catalog repair
description: Review new catalog collection problems and repair reproducible source drift in a pull request.

on:
  schedule: daily
  workflow_dispatch:

permissions:
  contents: read
  pull-requests: read

engine: copilot

concurrency:
  group: catalog-repair
  cancel-in-progress: false

tools:
  edit:
  web-fetch:
  bash:
    - "git:diff"
    - "git:status"
    - "node:*"
    - "rg:*"
    - "vp:*"

safe-outputs:
  create-pull-request:
    title-prefix: "[catalog-repair] "
    labels: [catalog-repair]
    draft: true
    max: 1
    if-no-changes: ignore
    fallback-as-issue: false

steps:
  - name: Check whether repair work is needed
    id: repair_gate
    env:
      GH_TOKEN: ${{ github.token }}
      KMODELS_CATALOG_REPAIR_CONTEXT: /tmp/gh-aw/agent/catalog-repair-context.md
    run: |
      if [ "$(gh pr list --state open --label catalog-repair --json number --jq length)" -gt 0 ]; then
        echo '{"type":"noop","message":"An open catalog-repair pull request already exists"}' >> "$GH_AW_SAFE_OUTPUTS"
        echo "repairable=false" >> "$GITHUB_OUTPUT"
      else
        node scripts/catalog-repair.ts --github-output "$GITHUB_OUTPUT"
      fi

  - name: Set up pnpm
    if: steps.repair_gate.outputs.repairable == 'true'
    uses: pnpm/action-setup@v6

  - name: Set up Vite+
    if: steps.repair_gate.outputs.repairable == 'true'
    uses: voidzero-dev/setup-vp@v1
    with:
      node-version: 24.18.0
      cache: true

  - name: Install dependencies
    if: steps.repair_gate.outputs.repairable == 'true'
    run: vp install --frozen-lockfile
---

# Review and repair a catalog collection problem

Read `design.md`, `AGENTS.md`, `/tmp/gh-aw/agent/catalog-repair-context.md`, the latest
`data/refresh-summary.json`, and only the provider guides relevant to the listed candidates.

Review every candidate emitted by `scripts/catalog-repair.ts` enough to decide whether it represents
a code-repairable problem. If one or more candidates share one coherent root cause, repair that cause:

1. For a public source, fetch its exact reviewed `source_url`. For an authenticated source, use only
   the sanitized refresh evidence, existing fixtures, and parser contract; never request or expose a
   credential. Reproduce the parser, contract, provider-validation, or pricing-validation problem.
2. Decide whether a deterministic code repair is possible. The gate deliberately presents all new
   structural findings and regressions rather than trying to prove their root cause in advance. A
   transport failure, missing credential, ordinary unknown pricing coverage, or a price the provider
   does not publish is not repairable.
3. Make the smallest parser change. Preserve strict identity joins, scope boundaries, drift guards,
   and exact decimal price handling. Never infer a price from another model, family, provider, region,
   or service; never convert missing pricing to free or not-applicable; never lower a count or coverage
   threshold merely to admit the new source.
4. Add or update a reviewed deterministic fixture and regression test, increment the affected
   extractor version, and update the relevant provider guide with the current rule and rationale.
5. Do not run the live collector and do not modify anything under `data/`.
6. Run `vp check`, `vp test --run`, `vp run collect:fixtures`, and `vp run build`.

If the failure cannot be reproduced or cannot be repaired without guessing provider intent or an
unpublished price, make no changes and do not create a pull request. Otherwise create one small draft
pull request describing the source change, repair, and validation results.
