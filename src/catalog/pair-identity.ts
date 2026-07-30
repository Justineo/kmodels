import { canonicalJson } from "./canonical-json.ts";
import { sha256 } from "./io.ts";

export interface CatalogPairIdentity {
  catalog_asset_sha256: string;
  pricing_asset_sha256: string;
}

export function catalogPairId(identity: CatalogPairIdentity): string {
  return sha256(
    canonicalJson({
      catalog_asset_sha256: identity.catalog_asset_sha256,
      pricing_asset_sha256: identity.pricing_asset_sha256,
    }),
  );
}
