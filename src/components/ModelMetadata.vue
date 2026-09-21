<script setup lang="ts" vapor>
import { computed, ref, watch } from "vue";
import type { WebsiteModelDetail } from "../catalog/website-schema.ts";
import { formatSentenceCase } from "../catalog/presentation.ts";
import UiIcon from "./UiIcon.vue";
import UiSelect from "./UiSelect.vue";

const props = defineProps<{ detail: WebsiteModelDetail }>();
const selected = ref("");
watch(
  () => props.detail.model_ref,
  () => {
    selected.value = "";
  },
);
const cardFacts = computed(() => {
  const card = props.detail.model_card;
  if (card === undefined) return [];
  return [
    ["Publisher", card.publisher],
    ["License", card.license],
    ["Model size", card.size],
    ["Published context range", card.context_window],
    ["Languages", card.languages?.join(", ")],
    ["Upstream model", card.upstream_id],
    ["Model access", card.access],
    ["Framework", card.framework],
  ].flatMap(([label, value]) => (label && value ? [{ label, value }] : []));
});
const profiles = computed(() => props.detail.deployment?.profiles ?? []);
const options = computed(() =>
  profiles.value
    .filter((profile) => profile.name !== "default")
    .map((profile) => ({ value: profile.name, label: formatSentenceCase(profile.name) })),
);
const profile = computed(() =>
  profiles.value.find((profile) => profile.name === (selected.value || "default")),
);
</script>

<template>
  <section v-if="cardFacts.length" class="detail-section" aria-labelledby="model-card-heading">
    <h3 id="model-card-heading">Model information</h3>
    <dl class="fact-grid">
      <div v-for="fact in cardFacts" :key="fact.label">
        <dt>{{ fact.label }}</dt>
        <dd>{{ fact.value }}</dd>
      </div>
    </dl>
  </section>
  <details v-if="detail.deployment && profiles.length" class="detail-section detail-disclosure">
    <summary>
      <span>Deployment configurations</span>
      <small>{{ profiles.length }} {{ profiles.length === 1 ? "profile" : "profiles" }}</small>
      <UiIcon name="chevron-right" />
    </summary>
    <div class="detail-disclosure-body deployment-body">
      <dl class="fact-grid">
        <div>
          <dt>JumpStart package</dt>
          <dd>{{ detail.deployment.package_version ?? "Not published" }}</dd>
        </div>
        <div>
          <dt>Configuration region</dt>
          <dd>{{ detail.deployment.region }}</dd>
        </div>
      </dl>
      <div v-if="options.length" class="deployment-selector">
        <label for="deployment-profile">Profile</label>
        <UiSelect
          id="deployment-profile"
          v-model="selected"
          :options="options"
          placeholder="Default"
        />
      </div>
      <template v-if="profile">
        <dl class="fact-grid">
          <div>
            <dt>Default instance</dt>
            <dd>{{ profile.default_instance_type ?? "Not published" }}</dd>
          </div>
          <div>
            <dt>Serving framework</dt>
            <dd>
              {{
                [profile.framework, profile.framework_version].filter(Boolean).join(" · ") ||
                "Not published"
              }}
            </dd>
          </div>
        </dl>
        <dl class="availability-list">
          <div v-if="profile.configurations.length">
            <dt>Used by configurations</dt>
            <dd>{{ profile.configurations.join(", ") }}</dd>
          </div>
          <div>
            <dt>Supported instances</dt>
            <dd>{{ profile.instance_types.join(", ") || "Not published" }}</dd>
          </div>
        </dl>
        <details v-if="profile.context_settings.length" class="detail-disclosure">
          <summary>
            <span>Context settings</span><small>{{ profile.context_settings.length }}</small
            ><UiIcon name="chevron-right" />
          </summary>
          <dl class="availability-list detail-disclosure-body">
            <div
              v-for="setting in profile.context_settings"
              :key="`${setting.instance_type ?? ''}:${setting.name}`"
            >
              <dt>
                <code>{{ setting.name }}</code> · {{ setting.instance_type ?? "Profile default" }}
              </dt>
              <dd>{{ setting.value }}</dd>
            </div>
          </dl>
        </details>
      </template>
      <p class="unknown-note">
        Published package configurations, not a model release version or a guarantee of account
        access or instance capacity. Context settings depend on the profile and instance; they are
        not a universal model limit.
      </p>
    </div>
  </details>
</template>

<style scoped>
.deployment-body {
  display: grid;
  gap: var(--space-3);
}
.deployment-selector {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: var(--space-3);
  min-height: var(--control-height-comfortable);
  padding: var(--space-1) var(--space-2-5);
  border: var(--stroke-hairline) solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
}
.deployment-selector label {
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
}
</style>
