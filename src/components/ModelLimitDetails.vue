<script setup lang="ts" vapor>
import { computed } from "vue";
import {
  limitStatementsConflict,
  type LimitDetailGroup,
  type LimitStatement,
} from "../catalog/model-limit-details.ts";
import ModelClaimEvidence from "./ModelClaimEvidence.vue";

const props = defineProps<{ groups: LimitDetailGroup[] }>();
const statements = computed(() => props.groups.flatMap(({ statements }) => statements));
const hasConflict = computed(() =>
  statements.value.some((left) =>
    statements.value.some((right) => limitStatementsConflict(left, right)),
  ),
);
const measurements: Record<LimitStatement["measurement"], string> = {
  per_response: "Per response",
  per_hop: "Per hop",
  per_interaction: "Per interaction",
  shared_context: "Shared context budget",
};
function statementValue(statement: LimitStatement): string {
  if (statement.kind === "no_separate_cap")
    return `No separate provider ${statement.quantity === "output_tokens" ? "output" : "context"} cap`;
  return `${statement.kind === "maximum" ? "Maximum" : "Default"}: ${statement.tokens.toLocaleString("en-US")} tokens`;
}
</script>

<template>
  <section class="detail-section" aria-labelledby="qualified-limits-heading">
    <h3 id="qualified-limits-heading">Qualified limits</h3>
    <p class="unknown-note">
      Catalog summaries are unqualified. Each statement below has its own API, execution mode and
      token budget.
    </p>
    <p v-if="hasConflict" class="unknown-note" role="status">
      Unresolved source conflict: statements for the same scope disagree. No single limit is
      selected.
    </p>
    <div v-for="group in groups" :key="`${group.source_ref}:${group.claim}`" class="limit-group">
      <dl class="availability-list">
        <div v-for="(statement, index) in group.statements" :key="index">
          <dt>
            {{ statement.quantity === "context_tokens" ? "Context budget" : "Output tokens" }} ·
            {{ statementValue(statement) }}
          </dt>
          <dd>{{ measurements[statement.measurement] }}</dd>
          <dd class="limit-scope">{{ statement.scope }}</dd>
        </div>
      </dl>
      <ModelClaimEvidence :documents="group.evidence" />
    </div>
  </section>
</template>

<style scoped>
.limit-group {
  display: grid;
  gap: var(--space-3);
  overflow-wrap: anywhere;
}
.limit-group + .limit-group {
  margin-top: var(--space-4);
}
.limit-scope {
  grid-column: 1 / -1;
}
</style>
