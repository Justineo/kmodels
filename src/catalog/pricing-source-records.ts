import { canonicalValuesEqual } from "./canonical-value.ts";
import type { ProviderPricingPartition } from "./pricing-assembly.ts";
import { pricingSourceRecordSchema, type PricingSourceRecord } from "./pricing-schema.ts";
import { providerPartitionSourceRefs } from "./pricing-transition.ts";
import type { SourceRecord } from "./schema.ts";

export function capturePricingSourceRecords(
  partition: ProviderPricingPartition,
  sources: readonly SourceRecord[],
): ProviderPricingPartition {
  if (partition.snapshot.publication !== "fresh")
    throw new Error("Only a fresh price snapshot can capture source revisions");
  const byId = new Map(sources.map((source) => [source.id, source]));
  const source_records = providerPartitionSourceRefs(partition).map((id) => {
    const source = byId.get(id);
    if (source === undefined || source.provider_id !== partition.snapshot.provider_id)
      throw new Error(`Pricing source ${id} is missing or belongs to another provider`);
    if (source.observed_at !== partition.snapshot.observed_at)
      throw new Error(`Pricing source ${id} was not observed with the fresh price snapshot`);
    return sourceRecord(source);
  });
  return { ...partition, snapshot: { ...partition.snapshot, source_records } };
}

export function validatePricingSourceRecords(
  partition: ProviderPricingPartition,
  sources: ReadonlyMap<string, SourceRecord>,
): void {
  const { snapshot } = partition;
  if (snapshot.source_records === undefined) return;
  const required = providerPartitionSourceRefs(partition);
  if (
    snapshot.source_records.length !== required.length ||
    snapshot.source_records.some(({ id }, index) => id !== required[index])
  )
    throw new Error("Pricing source revisions must exactly cover sorted unique evidence sources");
  for (const record of snapshot.source_records) {
    const current = sources.get(record.id);
    if (current === undefined || current.provider_id !== snapshot.provider_id)
      throw new Error(`Pricing source ${record.id} is missing or belongs to another provider`);
    if (
      record.observed_at !== snapshot.observed_at ||
      Date.parse(current.observed_at) < Date.parse(record.observed_at)
    )
      throw new Error(`Pricing source ${record.id} does not match the price observation time`);
    if (
      current.observed_at === record.observed_at &&
      !canonicalValuesEqual(record, sourceRecord(current))
    )
      throw new Error(`Pricing source ${record.id} disagrees with the same catalog observation`);
  }
}

export function snapshotSourceRecords(
  partition: ProviderPricingPartition,
  catalogSources: readonly SourceRecord[],
): PricingSourceRecord[] {
  const { snapshot } = partition;
  // Legacy data has no captured revisions. An actual catalog record from that
  // same observation can still establish metadata; a later record cannot.
  const records =
    snapshot.source_records ??
    catalogSources
      .filter(
        (source) =>
          source.provider_id === snapshot.provider_id &&
          source.observed_at === snapshot.observed_at,
      )
      .map(sourceRecord);
  const byId = new Map(records.map((record) => [record.id, record]));
  return providerPartitionSourceRefs(partition).map((id) => {
    const record = byId.get(id);
    if (record === undefined) throw new Error(`Missing historical price source revision: ${id}`);
    return record;
  });
}

function sourceRecord({
  id,
  url,
  observed_at,
  content_hash,
  extractor_version,
}: SourceRecord): PricingSourceRecord {
  return pricingSourceRecordSchema.parse({ id, url, observed_at, content_hash, extractor_version });
}
