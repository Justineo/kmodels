import { assertIJsonValue, canonicalJson } from "../../catalog/canonical-value.ts";
import { validateInvocationCatalog } from "../../catalog/invocation-validation.ts";
import { validateInvocationPricing } from "../../catalog/invocation-pricing-validation.ts";
import { PricingError } from "../errors.ts";
import {
  invocationOfferSelectorSources,
  invocationOfferSelectorContracts,
  invocationSelectorContract,
} from "../../catalog/invocation-price-inputs.ts";
import type { CalculationEnvelope } from "../schema.ts";
import { validatePriceData as validateLegacyPriceData } from "../validation.ts";
import {
  calculationSchemaVersion,
  calculationV2EnvelopeSchema,
  type CalculationV2Envelope,
} from "./schema.ts";

/** Internal evaluator input. It is not a public compatibility export. */
export function evaluatorEnvelope(data: CalculationV2Envelope): CalculationEnvelope {
  return {
    schemaVersion: "1.0",
    snapshot: {
      pricingDataVersion: data.snapshot.pricingDataVersion,
      coreCatalogVersion: data.snapshot.coreCatalogVersion,
      generatedAt: data.snapshot.generatedAt,
    },
    providers: data.providers.map(
      ({
        invocation: _invocation,
        invocation_sources: _sources,
        invocation_bindings: _bindings,
        ...provider
      }) => provider,
    ),
  };
}

/** Web Crypto keeps initialization portable without a Node dependency or network access. */
export async function validatePriceData(input: unknown): Promise<CalculationV2Envelope> {
  if (
    typeof input === "object" &&
    input !== null &&
    "schemaVersion" in input &&
    input.schemaVersion !== calculationSchemaVersion
  )
    throw new PricingError("UNSUPPORTED_SCHEMA", "Supported calculation schema: 2.0");
  try {
    assertIJsonValue(input);
    const data = calculationV2EnvelopeSchema.parse(input);
    if (data.snapshot.coreCatalogVersion !== data.snapshot.coreDataSha256)
      throw new Error("V2 calculation metadata has inconsistent catalog hashes");
    validateLegacyPriceData(evaluatorEnvelope(data));
    for (const provider of data.providers) {
      const providerId = provider.snapshot.provider_id;
      const owners = {
        providers: [{ id: providerId }],
        models: provider.models.map(({ model_ref }) => ({
          uid: model_ref,
          provider_id: providerId,
        })),
        sources: provider.invocation_sources,
      };
      if (
        new Set(provider.invocation_sources.map(({ id }) => id)).size !==
          provider.invocation_sources.length ||
        provider.invocation_sources.some(({ provider_id }) => provider_id !== providerId)
      )
        throw new Error("Invocation source partition has duplicate or foreign sources");
      validateInvocationCatalog(provider.invocation, owners);
      const sourceRefs = new Map<string, string>();
      if (
        provider.invocation_bindings.some((binding) =>
          binding.selectors.some(({ value }) => value.kind === "observed"),
        )
      ) {
        for (const book of provider.books)
          for (const offer of book.offers)
            for (const source of [
              ...invocationOfferSelectorSources(offer),
              ...invocationOfferSelectorContracts(offer),
            ]) {
              const key = canonicalJson({
                offer_ref: offer.id,
                contract: invocationSelectorContract(source),
              });
              if (!sourceRefs.has(key)) {
                const bytes = new TextEncoder().encode(key);
                const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
                sourceRefs.set(
                  key,
                  `selector:${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
                );
              }
            }
      }
      validateInvocationPricing(
        provider.invocation,
        owners,
        provider.books,
        [provider.vocabulary],
        provider.invocation_bindings,
        (offerRef, source) =>
          sourceRefs.get(
            canonicalJson({ offer_ref: offerRef, contract: invocationSelectorContract(source) }),
          ) ?? "",
      );
    }
    return data;
  } catch (error) {
    throw new PricingError(
      "INVALID_DATA",
      error instanceof Error ? error.message : "Invalid v2 price data",
    );
  }
}
