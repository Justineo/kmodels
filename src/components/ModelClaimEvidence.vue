<script setup lang="ts" vapor>
import type { ModelDetailEvidence } from "../catalog/model-claim-details.ts";
import UiIcon from "./UiIcon.vue";

defineProps<{ documents: ModelDetailEvidence[] }>();
</script>

<template>
  <p
    v-for="evidence in documents"
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
    <div class="detail-disclosure-body claim-evidence">
      <dl
        v-for="evidence in documents"
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
</template>

<style scoped>
.claim-evidence {
  display: grid;
  gap: var(--space-3);
  overflow-wrap: anywhere;
}
</style>
