<script setup lang="ts" vapor>
import { computed } from "vue";
import { limitScopeKey, limitStatementsConflict } from "../catalog/model-claim-helpers.ts";
import type { LimitStatement, WebsiteLimitDetailGroup } from "../catalog/model-limit-details.ts";
import { formatTokenCount } from "../catalog/presentation.ts";

const props = defineProps<{
  groups: readonly WebsiteLimitDetailGroup[];
  field: "context_tokens" | "output_tokens";
  summary: number | undefined;
  endpoints: readonly { path: string; name: string }[];
}>();

const annotations = computed(() => {
  const byScope = new Map<
    string,
    { label: string; statement: LimitStatement; conflict: boolean }
  >();
  for (const { statements } of props.groups)
    for (const statement of statements) {
      const { applicability, kind, measurement, quantity } = statement;
      if ((!applicability && !statement.account_tier) || kind === "default") continue;
      const context = quantity === "context_tokens";
      if (context !== (props.field === "context_tokens")) continue;
      if (context ? measurement !== "shared_context" : measurement !== "per_response") continue;

      const key = JSON.stringify([quantity, limitScopeKey(statement)]);
      const row = byScope.get(key);
      if (row) {
        row.conflict ||= limitStatementsConflict(row.statement, statement);
        continue;
      }
      const { endpoint, beta_header: beta } = applicability ?? {};
      const name = [
        statement.account_tier,
        props.endpoints.find(({ path }) => path === endpoint)?.name ?? endpoint,
      ]
        .filter(Boolean)
        .join(" · ");
      const mode = beta === undefined ? "" : beta.present ? " (beta)" : " (standard)";
      byScope.set(key, {
        label: name + mode,
        statement,
        conflict: false,
      });
    }

  return [...byScope].flatMap(([key, { label, statement, conflict }]) => {
    if (
      !conflict &&
      statement.kind === "maximum" &&
      !statement.account_tier &&
      statement.quantity === props.field &&
      statement.tokens === props.summary
    )
      return [];
    return [{ key, label, value: conflict ? "Sources disagree" : annotationValue(statement) }];
  });
});

function annotationValue(statement: LimitStatement): string {
  if (statement.kind === "published_maximum_label") return statement.label;
  const textOnly = statement.quantity === "text_output_tokens";
  if (statement.kind === "no_separate_cap") {
    if (statement.quantity === "context_tokens") return "No separate context cap";
    return textOnly ? "No separate text output cap" : "No separate output cap";
  }
  const amount = formatTokenCount(statement.tokens);
  if (statement.quantity === "context_tokens") return amount + " shared budget";
  return amount + (textOnly ? " text tokens per response" : " per response");
}
</script>

<template>
  <ul v-if="annotations.length" class="limit-annotations" role="list">
    <li v-for="{ key, label, value } in annotations" :key="key">{{ label }} · {{ value }}</li>
  </ul>
</template>

<style scoped>
.limit-annotations {
  display: grid;
  gap: var(--space-1);
  margin: var(--space-1) 0 0;
  padding: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
  list-style: none;
}
</style>
