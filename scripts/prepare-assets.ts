import { commitCatalogPair, readCatalogPairMirrors } from "../src/catalog/pricing-publication.ts";
import { readPublishedAssets } from "../src/catalog/published-assets.ts";

const pair = await readCatalogPairMirrors();
if (pair === undefined) throw new Error("No checked-out catalog pair is available");
await commitCatalogPair(pair);
const published = await readPublishedAssets();
if (published.exports.manifest.pair_id !== pair.pairId)
  throw new Error("Published assets do not match the checked-out catalog pair");

console.log(
  `Prepared ${published.ui.manifest.assets.length} UI assets and ${published.exports.manifest.assets.length} export assets for pair ${pair.pairId.slice(0, 12)}`,
);
