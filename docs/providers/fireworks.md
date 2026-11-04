# Fireworks AI

Status: implemented

The [public Model Library](https://fireworks.ai/models) provides Serverless admission. Read its
structured listing and crawl only the bounded same-host model cards with both Serverless flags.
Each card must publish its canonical link, exact model path and Serverless offering. The
publisher in a website slug can differ from the account in the API identifier. Dedicated
models and unreviewed routes outside the Model Library are outside this non-exhaustive scope.
The collection requires no account credential.

The [Serverless price book](https://docs.fireworks.ai/serverless/pricing) supplies exact
Standard and Priority rates. Priority is a service-tier selector for the same identifier.
Fast, Ultra-fast and US-only variants with a distinct ID require an exact match in the
[mode](https://docs.fireworks.ai/serverless/serverless-modes) or
[US-only](https://docs.fireworks.ai/serverless/us-only-serverless) route table and keep their
own model records even when pricing is absent. A price row without a matching card or router is a
reconciliation finding. For other admitted cards, the labeled Serverless price panel
supplies rates when the meter and unit are explicit. Ambiguous units or meters stay raw.
Exact API IDs bind these offers through the shared inference-price lookup.

Parameter-bucket fallbacks, Batch, dedicated capacity and account terms are outside the
pricing contract. Public documents may describe callable legacy embeddings outside the
library, so this collector makes no claim about the entire callable inventory.
