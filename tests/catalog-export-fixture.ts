import { catalogEnvelopeSchema, type Catalog } from "../src/catalog/schema.ts";

/** Read the public catalog/index.json wire format used by clients and independent probes. */
export function publicCatalog(source: string): Catalog {
  const { data, ...metadata } = catalogEnvelopeSchema.parse(JSON.parse(source));
  return { ...metadata, ...data };
}
