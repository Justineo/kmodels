const auditFields = new Set([
  "atom_contract_hash",
  "charge_binding",
  "charge_bindings",
  "content_hash",
  "relation_observations",
  "core_catalog_version",
  "core_data_sha256",
  "core_generated_at",
  "delivery_mode_evidence",
  "derivation",
  "document_url",
  "evidence",
  "evidence_urls",
  "excerpt",
  "fact_inventory_hash",
  "locator",
  "observations",
  "pricing_version",
  "raw",
  "raw_type",
  "scope_observations",
  "source_ref",
  "source_refs",
  "task_evidence",
  "term_key",
]);

export function foundAuditFields(value: unknown): string[] {
  const found = new Set<string>();
  function visit(current: unknown) {
    if (current === null || typeof current !== "object") return;
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    for (const [field, item] of Object.entries(current)) {
      if (auditFields.has(field)) found.add(field);
      visit(item);
    }
  }
  visit(value);
  return [...found].sort();
}
