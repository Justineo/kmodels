import type { SourceManifest } from "./manifests.ts";
import type { ParsedProviderModel as ProviderModel, SourcePricingFacts } from "./pricing-source.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type { Provider } from "./schema.ts";
import type { SourceContractEvidence } from "./source-contract.ts";

export interface SourceParseResult extends SourcePricingFacts {
  models: ProviderModel[];
}

export interface SourceParseInput {
  provider: Provider;
  source: SourceManifest;
  body: string;
  observedAt: string;
  catalogModels?: readonly (Pick<
    ProviderModel,
    | "aliases"
    | "api_endpoints"
    | "availability"
    | "capabilities"
    | "model_id"
    | "name"
    | "release_date"
    | "routes"
    | "service_families"
    | "status"
    | "tasks"
    | "uid"
    | "version"
  > &
    Partial<Pick<ProviderModel, "price_facts" | "pricing_state">>)[];
  onContractFinding?: (evidence: SourceContractEvidence) => void;
  onPricingReconciliation?: (item: PricingReconciliationItem) => void;
  // A mixed source may retain valid catalog facts while its commercial partition must fail.
  onPricingDependencyFailure?: (url: string) => void;
}
