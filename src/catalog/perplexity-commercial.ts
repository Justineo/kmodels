import type { AtomicProviderPricing, AtomicRateVariant } from "./pricing-assembly.ts";
import {
  addAtom,
  bindRateTerm,
  isStandardUnit,
  rawEvidence,
} from "./pricing-commercial-assembly.ts";
import type { ChargeBinding, PriceMeter } from "./pricing-schema.ts";

export function applyPerplexityCommercialTopology(
  input: AtomicProviderPricing,
): AtomicProviderPricing {
  return {
    ...input,
    books: input.books.map((book) => ({
      ...book,
      offers: book.offers.map((offer) => ({
        ...offer,
        terms: offer.terms.map((term) =>
          bindRateTerm(term, (meter, variant) =>
            binding(
              input,
              book.scope.kind === "provider_resource" ? book.scope.resource_key : undefined,
              meter,
              variant,
            ),
          ),
        ),
      })),
    })),
  };
}

function binding(
  input: AtomicProviderPricing,
  resource: string | undefined,
  meter: PriceMeter,
  variant: AtomicRateVariant,
): ChargeBinding {
  const perRequest = isStandardUnit(variant.price.per, "request");
  const key =
    resource === "search"
      ? "successful_search_requests"
      : resource === "agent-sandbox"
        ? "sandbox_billing_sessions"
        : resource?.startsWith("agent-")
          ? `${resource.replaceAll("-", "_")}_invocations`
          : meter.value === "web_search"
            ? perRequest
              ? "sonar_billable_requests"
              : "deep_research_search_queries"
            : `${meter.value}_billable_tokens`;
  const definition =
    resource === "search"
      ? "Successful Search API requests; one multi-query request is one charge, including successful zero-result requests; failures are not billed"
      : resource === "agent-sandbox"
        ? "Agent API sandbox billing sessions, each covering up to 20 minutes of active use; the billing window is not a runtime cap"
        : meter.value === "output_text"
          ? "Sonar output tokens billed at the output rate, excluding separately billed citation and reasoning components"
          : meter.value === "citation_tokens"
            ? "Separately billed Sonar Deep Research citation tokens"
            : meter.value === "reasoning_tokens"
              ? "Separately billed Sonar Deep Research reasoning tokens"
              : resource?.startsWith("agent-")
                ? `Billable invocations of the Perplexity ${resource.slice(6)} tool`
                : meter.value === "web_search"
                  ? perRequest
                    ? "Sonar requests charged at the realized search type and context size"
                    : "Sonar Deep Research executed search queries"
                  : `Perplexity billable ${meter.value.replaceAll("_", " ")} tokens`;
  addAtom(input, {
    kind: "usage_signal",
    key,
    definition,
    unit: variant.price.per,
    resolution_phase: "outcome",
  });
  return {
    signal: { namespace: "provider", provider_id: input.provider_id, value: key },
    aggregation: resource === "agent-sandbox" ? "session" : "request",
    observations: [rawEvidence(variant.observation)],
  };
}
