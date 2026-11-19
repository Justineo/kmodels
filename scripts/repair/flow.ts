import type { parseInvestigationOutcome } from "../catalog-repair-publication.ts";
import type { Verification } from "./verification.ts";
import { verificationVerdict } from "./verification.ts";

export function investigationRoute(
  outcome: ReturnType<typeof parseInvestigationOutcome>,
  candidates: number,
) {
  if (outcome.type === "report_incomplete") return "pending";
  if (candidates > 0) return "verify";
  if (outcome.type === "noop") return "idle";
  throw new Error("A patch requires admitted candidates");
}

export function reviewRoute(
  report: Verification,
  stage: "initial" | "takeover",
  alreadyAttempted: boolean,
) {
  const verdict = verificationVerdict(report);
  if (verdict === "supported") return "verified";
  if (verdict === "concrete_error" && stage === "initial" && !alreadyAttempted)
    return "needs_takeover";
  return "pending";
}

// Newest possible paid stage must account for its calls before an earlier journal can settle.
export function settlementReceipt(
  initialResult: string | undefined,
  initialOutcome: string | undefined,
  finalResult: string | undefined,
) {
  const finalCouldHaveSpent = initialOutcome === "needs_takeover" && finalResult !== "skipped";
  if (finalCouldHaveSpent) return "catalog-maintenance-review/review-usage.json";
  if (initialResult === "skipped") return "catalog-maintenance-usage/usage.json";
  return "catalog-maintenance-initial/review-usage.json";
}
