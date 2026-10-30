<script setup lang="ts" vapor>
import { computed, ref, watch } from "vue";
import {
  configureInvocation,
  invocationScopeFields,
  type InvocationContext,
  type InvocationResourceBinding,
  type ResourceRequirement,
} from "../catalog/invocation-configuration.ts";
import { formatCount, formatSentenceCase, formatSnakeCase } from "../catalog/presentation.ts";
import type {
  InvocationCase,
  InvocationFact,
  InvocationScope,
} from "../catalog/invocation-schema.ts";
import {
  selectWebsiteInvocation,
  type WebsiteInvocationSelection,
} from "../catalog/website-invocation-context.ts";
import type { WebsiteInvocationDetail, WebsiteModel } from "../catalog/website-schema.ts";
import UiSelect from "./UiSelect.vue";

const props = defineProps<{ model: WebsiteModel; detail: WebsiteInvocationDetail }>();
const emit = defineEmits<{ select: [value: WebsiteInvocationSelection | undefined] }>();
const targetRef = ref("");
const caseRef = ref("");
const inputs = ref<Record<string, string>>({});
const context = ref<InvocationContext>({});
const resource = ref<InvocationResourceBinding>();
const allowPreview = ref(false);
const allowLegacy = ref(false);
const notice = ref("");
const copyNotice = ref("");
const target = computed(() =>
  props.detail.graph.invocation_targets.find(({ id }) => id === targetRef.value),
);
const entry = computed(() => target.value?.cases.find(({ id }) => id === caseRef.value));
const surface = computed(() =>
  props.detail.graph.surfaces.find(({ id }) => id === target.value?.surface_ref),
);
const coverage = computed(() =>
  props.detail.graph.target_coverage.map((value) => ({
    ...value,
    api: props.detail.graph.surfaces.find(({ id }) => id === value.surface_ref)?.api,
  })),
);
const selection = computed(() =>
  selectWebsiteInvocation(
    props.detail,
    props.model,
    targetRef.value,
    caseRef.value,
    {
      inputs: inputs.value,
      context: context.value,
      ...(resource.value === undefined ? {} : { resource_binding: resource.value }),
    },
    {
      allowed_lifecycles: allowLegacy.value ? ["active", "legacy", "deprecated"] : ["active"],
      allowed_release_stages: allowPreview.value
        ? ["stable", "preview", "experimental"]
        : ["stable"],
    },
  ),
);
const assessment = computed(() => selection.value?.assessment);
const scopeLabels = {
  request_region: "Source region",
  inference_mode: "Inference mode",
  inference_geo: "Execution geography",
  deployment_type: "Deployment type",
};
function scopeLabel(scope: InvocationScope): string {
  return scope.kind === "exact"
    ? scope.value
    : scope.kind === "any"
      ? "Any documented value"
      : scope.kind === "unknown"
        ? "Unknown"
        : "Not applicable";
}
function factValue(value: InvocationFact["value"]): string {
  if (typeof value === "boolean") return value ? "Supported" : "Not supported";
  if (typeof value === "number") return formatCount(value);
  if (Array.isArray(value)) return value.map(formatCount).join(", ");
  return `${formatCount(value.min)}–${formatCount(value.max)}`;
}
function caseLabel(value: InvocationCase): string {
  return [
    formatSnakeCase(value.task),
    ...invocationScopeFields.flatMap((field) =>
      value[field].kind === "not_applicable"
        ? []
        : [`${scopeLabels[field]}: ${scopeLabel(value[field])}`],
    ),
    formatSnakeCase(value.support.state),
  ].join(" · ");
}
const targetOptions = computed(() =>
  props.detail.graph.invocation_targets.map((value) => {
    const wire = props.detail.graph.surfaces.find(({ id }) => id === value.surface_ref);
    return {
      value: value.id,
      label: [
        value.address.kind === "literal"
          ? value.address.value
          : `Caller-supplied ${value.address_role}`,
        wire?.api ?? value.surface_ref,
        wire?.origin_template,
        wire?.request_media_type,
        value.lifecycle,
      ]
        .filter((part) => part !== undefined)
        .join(" · "),
    };
  }),
);
const inputNames = computed(() => {
  const value = target.value;
  if (value === undefined) return [];
  return [
    ...new Set([
      ...(surface.value?.inputs
        .filter(({ role }) => role !== "region" || entry.value?.request_region.kind !== "exact")
        .map(({ name }) => name) ?? []),
      ...[value.address, ...value.selectors.map(({ value }) => value)].flatMap((address) =>
        address.kind === "caller" ? [address.input] : [],
      ),
    ]),
  ];
});
const requirements = computed(() => {
  const result = new Set<ResourceRequirement>();
  for (const { kind } of entry.value?.requirements ?? [])
    if (
      kind === "deployment_binding" ||
      kind === "installation" ||
      kind === "runtime_compatibility"
    )
      result.add(kind);
  if (target.value?.address_role === "deployment" || target.value?.address_role === "endpoint")
    result.add("deployment_binding");
  return [...result];
});
const requestId = computed(() =>
  target.value?.address.kind === "literal"
    ? target.value.address.value
    : inputs.value[target.value?.address.input ?? ""],
);
const evidence = computed(() => {
  const refs = new Set([
    ...(assessment.value?.resolution.evidence_refs ?? []),
    ...(assessment.value?.facts.flatMap(({ evidence_refs }) => evidence_refs) ?? []),
  ]);
  return props.detail.graph.invocation_evidence.filter(({ id }) => refs.has(id));
});
watch(selection, (value) => emit("select", value), { immediate: true, flush: "sync" });
watch(
  () => props.detail,
  () => {
    targetRef.value = "";
    caseRef.value = "";
    reset();
  },
);
function reset() {
  inputs.value = {};
  context.value = {};
  resource.value = undefined;
  copyNotice.value = "";
  notice.value = "Previous request and price conditions were cleared.";
}
function chooseTarget(value: string) {
  targetRef.value = value;
  caseRef.value = "";
  reset();
}
function chooseCase(value: string) {
  caseRef.value = value;
  reset();
}
function setInput(name: string, event: Event) {
  if (!(event.target instanceof HTMLInputElement)) return;
  resource.value = undefined;
  inputs.value = { ...inputs.value, [name]: event.target.value };
}
function setScope(field: (typeof invocationScopeFields)[number], event: Event) {
  if (!(event.target instanceof HTMLInputElement)) return;
  resource.value = undefined;
  const next = { ...context.value };
  if (event.target.value) next[field] = event.target.value;
  else delete next[field];
  context.value = next;
}
function confirmResource(event: Event) {
  const value = selection.value;
  if (!(event.target instanceof HTMLInputElement) || !event.target.checked || value === undefined) {
    resource.value = undefined;
    return;
  }
  const configured = configureInvocation(value.target, value.entry, value.surface, value.query);
  resource.value = {
    target_ref: value.target.id,
    case_ref: value.entry.id,
    model_ref: value.target.resolved_model_ref ?? value.target.model_ref,
    inputs: configured.inputs,
    context: configured.context,
    confirmed_requirements: requirements.value,
  };
}
async function copy(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value);
    copyNotice.value = `${label} copied.`;
  } catch {
    copyNotice.value = `Could not copy ${label.toLowerCase()}.`;
  }
}
</script>

