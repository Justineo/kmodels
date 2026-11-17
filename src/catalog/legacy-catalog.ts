import type { Catalog } from "./schema.ts";

/** Preserve the existing public audit core independently of internal detail storage. */
export function legacyCatalog(catalog: Catalog): Catalog {
  if (catalog.models.every((model) => model.limit_details === undefined)) return catalog;
  return {
    ...catalog,
    models: catalog.models.map((model) => {
      if (model.limit_details === undefined) return model;
      const { limit_details: _details, ...legacy } = model;
      return legacy;
    }),
  };
}
