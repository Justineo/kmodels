<script setup lang="ts" vapor>
import { computed } from "vue";
import type { ModelClaimSource } from "../catalog/model-claim-details.ts";
import {
  limitScopeKey,
  limitStatementsConflict,
  type LimitStatement,
  type WebsiteLimitDetailGroup,
} from "../catalog/model-limit-details.ts";
import { formatTokenCount } from "../catalog/presentation.ts";
import ModelClaimEvidence from "./ModelClaimEvidence.vue";

const props = defineProps<{
  groups: readonly WebsiteLimitDetailGroup[];
  field: "context_tokens" | "output_tokens";
  summary: number | undefined;
  endpoints: readonly { path: string; name: string }[];
}>();

const annotations = computed(() => {
  const byScope = new Map<
    string,
    { label: string; statement: LimitStatement; documents: ModelClaimSource[]; conflict: boolean }
  >();
  for (const { statements, evidence } of props.groups)
    for (const statement of statements) {
      const { applicability, kind, measurement, quantity } = statement;
      if (applicability === undefined || kind === "default") continue;
      const context = quantity === "context_tokens";
      if (context !== (props.field === "context_tokens")) continue;
      if (context ? measurement !== "shared_context" : measurement !== "per_response") continue;

      const key = JSON.stringify([quantity, limitScopeKey(statement)]);
      const row = byScope.get(key);
      if (row) {
        row.documents.push(...evidence);
        row.conflict ||= limitStatementsConflict(row.statement, statement);
        continue;
      }
      const { endpoint, beta_header: beta } = applicability;
      const name = props.endpoints.find(({ path }) => path === endpoint)?.name ?? endpoint;
      const mode = beta === undefined ? "" : beta.present ? " (beta)" : " (standard)";
      byScope.set(key, {
        label: name + mode,
        statement,
        documents: [...evidence],
        conflict: false,
      });
    }

  return [...byScope].flatMap(([key, { label, statement, documents, conflict }]) => {
    if (
      !conflict &&
      statement.kind === "maximum" &&
      statement.quantity === props.field &&
      statement.tokens === props.summary
    )
      return [];
    return [
      { key, label, value: conflict ? "Sources disagree" : annotationValue(statement), documents },
    ];
  });
});

function annotationValue(statement: LimitStatement): string {
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
    <li v-for="{ key, label, value, documents } in annotations" :key="key">
      <span>{{ label }} · {{ value }}</span>
      <ModelClaimEvidence :documents="documents" compact />
    </li>
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

.limit-annotations > li {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-1);
}
</style>
