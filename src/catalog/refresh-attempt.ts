import { z } from "zod";
import { providerModelSchema } from "./schema.ts";
import { providerValidationIssueSchema } from "./validation.ts";
import { sourceContractEvidenceSchema, maxContractFindings } from "./source-contract.ts";
import { dependencyFailureSchema, maxDependencyFailures } from "./source-failure.ts";
import {
  sourcePricingExtractionSchema,
  sourcePricingReconciliationSchema,
} from "./pricing-reconciliation.ts";

export const sourceRefreshAttemptSchema = z.object({
  source_id: z.string().min(1),
  outcome: z.enum([
    "changed",
    "unchanged",
    "fetch_failed",
    "parse_failed",
    "skipped_not_configured",
  ]),
  parsed_models: z.number().int().nonnegative().optional(),
  content_changed: z.boolean().optional(),
  extractor_changed: z.boolean().optional(),
  message: z.string().optional(),
  http_status: z.number().int().min(100).max(599).optional(),
  dependency_failures: z.array(dependencyFailureSchema).max(maxDependencyFailures).optional(),
  dependency_failures_omitted: z.number().int().positive().optional(),
  consecutive_failures: z.number().int().positive().optional(),
  last_success_at: z.iso.datetime({ offset: true }).optional(),
  contract_finding: sourceContractEvidenceSchema.optional(),
  contract_findings: z
    .array(sourceContractEvidenceSchema)
    .min(1)
    .max(maxContractFindings)
    .optional(),
  contract_findings_omitted: z.number().int().positive().optional(),
  pricing_extraction: sourcePricingExtractionSchema.optional(),
  pricing_reconciliation: sourcePricingReconciliationSchema.optional(),
});

export const providerRefreshAttemptSchema = z.object({
  provider_id: z.string().min(1),
  outcome: z.enum(["accepted", "rejected", "not_configured"]),
  sources: z.array(sourceRefreshAttemptSchema),
  candidate_models: z.array(providerModelSchema).optional(),
  validation_issue: providerValidationIssueSchema.optional(),
  failure: z.object({ code: z.string(), message: z.string() }).optional(),
  pricing: z
    .object({
      outcome: z.enum(["accepted", "failed", "not_observed"]),
      failure_code: z.string().optional(),
      message: z.string().optional(),
    })
    .optional(),
});

export type SourceRefreshAttempt = z.infer<typeof sourceRefreshAttemptSchema>;
export type ProviderRefreshAttempt = z.infer<typeof providerRefreshAttemptSchema>;
