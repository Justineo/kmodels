import type { Catalog } from "./schema.ts";

/** Preserve the existing public audit core independently of internal detail storage. */
export function legacyCatalog(catalog: Catalog): Catalog {
  const hasPrivateDetails = (model: Catalog["models"][number]) =>
    model.limit_details !== undefined || model.capability_details !== undefined;
  if (!catalog.models.some(hasPrivateDetails)) return catalog;
  return {
    ...catalog,
    models: catalog.models.map((model) => {
      if (!hasPrivateDetails(model)) return model;
      const { limit_details: _limits, capability_details: _capabilities, ...legacy } = model;
      return legacy;
    }),
  };
}
