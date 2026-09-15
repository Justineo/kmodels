---
name: Catalog repair
description: Review new catalog collection problems and repair reproducible source drift in a pull request.

on:
  schedule: daily
  workflow_dispatch:

permissions:
  contents: read
  pull-requests: read

engine:
  id: copilot
  model: gpt-5.6-luna
  args: ["--effort=high"]

env:
  VP_HOME: /tmp/kmodels-vite-plus

concurrency:
  group: catalog-repair
  cancel-in-progress: false

tools:
  edit:
  web-fetch:
  bash:
    - "git diff:*"
    - "git status:*"
    - "command:*"
    - "find:*"
    - "rg:*"
    - "sed:*"
    - "test:*"
    - "vp:*"

safe-outputs:
  create-pull-request:
    title-prefix: "[catalog-repair] "
    labels: [catalog-repair]
    draft: true
    max: 1
    if-no-changes: ignore
    fallback-as-issue: false
  report-incomplete:
    max: 1
    create-issue: false

steps:
  - name: Check for an existing repair
    id: repair_dedupe
    env:
      GH_TOKEN: ${{ github.token }}
    run: |
      if [ "$(gh pr list --state open --label catalog-repair --json number --jq length)" -gt 0 ]; then
        echo '{"type":"noop","message":"An open catalog-repair pull request already exists"}' >> "$GH_AW_SAFE_OUTPUTS"
        echo "blocked=true" >> "$GITHUB_OUTPUT"
      else
        echo "blocked=false" >> "$GITHUB_OUTPUT"
      fi

  - name: Install Vite+ in the shared sandbox directory
    if: steps.repair_dedupe.outputs.blocked != 'true'
    run: |
      set -euo pipefail
      VP_VERSION="$(node -p 'require("./package.json").devDependencies["vite-plus"]')"
      export VP_VERSION
      curl --fail --silent --show-error --location --retry 3 https://viteplus.dev/install.sh | bash
      echo "$VP_HOME/bin" >> "$GITHUB_PATH"

  - name: Install the project runtime and dependencies
    if: steps.repair_dedupe.outputs.blocked != 'true'
    run: |
      vp env install
      vp install --frozen-lockfile
      vp env doctor

  - name: Check whether repair work is needed
    if: steps.repair_dedupe.outputs.blocked != 'true'
    env:
      KMODELS_CATALOG_REPAIR_CONTEXT: /tmp/gh-aw/agent/catalog-repair-context.md
    run: vp node scripts/catalog-repair.ts
---

# Review and repair a catalog collection problem

Read `design.md`, `AGENTS.md`, `/tmp/gh-aw/agent/catalog-repair-context.md`, the latest
`data/refresh-summary.json`, and only the provider guides relevant to the listed candidates.

The preparation steps installed the pinned Vite+ and Node.js in the shared `VP_HOME`, and installed
the frozen project dependencies. Start with `vp env doctor` and `vp node --version`. Use `vp node`
for Node.js scripts so they use `.node-version`; use the global `vp` command for all checks.
If the prepared toolchain is unavailable, report the failure with `report_incomplete` and stop.

Review every candidate emitted by `scripts/catalog-repair.ts` enough to decide whether it represents
a code-repairable problem. If one or more candidates share one coherent root cause, repair that cause:

1. For a public source, use `web-fetch` to fetch its exact reviewed `source_url`. For an authenticated source, use only
   the sanitized refresh evidence, existing fixtures, and parser contract; never request or expose a
   credential. Reproduce the parser, contract, provider-validation, or pricing-validation problem.
2. Decide whether a deterministic code repair is possible. The gate deliberately presents all new
   structural findings and regressions rather than trying to prove their root cause in advance. A
   transport failure, missing credential, ordinary unknown pricing coverage, or a price the provider
   does not publish is not repairable.
3. Make the smallest parser change. Preserve strict identity joins, scope boundaries, source-integrity validation,
   and exact decimal price handling. Never infer a price from another model, family, provider, region,
   or service; never convert missing pricing to free or not-applicable; never weaken a source-coverage
   contract merely to admit the new source. A published count decrease alone is diagnostic and does
   not require repair; assess completeness against the current source and its authoritative scope.
4. Add or update a reviewed deterministic fixture and regression test, increment the affected
   extractor version, and update the relevant provider guide with the current rule and rationale.
5. Do not run the live collector and do not modify anything under `data/`.
6. Review the diff, then run `vp check`, `vp test --run`, `vp run collect:fixtures`, and
   `vp run build`. Keep one validation run active at a time. Reuse completed results during final
   review; rerun a check only after a relevant code change or a diagnosed failure has been fixed.
   If validation is blocked by the environment, report the exact failed command and reason with
   `report_incomplete` and stop. All required checks must pass before creating a pull request.

If the failure cannot be reproduced or cannot be repaired without guessing provider intent or an
unpublished price, make no changes and do not create a pull request. Otherwise create one small draft
pull request describing the source change, repair, and validation results.
