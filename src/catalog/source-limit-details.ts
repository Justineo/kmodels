import { sha256 } from "./io.ts";
import {
  limitDetailsSchema,
  type LimitDetailGroup,
  type LimitEvidence,
} from "./model-limit-details.ts";
import type { ParsedProviderModel } from "./pricing-source.ts";
import { contractExtensionEvidence } from "./source-contract.ts";
import type { SourceParseInput } from "./source-parse.ts";

export function limitDetailFinding(input: SourceParseInput, claim: string): void {
  input.onContractFinding?.(contractExtensionEvidence([`/limit_details/${claim}`]));
}

export function limitDocumentEvidence(
  input: SourceParseInput,
  document: { url: string; body: string },
  locator: string,
  excerpt: string,
): LimitEvidence {
  return {
    document_url: document.url,
    locator,
    observed_at: input.observedAt,
    content_hash: sha256(document.body),
    excerpt: excerpt.trim(),
  };
}

export function addLimitDetailGroup(
  input: SourceParseInput,
  model: ParsedProviderModel,
  group: Omit<LimitDetailGroup, "source_ref">,
): void {
  const groups = [...(model.limit_details ?? []), { ...group, source_ref: input.source.id }];
  const result = limitDetailsSchema.safeParse(groups);
  if (
    !result.success ||
    group.evidence.some(({ document_url }) => {
      const url = new URL(document_url);
      return url.protocol !== "https:" || !input.source.allowedHosts.includes(url.hostname);
    })
  ) {
    limitDetailFinding(input, group.claim);
    return;
  }
  model.limit_details = result.data;
}

export function limitTokenCount(value: string): number | undefined {
  const match = /^(\d+(?:,\d{3})*(?:\.\d+)?)\s*([kKmM])?(?: tokens?)?$/.exec(value.trim());
  if (!match?.[1]) return;
  const scale = match[2]?.toLowerCase() === "m" ? 1_000_000 : match[2] ? 1_000 : 1;
  const count = Number(match[1].replaceAll(",", "")) * scale;
  return Number.isSafeInteger(count) && count > 0 ? count : undefined;
}
