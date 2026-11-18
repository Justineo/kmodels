import { modelClaimFields } from "../src/catalog/model-claim-details.ts";

const auditFields = new Set([
  "atom_contract_hash",
  "charge_binding",
  "charge_bindings",
  "relation_observations",
  "core_catalog_version",
  "core_data_sha256",
  "core_generated_at",
  "delivery_mode_evidence",
  "derivation",
  "fact_inventory_hash",
  "locator",
  "observations",
  "pricing_version",
  "raw",
  "raw_type",
  "scope_observations",
  "source_refs",
  "task_evidence",
  "term_key",
]);

function isModelClaimEvidence(path: readonly (string | number)[]): boolean {
  const [model, field, claim, evidence, revision] = path;
  return (
    path.length === 5 &&
    typeof model === "number" &&
    modelClaimFields.some((claimField) => claimField === field) &&
    typeof claim === "number" &&
    evidence === "evidence" &&
    typeof revision === "number"
  );
}

export function foundAuditFields(value: unknown, scope?: "model-details"): string[] {
  const found = new Set<string>();
  const path: (number | string)[] = [];
  function visit(current: unknown) {
    if (current === null || typeof current !== "object") return;
    if (Array.isArray(current)) {
      for (const [index, item] of current.entries()) {
        path.push(index);
        visit(item);
        path.pop();
      }
      return;
    }
    for (const [field, item] of Object.entries(current)) {
      if (
        field === "locator" &&
        typeof item === "string" &&
        scope === "model-details" &&
        isModelClaimEvidence(path)
      )
        continue;
      if (auditFields.has(field)) found.add(field);
      path.push(field);
      visit(item);
      path.pop();
    }
  }
  visit(value);
  return [...found].sort();
}
