<script setup lang="ts" vapor>
import { computed } from "vue";
import {
  limitStatementsConflict,
  type LimitDetailGroup,
  type LimitStatement,
} from "../catalog/model-limit-details.ts";
import UiIcon from "./UiIcon.vue";

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
      <p
        v-for="evidence in group.evidence"
        :key="`${evidence.document_url}:${evidence.content_hash}:${evidence.locator}`"
        class="unknown-note"
      >
        <a :href="evidence.document_url" target="_blank" rel="noopener noreferrer">{{
          evidence.document_url
        }}</a>
        · Observed <time :datetime="evidence.observed_at">{{ evidence.observed_at }}</time>
      </p>
      <details class="detail-disclosure">
        <summary><span>Source evidence</span><UiIcon name="chevron-right" /></summary>
        <div class="detail-disclosure-body limit-evidence">
          <dl
            v-for="evidence in group.evidence"
            :key="`${evidence.document_url}:${evidence.content_hash}:${evidence.locator}`"
            class="availability-list"
          >
            <div>
              <dt>Location</dt>
              <dd>{{ evidence.locator }}</dd>
            </div>
            <div>
              <dt>Evidence</dt>
              <dd>{{ evidence.excerpt }}</dd>
            </div>
            <div>
              <dt>Document SHA-256</dt>
              <dd>
                <code>{{ evidence.content_hash }}</code>
              </dd>
            </div>
          </dl>
        </div>
      </details>
    </div>
  </section>
</template>

<style scoped>
.limit-group,
.limit-evidence {
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
