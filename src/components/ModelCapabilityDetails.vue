<script setup lang="ts" vapor>
import { computed } from "vue";
import {
  capabilityByStatement,
  capabilityStatementsConflict,
  type CapabilityStatement,
} from "../catalog/model-capability-details.ts";
import type { WebsiteModelDetail } from "../catalog/website-schema.ts";
import ModelClaimEvidence from "./ModelClaimEvidence.vue";
import UiIcon from "./UiIcon.vue";

const props = defineProps<{
  capabilities: WebsiteModelDetail["capabilities"];
  groups: NonNullable<WebsiteModelDetail["capability_details"]>;
}>();

const capabilityLabels = [
  ["reasoning", "Reasoning"],
  ["tool_call", "Tool calling"],
  ["structured_output", "Structured output"],
  ["prompt_cache", "Prompt caching"],
  ["fine_tuning", "Fine-tuning"],
  ["citations", "Citations"],
  ["code_execution", "Code execution"],
  ["context_management", "Context management"],
  ["computer_use", "Computer use"],
] as const satisfies ReadonlyArray<readonly [keyof WebsiteModelDetail["capabilities"], string]>;

function groupBehaviors(statements: CapabilityStatement[]) {
  const behaviors: { statement: CapabilityStatement; bindings: CapabilityStatement[] }[] = [];
  const effortByConclusion = new Map<string, CapabilityStatement[]>();
  for (const statement of statements) {
    const { applicability } = statement;
    if (statement.kind === "reasoning_effort" && applicability?.parameter !== undefined) {
      // A claim can back the same effort behavior on several documented request fields.
      const key = JSON.stringify([
        statement.supported_values,
        statement.default_value,
        statement.unsupported_values,
        applicability.condition,
      ]);
      const existing = effortByConclusion.get(key);
      if (existing !== undefined) {
        existing.push(statement);
        continue;
      }
      const bindings = [statement];
      effortByConclusion.set(key, bindings);
      behaviors.push({ statement, bindings });
    } else {
      behaviors.push({ statement, bindings: [statement] });
    }
  }
  return behaviors;
}

const rows = computed(() =>
  capabilityLabels.flatMap(([key, label]) => {
    const groups = props.groups.flatMap((group) => {
      const statements = group.statements.filter(({ kind }) => capabilityByStatement[kind] === key);
      if (statements.length === 0) return [];
      const api = statements[0]?.applicability?.interface;
      const sharedInterface =
        key === "prompt_cache" &&
        api !== undefined &&
        statements.every(({ applicability }) => applicability?.interface === api)
          ? api
          : undefined;
      return [{ ...group, statements, sharedInterface, behaviors: groupBehaviors(statements) }];
    });
    const state = props.capabilities[key];
    const effortControl = key === "reasoning" ? props.capabilities.effort_control : "unknown";
    if (state === "unknown" && effortControl === "unknown" && groups.length === 0) return [];
    const statements = groups.flatMap((group) => group.statements);
    const hasConflict = statements.some((left, index) =>
      statements.slice(index + 1).some((right) => capabilityStatementsConflict(left, right)),
    );
    const expandable = groups.length > 0;
    const qualifier =
      state === false
        ? expandable
          ? "Model-wide unsupported"
          : "Unsupported"
        : state === "unknown"
          ? groups.length && effortControl === "unknown"
            ? "API-specific"
            : "Model-wide status unknown"
          : undefined;
    return [{ key, label, groups, hasConflict, expandable, qualifier, effortControl }];
  }),
);
</script>

