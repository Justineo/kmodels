import { capabilityDetailsSchema, type CapabilityDetailGroup } from "./model-capability-details.ts";
import type { ParsedProviderModel } from "./pricing-source.ts";
import { contractExtensionEvidence } from "./source-contract.ts";
import type { SourceParseInput } from "./source-parse.ts";

export { limitDocumentEvidence as capabilityDocumentEvidence } from "./source-limit-details.ts";

export function capabilityDetailFinding(input: SourceParseInput, claim: string): void {
  input.onContractFinding?.(contractExtensionEvidence([`/capability_details/${claim}`]));
}

export function addCapabilityDetailGroup(
  input: SourceParseInput,
  model: ParsedProviderModel,
  group: Omit<CapabilityDetailGroup, "source_ref">,
): void {
  const result = capabilityDetailsSchema.safeParse([
    ...(model.capability_details ?? []),
    { ...group, source_ref: input.source.id },
  ]);
  if (
    !result.success ||
    group.evidence.some(({ document_url }) => {
      const url = new URL(document_url);
      return url.protocol !== "https:" || !input.source.allowedHosts.includes(url.hostname);
    }) ||
    group.statements.some(
      (statement) =>
        statement.kind === "reasoning_effort" &&
        statement.default_value !== undefined &&
        statement.supported_values !== undefined &&
        !statement.supported_values.includes(statement.default_value),
    )
  ) {
    capabilityDetailFinding(input, group.claim);
    return;
  }
  model.capability_details = result.data;
}
