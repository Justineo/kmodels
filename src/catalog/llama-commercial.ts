import type {
  AtomicPricingBook,
  AtomicPricingOffer,
  AtomicProviderPricing,
} from "./pricing-assembly.ts";
import { canonicalizeApplicability, unconditionalApplicability } from "./pricing-canonical.ts";
import { addAtom, offerEvidence, rawEvidence, relation } from "./pricing-commercial-assembly.ts";
import { pricingBookId, pricingOfferId } from "./pricing-identifiers.ts";
import type {
  NormalizedPriceObservation,
  PriceApplicability,
  PriceDimension,
  RawPriceObservation,
} from "./pricing-schema.ts";

type Resource = "artifact" | "grant" | "hosted" | "self_hosted";

interface ResourceOffer {
  book: AtomicPricingBook;
  offer: AtomicPricingOffer;
  ref: string;
}

const licenseDimension: PriceDimension = {
  namespace: "provider",
  provider_id: "llama",
  value: "license_class",
};

export function applyLlamaCommercialTopology(input: AtomicProviderPricing): AtomicProviderPricing {
  if (input.provider_id !== "llama") return input;
  registerLicenseVocabulary(input);
  const books = input.books.map((book) => ({
    ...book,
    offers: book.offers.map((offer) => migrateOffer(book, offer)),
  }));
  bindRelations(books);
  return { ...input, books };
}

function migrateOffer(book: AtomicPricingBook, offer: AtomicPricingOffer): AtomicPricingOffer {
  const resource = resourceType(book);
  if (resource === undefined) return offer;
  const applicability = resource === "grant" ? licenseApplicability("separate_grant") : undefined;
  const states = offer.states.map((state) => {
    const stateApplicability =
      resource === "artifact" && state.state === "free"
        ? licenseApplicability("community")
        : applicability;
    return stateApplicability === undefined
      ? state
      : {
          ...state,
          applicability: stateApplicability,
          observation: normalized(state.observation, stateApplicability),
        };
  });
  const enrollmentApplicability = applicability ?? unconditionalApplicability;
  const accountScoped = resource === "artifact" || resource === "grant" || resource === "hosted";
  return {
    ...offer,
    states,
    ...(accountScoped
      ? {
          enrollment: [
            {
              state: "account_scoped" as const,
              applicability: enrollmentApplicability,
              observations: [normalized(offerEvidence(offer), enrollmentApplicability)],
            },
          ],
        }
      : {}),
    settlement:
      resource === "self_hosted"
        ? [
            {
              channel: "operator" as const,
              biller: "Deployment operator",
              payment_sources: ["external_bill" as const],
              applicability: unconditionalApplicability,
              observations: [
                normalized(offerEvidence(offer), unconditionalApplicability, {
                  label: "Self-hosted execution settles through operator infrastructure",
                }),
              ],
            },
          ]
        : [],
  };
}

function bindRelations(books: AtomicPricingBook[]): void {
  const offers = books.flatMap(resourceOffer);
  const selfHosted = byModel(offers, "self_hosted");
  const hosted = byModel(offers, "hosted");
  const grants = byModel(offers, "grant");
  for (const artifact of offers.filter(({ book }) => resourceType(book) === "artifact")) {
    const modelRef = modelRefs(artifact.book)[0];
    if (modelRef === undefined) continue;
    const local = selfHosted.get(modelRef) ?? [];
    if (local.length > 0)
      artifact.offer.relations.push(
        relation(
          artifact.offer,
          "compatible_with",
          local.map(({ ref }) => ref),
          "Artifact access is compatible with exact self-hosted execution",
          unconditionalApplicability,
        ),
      );
    const grant = grants.get(modelRef) ?? [];
    if (grant.length > 0)
      artifact.offer.relations.push(
        relation(
          artifact.offer,
          "requires",
          grant.map(({ ref }) => ref),
          "Accounts above the family threshold require the separate Meta grant",
          licenseApplicability("separate_grant"),
        ),
      );
  }
  for (const [modelRef, locals] of selfHosted) {
    const remote = hosted.get(modelRef) ?? [];
    if (remote.length === 0) continue;
    for (const local of locals)
      local.offer.relations.push(
        relation(
          local.offer,
          "exclusive_with",
          remote.map(({ ref }) => ref),
          "Self-hosted and Meta-hosted execution are alternative routes for one work item",
          unconditionalApplicability,
        ),
      );
    for (const route of remote)
      route.offer.relations.push(
        relation(
          route.offer,
          "exclusive_with",
          locals.map(({ ref }) => ref),
          "Meta-hosted and self-hosted execution are alternative routes for one work item",
          unconditionalApplicability,
        ),
      );
  }
}

function resourceOffer(book: AtomicPricingBook): ResourceOffer[] {
  if (resourceType(book) === undefined) return [];
  const bookId = pricingBookId("llama", book.book_key);
  return book.offers.map((offer) => ({
    book,
    offer,
    ref: pricingOfferId(bookId, offer.offer_key),
  }));
}

function byModel(offers: ResourceOffer[], type: Resource): Map<string, ResourceOffer[]> {
  const result = new Map<string, ResourceOffer[]>();
  for (const offer of offers) {
    if (resourceType(offer.book) !== type) continue;
    for (const modelRef of modelRefs(offer.book)) {
      const current = result.get(modelRef) ?? [];
      current.push(offer);
      result.set(modelRef, current);
    }
  }
  return result;
}

function resourceType(book: AtomicPricingBook): Resource | undefined {
  if (book.scope.kind !== "provider_resource") return;
  const key = book.scope.resource_key;
  if (key.startsWith("artifact:")) return "artifact";
  if (key.startsWith("self-hosted:")) return "self_hosted";
  if (key.startsWith("llama-api-")) return "hosted";
  if (key.startsWith("license-grant:")) return "grant";
}

function modelRefs(book: AtomicPricingBook): string[] {
  return book.scope.kind === "provider_resource" ? book.scope.model_refs : [];
}

function licenseApplicability(value: "community" | "separate_grant"): PriceApplicability {
  return canonicalizeApplicability({
    any_of: [
      {
        all_of: [
          {
            kind: "categorical",
            dimension: licenseDimension,
            values: [{ namespace: "provider", provider_id: "llama", value }],
          },
        ],
      },
    ],
  });
}

function registerLicenseVocabulary(input: AtomicProviderPricing): void {
  addAtom(input, {
    kind: "dimension",
    key: "license_class",
    definition: "Meta Llama family-license eligibility resolved for the consuming account",
    resolution_phase: "account",
  });
  addAtom(input, {
    kind: "categorical_value",
    key: "community",
    dimension: licenseDimension,
    definition: "Account is eligible for the published royalty-free community grant",
    label: "Community grant",
  });
  addAtom(input, {
    kind: "categorical_value",
    key: "separate_grant",
    dimension: licenseDimension,
    definition: "Account requires a separate grant from Meta under the family license",
    label: "Separate Meta grant",
  });
}

function normalized(
  observation: RawPriceObservation,
  applicability: PriceApplicability,
  raw = observation.raw,
): NormalizedPriceObservation {
  return { ...rawEvidence(observation), raw, establishes_applicability: applicability };
}