<template>
  <ul v-if="rows.length" class="capability-list" role="list">
    <li v-for="row in rows" :key="row.key">
      <details v-if="row.expandable" class="capability-disclosure">
        <summary class="capability-row">
          <UiIcon name="chevron-right" aria-hidden="true" />
          <span>{{ row.label }}</span>
          <small v-if="row.qualifier" class="capability-qualifier">{{ row.qualifier }}</small>
          <small v-if="row.hasConflict" class="capability-conflict"
            >Unresolved source conflict</small
          >
        </summary>
        <div class="capability-body">
          <p v-if="row.effortControl !== 'unknown'" class="capability-effort-control">
            <strong>Effort control</strong>
            {{ row.effortControl ? "Supported model-wide" : "Unsupported model-wide" }}
          </p>
          <p v-if="row.key === 'reasoning' && row.groups.length" class="capability-subheading">
            Effort
          </p>
          <div
            v-for="group in row.groups"
            :key="JSON.stringify([group.source_ref, group.claim])"
            class="capability-group"
          >
            <p v-if="group.sharedInterface" class="capability-interface">
              {{ group.sharedInterface }}
            </p>
            <div
              v-for="({ statement, bindings }, index) in group.behaviors"
              :key="index"
              class="capability-behavior"
            >
              <template v-if="statement.kind === 'prompt_cache'">
                <p>
                  <strong>{{
                    statement.mode === "implicit" ? "Automatic" : "Caller-defined"
                  }}</strong>
                  <span v-if="!statement.supported">Unsupported</span>
                  <span v-else-if="statement.mode === 'implicit'">
                    The API can reuse repeated prompt content automatically.
                  </span>
                  <span v-else>You can specify which prompt content to cache.</span>
                </p>
              </template>
              <dl v-else class="effort-values">
                <div v-if="statement.supported_values">
                  <dt>Documented levels</dt>
                  <dd>
                    <code>{{ statement.supported_values.join(", ") }}</code>
                  </dd>
                </div>
                <div v-if="statement.default_value">
                  <dt>Default</dt>
                  <dd>
                    <code>{{ statement.default_value }}</code>
                  </dd>
                </div>
                <div v-if="statement.unsupported_values">
                  <dt>Unsupported values</dt>
                  <dd>
                    <code>{{
                      statement.unsupported_values.map((value) => JSON.stringify(value)).join(", ")
                    }}</code>
                  </dd>
                </div>
              </dl>
              <ul
                v-if="
                  !group.sharedInterface ||
                  statement.applicability?.parameter ||
                  statement.applicability?.condition
                "
                class="capability-bindings"
                role="list"
              >
                <li v-for="({ applicability, scope }, binding) in bindings" :key="binding">
                  <template v-if="applicability">
                    <span v-if="!group.sharedInterface">{{ applicability.interface }}</span>
                    <code v-if="applicability.parameter">{{ applicability.parameter }}</code>
                    <span v-if="applicability.condition">{{ applicability.condition }}</span>
                  </template>
                  <span v-else>{{ scope }}</span>
                </li>
              </ul>
            </div>
            <ModelClaimEvidence :documents="group.evidence" />
          </div>
        </div>
      </details>
      <div v-else class="capability-row">
        <span>{{ row.label }}</span>
        <small v-if="row.qualifier" class="capability-qualifier">{{ row.qualifier }}</small>
        <small v-if="row.effortControl !== 'unknown'" class="capability-qualifier">
          Effort control {{ row.effortControl ? "supported" : "unsupported" }}
        </small>
      </div>
    </li>
  </ul>
  <p v-else class="capability-empty unknown-note">No capability information published.</p>
</template>

<style scoped>
.capability-list {
  margin-block-start: var(--space-3);
  padding: 0;
  list-style: none;
  overflow-wrap: anywhere;
}
.capability-list > li + li {
  border-block-start: var(--stroke-hairline) solid var(--color-border-subtle);
}
.capability-row {
  position: relative;
  display: flex;
  min-height: var(--control-height-default);
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--space-0-5) var(--space-2);
  padding-block: var(--space-1-5);
  padding-inline-start: calc(var(--icon-size-sm) + var(--space-2));
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-control);
}
summary.capability-row {
  border-radius: var(--radius-md);
  cursor: pointer;
  list-style: none;
}
summary.capability-row::-webkit-details-marker {
  display: none;
}
summary.capability-row:hover {
  background: var(--color-surface-hover);
}
.capability-row .ui-icon {
  position: absolute;
  inset-block-start: var(--space-2);
  inset-inline-start: var(--space-0-5);
  width: var(--icon-size-sm);
  height: var(--icon-size-sm);
  color: var(--color-text-muted);
}
.capability-disclosure[open] > summary .ui-icon {
  transform: rotate(90deg);
}
.capability-qualifier,
.capability-conflict {
  font-size: var(--font-size-meta);
}
.capability-qualifier {
  color: var(--color-text-secondary);
  font-weight: var(--font-weight-regular);
}
.capability-conflict {
  color: var(--color-text-secondary);
}
.capability-body {
  display: grid;
  gap: var(--space-3);
  padding-block: var(--space-1) var(--space-3);
  margin-inline-start: calc(var(--icon-size-sm) + var(--space-2));
  font-size: var(--font-size-body);
}
.capability-body p {
  margin: 0;
}
.capability-effort-control,
.capability-behavior > p,
.effort-values > div {
  display: flex;
  flex-wrap: wrap;
  column-gap: var(--space-2);
}
.capability-subheading,
.capability-interface,
.effort-values dt {
  font-weight: var(--font-weight-semibold);
}
.capability-group {
  display: grid;
  gap: var(--space-2-5);
  min-width: 0;
  padding: var(--space-3);
  border: var(--stroke-hairline) solid var(--color-border-subtle);
  border-radius: var(--list-surface-radius);
}
.capability-bindings {
  display: grid;
  gap: var(--space-1);
  margin-block-start: var(--space-1);
  padding: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-meta);
  list-style: none;
}
.capability-bindings li {
  display: flex;
  flex-wrap: wrap;
  column-gap: var(--space-2);
}
.effort-values,
.effort-values dd {
  margin: 0;
}
.capability-empty {
  margin-block-start: var(--space-3);
}
</style>
