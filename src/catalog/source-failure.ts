import { z } from "zod";
import { compareUtf8 } from "./canonical-value.ts";
import { sha256 } from "./io.ts";
import {
  contractEvidence,
  maxContractFindings,
  sourceContractEvidenceSchema,
  type SourceContractFindings,
} from "./source-contract.ts";

export const maxDependencyFailures = 16;

export const sourceRetryFailureSchema = z.object({
  request: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9./-]{0,127}$/u),
  attempts: z.number().int().min(1).max(3),
  reason: z.enum(["attempt_limit", "retry_after_exceeds_budget", "backoff_exceeds_budget"]),
  delay_ms: z.number().int().nonnegative().optional(),
  remaining_budget_ms: z.number().int().nonnegative().optional(),
});
export type SourceRetryFailure = z.infer<typeof sourceRetryFailureSchema>;

const sourceFailureSchema = z.object({
  outcome: z.enum(["fetch_failed", "parse_failed"]),
  message: z.string().max(1024),
  http_status: z.number().int().min(100).max(599).optional(),
  contract_findings: z
    .array(sourceContractEvidenceSchema)
    .min(1)
    .max(maxContractFindings)
    .optional(),
});
export interface SourceFailure extends SourceContractFindings {
  outcome: z.infer<typeof sourceFailureSchema>["outcome"];
  message: string;
  http_status?: number;
  retry_failure?: SourceRetryFailure;
}

export const dependencyFailureSchema = sourceFailureSchema.extend({
  dependency_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/%-]{0,511}$/u),
  impact: z.enum(["bundle", "claim"]),
  consecutive_failures: z.number().int().positive().optional(),
  last_success_at: z.iso.datetime({ offset: true }).optional(),
});
export type DependencyFailure = z.infer<typeof dependencyFailureSchema>;

export function summarizeDependencyFailures(failures: readonly DependencyFailure[]): {
  dependency_failures?: DependencyFailure[];
  dependency_failures_omitted?: number;
} {
  if (failures.length === 0) return {};
  return {
    dependency_failures: [...failures]
      .sort(
        (left, right) =>
          Number(right.outcome === "parse_failed") - Number(left.outcome === "parse_failed") ||
          compareUtf8(left.dependency_id, right.dependency_id),
      )
      .slice(0, maxDependencyFailures),
    ...(failures.length <= maxDependencyFailures
      ? {}
      : { dependency_failures_omitted: failures.length - maxDependencyFailures }),
  };
}

export class SourceFetchError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

export class SourceRetryError extends SourceFetchError {
  readonly retryFailure: SourceRetryFailure;
  constructor(error: SourceFetchError, retryFailure: SourceRetryFailure) {
    super(error.message, error.status);
    this.retryFailure = retryFailure;
  }
}

/**
 * Privacy-preserving deterministic failure fingerprint computed BEFORE URL/ARN/credential redaction
 * and 1024-char truncation, so two different failing pages with identical redacted messages
 * (`Unexpected page: [source]`) remain distinguishable without leaking raw URLs or secrets.
 */
export function sourceErrorFingerprint(error: unknown): string {
  const raw = error instanceof Error ? `${error.name}:${error.message}` : String(error);
  return sha256(raw).slice(0, 16);
}

export function sourceErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
        .replace(/https?:\/\/\S+/g, "[source]")
        .replace(/\barn:aws(?:-[a-z0-9-]+)?:[^\s,;"']+/gi, "[resource]")
        .replace(/\b\d{12}\b/g, "[account]")
        .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, "[identity]")
        .replace(/\b(?:Bearer|Basic)\s+\S+/gi, "[credential]")
        .replace(/\p{Cc}/gu, " ")
        .slice(0, 1024)
    : "Unknown collection failure";
}

export function sourceFailure(
  error: unknown,
  fallback: SourceFailure["outcome"] = "fetch_failed",
): SourceFailure {
  const evidence = contractEvidence(error);
  let cause = error;
  let status: number | undefined;
  let retryFailure: SourceRetryFailure | undefined;
  for (let depth = 0; depth < 8 && cause instanceof Error; depth += 1) {
    if (cause instanceof SourceRetryError) retryFailure = cause.retryFailure;
    if (cause instanceof SourceFetchError && cause.status !== undefined) {
      status = cause.status;
      break;
    }
    cause = cause.cause;
  }
  return {
    outcome: evidence === undefined ? fallback : "parse_failed",
    message: sourceErrorMessage(error),
    ...(status === undefined ? {} : { http_status: status }),
    ...(retryFailure === undefined ? {} : { retry_failure: retryFailure }),
    ...(evidence === undefined ? {} : { contract_findings: [evidence] }),
  };
}