<template>
  <section class="detail-section invocation-section" aria-labelledby="invocation-heading">
    <h3 id="invocation-heading">Invocation</h3>
    <p v-for="item in coverage" :key="item.surface_ref ?? item.model_ref" class="unknown-note">
      Collection coverage<template v-if="item.api"> ({{ item.api }})</template>:
      {{ formatSnakeCase(item.state)
      }}<template v-if="item.reason"> · {{ formatSnakeCase(item.reason) }}</template
      >.
    </p>
    <p v-if="coverage.some(({ state }) => state !== 'complete')" class="unknown-note">
      Missing options do not establish lack of provider support.
    </p>
    <p v-if="targetOptions.length === 0" class="unknown-note">
      Invocation options have not been established for this model.
    </p>
    <template v-else>
      <div class="invocation-fields">
        <div>
          <label for="invocation-target">Inspect target</label
          ><UiSelect
            id="invocation-target"
            :model-value="targetRef"
            :options="targetOptions"
            placeholder="Choose a target and API"
            @update:model-value="chooseTarget"
          />
        </div>
        <div v-if="target">
          <label for="invocation-case">Task and documented scope</label
          ><UiSelect
            id="invocation-case"
            :model-value="caseRef"
            :options="target.cases.map((value) => ({ value: value.id, label: caseLabel(value) }))"
            placeholder="Choose a documented case"
            @update:model-value="chooseCase"
          />
        </div>
      </div>
      <p v-if="notice" class="unknown-note" role="status">{{ notice }}</p>
      <template v-if="target && surface">
        <dl class="fact-grid">
          <div>
            <dt>API</dt>
            <dd>{{ surface.api }}</dd>
          </div>
          <div v-if="surface.request_media_type">
            <dt>Request format</dt>
            <dd>{{ surface.request_media_type }}</dd>
          </div>
          <div>
            <dt>Lifecycle</dt>
            <dd>{{ target.lifecycle }} · {{ target.release_stage }}</dd>
          </div>
          <div>
            <dt>Address role</dt>
            <dd>{{ formatSnakeCase(target.address_role) }}</dd>
          </div>
          <div>
            <dt>Resolution</dt>
            <dd>
              {{ formatSnakeCase(target.resolution)
              }}<template v-if="target.resolved_model_ref">
                · {{ target.resolved_model_ref }}</template
              >
            </dd>
          </div>
        </dl>
        <p class="endpoint">
          <code>{{ surface.method }} {{ surface.origin_template }}{{ surface.path_template }}</code>
        </p>
      </template>
      <template v-if="entry && selection">
        <dl class="fact-grid">
          <div v-for="field in invocationScopeFields" :key="field">
            <dt>{{ scopeLabels[field] }}</dt>
            <dd>{{ scopeLabel(entry[field]) }}</dd>
          </div>
        </dl>
        <div class="invocation-fields">
          <template v-for="field in invocationScopeFields" :key="field"
            ><div
              v-if="
                entry[field].kind === 'any' &&
                !(
                  field === 'request_region' &&
                  surface?.inputs.some(({ role }) => role === 'region')
                )
              "
            >
              <label :for="`scope-${field}`">{{ scopeLabels[field] }} (optional restriction)</label
              ><input
                :id="`scope-${field}`"
                :value="context[field] ?? ''"
                autocomplete="off"
                @input="setScope(field, $event)"
              /></div
          ></template>
          <div v-for="name in inputNames" :key="name">
            <label :for="`invocation-input-${name}`">{{ formatSnakeCase(name) }}</label
            ><input
              :id="`invocation-input-${name}`"
              :value="inputs[name] ?? ''"
              autocomplete="off"
              spellcheck="false"
              @input="setInput(name, $event)"
            />
          </div>
        </div>
        <label v-if="requirements.length" class="confirmation"
          ><input type="checkbox" :checked="resource !== undefined" @change="confirmResource" />I
          confirm this exact resource and model meet:
          {{ requirements.map((kind) => formatSnakeCase(kind)).join(", ") }}.</label
        >
        <div class="policy-options">
          <label
            ><input v-model="allowPreview" type="checkbox" />Allow preview or experimental
            targets</label
          ><label
            ><input v-model="allowLegacy" type="checkbox" />Allow legacy or deprecated
            targets</label
          >
        </div>
        <dl v-if="assessment" class="fact-grid">
          <div>
            <dt>Documentation</dt>
            <dd>{{ formatSnakeCase(assessment.resolution.documented_support) }}</dd>
          </div>
          <div>
            <dt>Scope match</dt>
            <dd>{{ formatSnakeCase(assessment.resolution.context_match) }}</dd>
          </div>
          <div>
            <dt>Configuration</dt>
            <dd>{{ formatSnakeCase(assessment.resolution.configuration) }}</dd>
          </div>
          <div>
            <dt>Selection policy</dt>
            <dd>{{ formatSnakeCase(assessment.eligibility) }}</dd>
          </div>
        </dl>
        <p class="unknown-note">Account access: unverified. Request verification: not tested.</p>
        <p v-if="assessment?.resolution.missing_inputs.length" class="unknown-note">
          Required:
          {{
            assessment.resolution.missing_inputs.map((name) => formatSnakeCase(name)).join(", ")
          }}.
        </p>
        <p v-if="entry.requirements.length" class="unknown-note">
          Provider requirements:
          {{ entry.requirements.map(({ kind }) => formatSnakeCase(kind)).join(", ") }}.
        </p>
        <div v-if="requestId" class="request-identifier">
          <span>{{
            assessment?.resolution.documented_support === "supported"
              ? "Request ID"
              : "Documented identifier"
          }}</span
          ><code>{{ requestId }}</code
          ><button
            v-if="assessment?.resolution.documented_support === 'supported'"
            type="button"
            @click="copy(requestId, 'Request ID')"
          >
            Copy request ID
          </button>
        </div>
        <details v-if="assessment?.request">
          <summary>Request addressing template</summary>
          <pre>{{ JSON.stringify(assessment.request, null, 2) }}</pre>
          <p v-if="surface?.request_media_type === 'multipart/form-data'" class="unknown-note">
            Send form fields with your file payload. Let the HTTP client generate the multipart
            boundary.
          </p>
          <button
            type="button"
            @click="copy(JSON.stringify(assessment.request, null, 2), 'Request template')"
          >
            Copy template
          </button>
          <p class="unknown-note">
            Add your task payload and authentication. This template has not been sent or tested.
          </p>
        </details>
        <p v-else class="unknown-note">
          A request template requires supported, known scope and complete, eligible configuration.
        </p>
        <h4>Facts for this case</h4>
        <dl v-if="assessment?.facts.length" class="fact-grid">
          <div v-for="fact in assessment.facts" :key="fact.field">
            <dt>{{ formatSentenceCase(fact.field.replace(/^[^.]+\./, "")) }}</dt>
            <dd>
              {{ fact.state === "conflicting" ? "Conflicting: " : ""
              }}{{ fact.values.map((value) => factValue(value)).join(" / ") }}
            </dd>
          </div>
        </dl>
        <p v-else class="unknown-note">No scoped capability or limit facts published.</p>
        <details v-if="evidence.length">
          <summary>Source evidence ({{ evidence.length }})</summary>
          <ul>
            <li v-for="item in evidence" :key="item.id">
              <a :href="item.document_url" target="_blank" rel="noopener noreferrer">{{
                formatSnakeCase(item.basis)
              }}</a>
              · {{ item.locator }} · observed {{ item.observed_at }}
            </li>
          </ul>
        </details>
      </template>
    </template>
    <p class="visually-hidden" aria-live="polite">{{ copyNotice }}</p>
  </section>
</template>

<style scoped>
.invocation-section {
  display: grid;
  gap: var(--space-3);
}
.invocation-fields {
  display: grid;
  gap: var(--space-3);
}
.invocation-fields > div {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}
.invocation-fields label,
.policy-options,
.confirmation {
  font-size: var(--font-size-meta);
}
.invocation-fields :deep(.ui-select-control),
.invocation-fields input {
  padding: var(--space-2);
  border: var(--stroke-hairline) solid var(--color-border-default);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text-primary);
  font: inherit;
  min-width: 0;
}
.invocation-fields :deep(.ui-select-control:has(:focus-visible)),
.invocation-fields input:focus-visible {
  outline: var(--stroke-focus) solid var(--color-accent);
}
.policy-options {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}
.policy-options label,
.confirmation {
  display: flex;
  align-items: baseline;
  gap: var(--space-1);
}
.request-identifier {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.endpoint,
pre,
li,
dd,
code {
  overflow-wrap: anywhere;
}
pre {
  white-space: pre-wrap;
  font-size: var(--font-size-meta);
}
ul {
  padding-inline-start: var(--space-4);
  font-size: var(--font-size-meta);
}
h4,
p {
  margin: 0;
}
button {
  font: inherit;
}
</style>
