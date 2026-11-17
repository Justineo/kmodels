<script setup lang="ts" vapor>
import { computed } from "vue";
import {
  capabilityStatementsConflict,
  type CapabilityDetailGroup,
} from "../catalog/model-capability-details.ts";
import ModelClaimEvidence from "./ModelClaimEvidence.vue";

const props = defineProps<{ groups: CapabilityDetailGroup[] }>();
const groups = computed(() => props.groups.filter(({ statements }) => statements.length > 0));
const hasConflict = computed(() => {
  const statements = groups.value.flatMap(({ statements }) => statements);
  return statements.some((left) =>
    statements.some((right) => capabilityStatementsConflict(left, right)),
  );
});
</script>

<template>
  <div v-if="groups.length" class="capability-details">
    <p v-if="hasConflict" class="unknown-note" role="status">
      Unresolved source conflict: capability statements for the same scope disagree.
    </p>
    <div
      v-for="group in groups"
      :key="`${group.source_ref}:${group.claim}`"
      class="capability-group"
    >
      <dl class="availability-list">
        <div v-for="(statement, index) in group.statements" :key="index">
          <template v-if="statement.kind === 'prompt_cache'">
            <dt>
              {{
                statement.mode === "implicit" ? "Implicit prompt cache" : "Explicit prompt cache"
              }}
            </dt>
            <dd>{{ statement.supported ? "Supported" : "Unsupported" }}</dd>
          </template>
          <template v-else>
            <dt>Reasoning effort</dt>
            <dd v-if="statement.supported_values">
              Documented levels: <code>{{ statement.supported_values.join(", ") }}</code>
            </dd>
            <dd v-if="statement.default_value">
              Default: <code>{{ statement.default_value }}</code>
            </dd>
            <dd v-if="statement.unsupported_values">
              Unsupported levels: <code>{{ statement.unsupported_values.join(", ") }}</code>
            </dd>
          </template>
          <dd class="capability-scope">{{ statement.scope }}</dd>
        </div>
      </dl>
      <ModelClaimEvidence :documents="group.evidence" />
    </div>
  </div>
</template>

<style scoped>
.capability-details,
.capability-group {
  display: grid;
  gap: var(--space-3);
  overflow-wrap: anywhere;
}
.capability-scope {
  grid-column: 1 / -1;
}
</style>
